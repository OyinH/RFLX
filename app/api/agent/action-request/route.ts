import { NextResponse } from "next/server";
import { z } from "zod";
import { decide } from "@/lib/policy-engine";
import { investigate, type EvidenceSource } from "@/lib/investigator";
import { getPatientCurrentMedications } from "@/lib/investigator/tools";
import { screenForInjection } from "@/lib/prompt-shield";
import { getTracer } from "@/lib/observability/tracer";
import { getPatientById, recordDecision } from "@/lib/supabase/queries";
import { getErrorMessage } from "@/lib/errors";
import { withHardTimeout } from "@/lib/timeout";

/**
 * Gateway API — specs/03-gateway-api.md. Ties Prompt Shield, the investigator,
 * and the Policy Engine into one request/response cycle. Server-only: never
 * expose Azure/OpenAI/Supabase service-role keys to the client bundle.
 */

// Placeholder per-token rate — GPT-5.6 Terra isn't a resolvable public pricing
// SKU as of this build (docs/engineering/architecture.md's Model Choice
// table names it, but no published price exists to cite). Update to the real
// rate before trusting estimated_cost_usd for anything beyond relative
// comparisons between requests in the same build.
const INPUT_TOKEN_COST_USD = 0.000003;
const OUTPUT_TOKEN_COST_USD = 0.000015;

const LOW_CONFIDENCE_THRESHOLD = 0.6; // specs/04-investigator.md's Low-Confidence Threshold

// lib/timeout.ts — Supabase calls here had no timeout at all until an eval
// run reproduced the same silent-stall symptom the investigator's own calls
// were already protected against, on a request whose investigator step
// completed normally. 10s is generous for what's normally a sub-second
// query, well short of the minutes a genuine stall would otherwise take.
const SUPABASE_CALL_TIMEOUT_MS = 10_000;

const ACTION_TYPES = [
  "draft_note",
  "update_medication",
  "schedule_referral",
  "message_patient",
  "export_record",
  "update_problem_list",
] as const;

const SOURCE_CHANNELS = ["direct_input", "patient_portal_message", "ingested_document"] as const;
const RISK_TIERS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const DECISIONS = ["auto_approve", "escalate", "block"] as const;

const RequestSchema = z.object({
  agent_id: z.string().min(1, "agent_id must not be empty"),
  action_type: z.enum(ACTION_TYPES),
  payload: z.object({
    patient_context_id: z.string().min(1, "patient_context_id must not be empty"),
    content: z.string().min(1, "content must not be empty"),
    source_channel: z.enum(SOURCE_CHANNELS),
  }),
  timestamp: z.string().datetime({ message: "timestamp must be ISO8601" }),
});

const ResponseSchema = z.object({
  decision: z.enum(DECISIONS),
  risk_tier: z.enum(RISK_TIERS),
  injection_flag: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  evidence_sources: z.array(
    z.object({
      tool: z.enum(["lookup_drug_label", "get_patient_current_medications"]),
      query: z.string(),
      finding: z.string(),
    }),
  ),
  investigation_steps_taken: z.number().int().min(0),
  incident_id: z.string().uuid(),
  latency_ms: z.number().int().min(0),
  token_cost: z.object({
    input_tokens: z.number().int().min(0),
    output_tokens: z.number().int().min(0),
    estimated_cost_usd: z.number().min(0),
    tool_call_count: z.number().int().min(0),
  }),
});

function badRequest(details: { field: string; issue: string }[]) {
  return NextResponse.json(
    { error: "invalid_request", message: "Request failed validation.", details },
    { status: 400 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();

  // --- Step 1: validate. Nothing downstream is called, and no spans are
  // emitted, until this passes (specs/07's Edge Cases). ---
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return badRequest([{ field: "body", issue: "Request body must be valid JSON." }]);
  }

  const parsed = RequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "(root)",
      issue: issue.message,
    }));
    return badRequest(details);
  }
  const body = parsed.data;

  let patientExists: boolean;
  try {
    patientExists =
      (await withHardTimeout(
        getPatientById(body.payload.patient_context_id),
        "getPatientById",
        SUPABASE_CALL_TIMEOUT_MS,
      )) !== null;
  } catch (err) {
    return NextResponse.json(
      { error: "validation_failed", message: getErrorMessage(err) },
      { status: 500 },
    );
  }
  if (!patientExists) {
    return badRequest([
      { field: "payload.patient_context_id", issue: "No matching patient found in synthea_patients." },
    ]);
  }

  // --- Steps 2-7: traced as one request. ---
  const tracer = getTracer();
  return tracer.startActiveSpan("gateway.action_request", async (rootSpan) => {
    try {
      rootSpan.setAttributes({
        "rflx.agent_id": body.agent_id,
        "rflx.action_type": body.action_type,
      });

      // Kicked off before Prompt Shield, not awaited yet — only needs
      // patient_context_id, not injection_flag, so it overlaps with Prompt
      // Shield instead of waiting behind it (investigate() awaits this below).
      const currentMedicationsPromise = getPatientCurrentMedications(body.payload.patient_context_id);

      // Step 2: Prompt Shield.
      let injectionFlag = false;
      let promptShieldFailed = false;
      await tracer.startActiveSpan("prompt_shield", async (span) => {
        try {
          const result = await screenForInjection(body.payload.content, body.payload.source_channel);
          injectionFlag = result.injection_flag;
          span.setAttributes({ "rflx.injection_flag": injectionFlag });
        } catch (err) {
          promptShieldFailed = true;
          span.recordException(err instanceof Error ? err : new Error(getErrorMessage(err)));
        } finally {
          span.end();
        }
      });

      // Step 3: investigator.
      let riskTier: (typeof RISK_TIERS)[number] = "HIGH";
      let reasoning = "";
      let confidence = 0;
      let evidenceSources: EvidenceSource[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let investigatorFailed = false;

      try {
        const result = await investigate({
          action_type: body.action_type,
          payload: body.payload,
          injection_flag: injectionFlag,
          currentMedications: currentMedicationsPromise,
        });
        riskTier = result.risk_tier;
        reasoning = result.reasoning;
        confidence = result.confidence;
        evidenceSources = result.evidence_sources;
        inputTokens = result.token_usage.input_tokens;
        outputTokens = result.token_usage.output_tokens;
      } catch (err) {
        investigatorFailed = true;
        reasoning = getErrorMessage(err);
      }

      const lowConfidence = !investigatorFailed && confidence < LOW_CONFIDENCE_THRESHOLD;
      const forceEscalate = promptShieldFailed || investigatorFailed || lowConfidence;

      if (forceEscalate) {
        const reasons: string[] = [];
        if (promptShieldFailed) reasons.push("Prompt Shield call failed");
        if (investigatorFailed) reasons.push("investigator call failed");
        if (lowConfidence) reasons.push(`investigator confidence ${confidence.toFixed(2)} below ${LOW_CONFIDENCE_THRESHOLD} threshold`);
        reasoning = `[FAIL-CLOSED: ${reasons.join("; ")}] ${reasoning}`.trim();
      }

      // Step 4: Policy Engine.
      const decision = await tracer.startActiveSpan("policy_engine", async (span) => {
        try {
          const result = forceEscalate ? "escalate" : decide(riskTier, injectionFlag);
          span.setAttributes({
            "rflx.risk_tier": riskTier,
            "rflx.injection_flag": injectionFlag,
            "rflx.decision": result,
            "rflx.forced_escalate": forceEscalate,
          });
          return result;
        } finally {
          span.end();
        }
      });

      const latencyMs = Date.now() - startedAt;
      const estimatedCostUsd = inputTokens * INPUT_TOKEN_COST_USD + outputTokens * OUTPUT_TOKEN_COST_USD;

      // Step 5: persist. A failure here is the one case that returns 500 —
      // a decision that isn't durably logged must never be reported as if it were.
      let recordResult: { action_id: string; incident_id: string };
      try {
        recordResult = await withHardTimeout(
          recordDecision({
            agent_id: body.agent_id,
            action_type: body.action_type,
            payload: body.payload,
            source_channel: body.payload.source_channel,
            risk_tier: riskTier,
            injection_flag: injectionFlag,
            confidence,
            reasoning,
            evidence_sources: evidenceSources,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            estimated_cost_usd: estimatedCostUsd,
            decision,
            latency_ms: latencyMs,
          }),
          "recordDecision",
          SUPABASE_CALL_TIMEOUT_MS,
        );
      } catch (err) {
        rootSpan.recordException(err instanceof Error ? err : new Error(getErrorMessage(err)));
        return NextResponse.json(
          { error: "persistence_failed", message: getErrorMessage(err) },
          { status: 500 },
        );
      }

      // Step 7: construct and validate the response before returning.
      const responseBody = {
        decision,
        risk_tier: riskTier,
        injection_flag: injectionFlag,
        confidence,
        reasoning,
        evidence_sources: evidenceSources,
        investigation_steps_taken: evidenceSources.length,
        incident_id: recordResult.incident_id,
        latency_ms: latencyMs,
        token_cost: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost_usd: estimatedCostUsd,
          tool_call_count: evidenceSources.length,
        },
      };

      const validated = ResponseSchema.safeParse(responseBody);
      if (!validated.success) {
        rootSpan.recordException(new Error(`Response failed schema validation: ${validated.error.message}`));
        return NextResponse.json(
          { error: "internal_error", message: "Computed response failed internal validation." },
          { status: 500 },
        );
      }

      return NextResponse.json(validated.data, { status: 200 });
    } finally {
      rootSpan.end();
    }
  });
}
