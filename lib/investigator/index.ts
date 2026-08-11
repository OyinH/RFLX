import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ResponseInputItem, Tool, ToolChoiceFunction } from "openai/resources/responses/responses";
import { getOpenAIClient } from "@/lib/openai/client";
import { getTracer } from "@/lib/observability/tracer";
import { getErrorMessage } from "@/lib/errors";
import type { ActionType, EvidenceSource, RiskTier, SourceChannel } from "@/lib/supabase/types";
import {
  getPatientCurrentMedications,
  lookupDrugLabel,
  summarizeDrugLabelFinding,
  summarizeMedicationsFinding,
} from "./tools";

/**
 * Bounded agentic investigator — specs/04-investigator.md. Read-only tools
 * only, capped at 5 calls total, terminates into the structured schema below
 * via a submit_assessment tool call (never free-form text). Prompt lives in
 * prompts/investigator_v3.md, loaded at runtime, never inlined here.
 *
 * v3 vs v2 — latency architecture change, not a tuning pass (per-turn cost
 * was already at the reasoning-effort floor, and parallelizing same-turn
 * tool calls measured no improvement: the bottleneck is the *number* of
 * sequential reasoning-model round-trips, not per-call or per-tool cost).
 * get_patient_current_medications is always cheap (a direct Supabase query)
 * and broadly relevant context for most clinical actions, so it no longer
 * waits behind an agentic tool call — it's fetched eagerly and handed to the
 * investigator as part of its initial context. lookup_drug_label stays a
 * genuine agentic tool since whether a drug lookup is needed is much more
 * clearly conditional. This removes a whole reasoning-model round-trip from
 * every case that would have called it (most of them), without touching the
 * read-only/no-write security property — same data, delivered eagerly
 * instead of on demand. specs/04's Tool Spec, docs/architecture.mmd, and
 * docs/sequence.mmd all reflect this.
 *
 * v2 vs v1 (specs/04's Versioning rule — new file, not an in-place edit):
 * added guidance to batch independent tool calls in one turn (now actually
 * run concurrently in code, see the Promise.all below) and one worked
 * example for an eval near-miss (an unverifiable process-bypass claim with
 * no injection_flag and no clinical-danger content to catch it on either).
 *
 * Uses the OpenAI Responses API, not Chat Completions — verified directly
 * against the live model that gpt-5.6-terra is a reasoning-tier model and
 * Chat Completions rejects function tools alongside reasoning on this model
 * ("Function tools with reasoning_effort are not supported for gpt-5.6-terra
 * in /v1/chat/completions. To use function tools, use /v1/responses...").
 * Responses is also the API OpenAI is standardizing reasoning+tools use on
 * going forward, so this isn't a workaround, it's the correct integration.
 */

// docs/engineering/architecture.md's Model Choice table.
const MODEL = "gpt-5.6-terra";
// Real reasoning benefit (this model's whole rationale per the Model Choice
// table) without the latency cost of "high" — specs/03-gateway-api.md's P95
// target is 3s end-to-end across Prompt Shield + this + policy engine + writes.
const REASONING_EFFORT = "low";
const MAX_TOOL_CALLS = 5;
// Hard ceiling on loop turns as a defensive fallback only — forcing tool_choice
// to submit_assessment once MAX_TOOL_CALLS is reached should always terminate
// well before this is reached; it exists so a misbehaving model response can
// never hang the request indefinitely.
const MAX_TURNS = MAX_TOOL_CALLS + 3;
const LOW_CONFIDENCE_FALLBACK = 0.3;

// Defense-in-depth, independent of the OpenAI client's own `timeout` option
// (lib/openai/client.ts) — verified live that the client-level timeout alone
// is not a reliable hard ceiling: two eval runs each had one request stall
// for 11-12 minutes with zero error/retry signal in the logs, well past the
// client's 20s setting, suggesting a hang below the SDK's own abort handling
// (e.g. DNS/connection-establishment) that its timeout doesn't reliably
// cover. This uses a plain JS timer with no dependency on the SDK's network
// internals, so it fires regardless of where in the stack the stall is.
const HARD_CALL_TIMEOUT_MS = 25_000;

class HardTimeoutError extends Error {}

function withHardTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new HardTimeoutError(`${label} exceeded hard timeout of ${HARD_CALL_TIMEOUT_MS}ms`)),
        HARD_CALL_TIMEOUT_MS,
      );
    }),
  ]);
}

let cachedSystemPrompt: string | undefined;

function loadSystemPrompt(): string {
  if (!cachedSystemPrompt) {
    cachedSystemPrompt = readFileSync(path.join(process.cwd(), "prompts", "investigator_v3.md"), "utf-8");
  }
  return cachedSystemPrompt;
}

export type { EvidenceSource };

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface InvestigatorResult {
  risk_tier: RiskTier;
  reasoning: string;
  evidence_sources: EvidenceSource[];
  /** 0.0-1.0 self-assessed confidence. Below 0.6, specs/03-gateway-api.md's
   * Fail-Closed Rule routes the request to `escalate` regardless of risk_tier. */
  confidence: number;
  /** Summed across every LLM call this investigation made, not just the final one. */
  token_usage: TokenUsage;
}

export interface InvestigationInput {
  action_type: ActionType;
  payload: {
    patient_context_id: string;
    content: string;
    source_channel: SourceChannel;
  };
  injection_flag: boolean;
}

// Responses API function tools are flat (name/parameters/strict at the top
// level) — not nested under a `function` key like Chat Completions' tool shape.
// get_patient_current_medications is deliberately NOT here as of v3 — it's
// fetched eagerly and handed to the investigator as context instead (see the
// module comment above).
const TOOLS: Tool[] = [
  {
    type: "function",
    name: "lookup_drug_label",
    description:
      "Look up FDA drug label information (contraindications, warnings, boxed warning, drug interactions) for a named drug via the openFDA API.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        drug_name: { type: "string", description: "Generic or brand drug name" },
      },
      required: ["drug_name"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "submit_assessment",
    description: "Terminate the investigation and submit your final risk assessment.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        risk_tier: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
        reasoning: { type: "string" },
        confidence: { type: "number" },
      },
      required: ["risk_tier", "reasoning", "confidence"],
      additionalProperties: false,
    },
  },
];

const FORCE_SUBMIT_TOOL_CHOICE: ToolChoiceFunction = { type: "function", name: "submit_assessment" };

interface SubmitAssessmentArgs {
  risk_tier: RiskTier;
  reasoning: string;
  confidence: number;
}

function isRiskTier(value: unknown): value is RiskTier {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "CRITICAL";
}

function parseSubmitAssessmentArgs(raw: string): SubmitAssessmentArgs | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (!isRiskTier(obj.risk_tier)) return null;
  if (typeof obj.reasoning !== "string") return null;
  if (typeof obj.confidence !== "number" || Number.isNaN(obj.confidence)) return null;
  return {
    risk_tier: obj.risk_tier,
    reasoning: obj.reasoning,
    confidence: Math.max(0, Math.min(1, obj.confidence)),
  };
}

export async function investigate(input: InvestigationInput): Promise<InvestigatorResult> {
  const client = getOpenAIClient();
  const tracer = getTracer();
  const systemPrompt = loadSystemPrompt();

  const evidenceSources: EvidenceSource[] = [];
  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Fetched eagerly, not as an agentic tool call, as of v3 — see the module
  // comment above for why. Still recorded as an evidence_sources entry so
  // the review queue shows it was checked, same as if it had been a tool call.
  // A failure here degrades to "unable to retrieve" rather than aborting the
  // whole investigation — consistent with how a failed lookup_drug_label call
  // is itself treated as evidence, not a crash (specs/04's Edge Cases).
  const currentMedications = await tracer.startActiveSpan("investigator.eager_medications_lookup", async (span) => {
    try {
      const result = await withHardTimeout(
        getPatientCurrentMedications(input.payload.patient_context_id),
        "eager medications lookup",
      );
      const finding = summarizeMedicationsFinding(result);
      evidenceSources.push({
        tool: "get_patient_current_medications",
        query: input.payload.patient_context_id,
        finding,
      });
      span.setAttributes({ "rflx.tool.result_count": result.medications.length });
      return result;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(getErrorMessage(err)));
      evidenceSources.push({
        tool: "get_patient_current_medications",
        query: input.payload.patient_context_id,
        finding: `Could not retrieve medication history: ${getErrorMessage(err)}`,
      });
      return { medications: [] };
    } finally {
      span.end();
    }
  });

  const conversation: ResponseInputItem[] = [
    {
      role: "user",
      content: JSON.stringify({
        action_type: input.action_type,
        payload: input.payload,
        injection_flag: input.injection_flag,
        patient_current_medications: currentMedications.medications,
      }),
    },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const forceSubmit = toolCallCount >= MAX_TOOL_CALLS;

    let response;
    try {
      response = await withHardTimeout(
        client.responses.create({
          model: MODEL,
          instructions: systemPrompt,
          input: conversation,
          tools: TOOLS,
          tool_choice: forceSubmit ? FORCE_SUBMIT_TOOL_CHOICE : "auto",
          reasoning: { effort: REASONING_EFFORT },
        }),
        `investigator turn ${turn + 1}`,
      );
    } catch (err) {
      // Preserve whatever evidence earlier turns already gathered rather than
      // discarding it — a hard-timeout mid-investigation still has partial
      // evidence worth returning, unlike a first-turn failure with nothing yet.
      return lowConfidenceFallback(
        `Investigator turn ${turn + 1} failed: ${getErrorMessage(err)}`,
        evidenceSources,
        totalInputTokens,
        totalOutputTokens,
      );
    }

    totalInputTokens += response.usage?.input_tokens ?? 0;
    totalOutputTokens += response.usage?.output_tokens ?? 0;

    conversation.push(...response.output);

    const functionCalls = response.output.filter((item) => item.type === "function_call");
    if (functionCalls.length === 0) {
      // Model returned no tool call this turn (e.g. only a reasoning or
      // message item) — nudge it back toward the required protocol rather
      // than silently accepting free text.
      conversation.push({
        role: "user",
        content: "You must call a tool — lookup_drug_label or submit_assessment.",
      });
      continue;
    }

    // submit_assessment takes priority and short-circuits — checked first so
    // a turn that (unusually) mixes it with other calls still terminates
    // immediately rather than needlessly executing more tool calls.
    const submitCall = functionCalls.find((call) => call.name === "submit_assessment");
    if (submitCall) {
      const args = parseSubmitAssessmentArgs(submitCall.arguments);
      if (!args) {
        // Malformed structured output — treated as a step-3 failure by the
        // Gateway API's Fail-Closed Rule, not a crash here (specs/04's Edge Cases).
        return lowConfidenceFallback(
          "Investigator returned a malformed submit_assessment payload.",
          evidenceSources,
          totalInputTokens,
          totalOutputTokens,
        );
      }
      const span = tracer.startSpan("investigator.final_output");
      span.setAttributes({
        "rflx.risk_tier": args.risk_tier,
        "rflx.confidence": args.confidence,
        "rflx.tool_call_count": toolCallCount,
      });
      span.end();

      return {
        risk_tier: args.risk_tier,
        reasoning: args.reasoning,
        confidence: args.confidence,
        evidence_sources: evidenceSources,
        token_usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
      };
    }

    // Multiple lookup_drug_label calls in the same turn (e.g. a case naming
    // several drugs) run concurrently, not sequentially — independent
    // openFDA queries with no data dependency on each other.
    const investigativeCalls = functionCalls.filter(
      (call): call is typeof call & { name: "lookup_drug_label" } => call.name === "lookup_drug_label",
    );

    await Promise.all(
      investigativeCalls.map(async (call) => {
        if (toolCallCount >= MAX_TOOL_CALLS) {
          conversation.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: "Tool call cap reached (5). You must call submit_assessment now with the evidence gathered so far.",
          });
          return;
        }

        toolCallCount++;
        const result = await runInvestigativeTool(tracer, call.arguments, evidenceSources);
        conversation.push({ type: "function_call_output", call_id: call.call_id, output: result });
      }),
    );
  }

  // Exceeded MAX_TURNS without a submit_assessment call — defensive fallback,
  // not expected in normal operation given forced tool_choice at the cap.
  return lowConfidenceFallback(
    "Investigator did not terminate within the turn limit.",
    evidenceSources,
    totalInputTokens,
    totalOutputTokens,
  );
}

async function runInvestigativeTool(
  tracer: ReturnType<typeof getTracer>,
  rawArgs: string,
  evidenceSources: EvidenceSource[],
): Promise<string> {
  return tracer.startActiveSpan("investigator.tool_call.lookup_drug_label", async (span) => {
    try {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(rawArgs) as Record<string, unknown>;
      } catch {
        args = {};
      }

      const drugName = typeof args.drug_name === "string" ? args.drug_name : "";
      const result = await withHardTimeout(lookupDrugLabel(drugName), `lookup_drug_label(${drugName})`);
      const finding = summarizeDrugLabelFinding(drugName, result);
      evidenceSources.push({ tool: "lookup_drug_label", query: drugName, finding });
      span.setAttributes({ "rflx.tool.query": drugName, "rflx.tool.found": result.found });
      return JSON.stringify(result);
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(getErrorMessage(err)));
      return JSON.stringify({ error: getErrorMessage(err) });
    } finally {
      span.end();
    }
  });
}

function lowConfidenceFallback(
  reasoning: string,
  evidenceSources: EvidenceSource[],
  inputTokens: number,
  outputTokens: number,
): InvestigatorResult {
  return {
    risk_tier: "HIGH",
    reasoning,
    confidence: LOW_CONFIDENCE_FALLBACK,
    evidence_sources: evidenceSources,
    token_usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}
