# Spec 03 — Gateway API

**Builds on:** `specs/01-database-schema.md`, `specs/02-policy-engine.md`.
**Integrates with:** calls `specs/04-investigator.md` for classification; ties Prompt Shield, the investigator, and the Policy Engine together into one request/response cycle; every field in the response is written across `agent_actions`/`risk_classifications`/`incidents` per `specs/01-database-schema.md`. Called by `specs/00-mock-agent-simulator.md` and `specs/08-eval-harness.md`, both of which are just HTTP clients of this endpoint.

## File

`app/api/agent/action-request/route.ts` (Next.js App Router Route Handler — server-only, never expose Azure/OpenAI/Supabase service-role keys to the client bundle). Currently a scaffolded stub returning `501`; this spec is what replaces that stub.

## Contract

```
POST /api/agent/action-request
Request:
{
  "agent_id": "string",
  "action_type": "draft_note | update_medication | schedule_referral |
                  message_patient | export_record | update_problem_list",
  "payload": {
    "patient_context_id": "string (synthetic, Synthea-derived — must exist in synthea_patients)",
    "content": "string",
    "source_channel": "direct_input | patient_portal_message | ingested_document"
  },
  "timestamp": "ISO8601"
}

Response (200):
{
  "decision": "auto_approve | escalate | block",
  "risk_tier": "LOW | MEDIUM | HIGH | CRITICAL",
  "injection_flag": true | false,
  "confidence": 0.0-1.0,
  "reasoning": "string",
  "evidence_sources": [
    { "tool": "lookup_drug_label" | "get_patient_current_medications", "query": "string", "finding": "string" }
    // 0 to 5 entries — one per tool call the investigator actually made this request,
    // NOT a fixed shape. A LOW-risk draft_note with no investigation needed may return [].
  ],
  "investigation_steps_taken": integer,  // == evidence_sources.length, derived by this route, not returned by the investigator directly
  "incident_id": "uuid",
  "latency_ms": integer,
  "token_cost": { "input_tokens": int, "output_tokens": int, "estimated_cost_usd": float, "tool_call_count": int }
}

Response (400) — malformed request, nothing downstream was called:
{ "error": "invalid_request", "message": "string", "details": [ { "field": "string", "issue": "string" } ] }

Response (500) — the decision was computed but could not be durably persisted:
{ "error": "persistence_failed", "message": "string" }
```

`confidence` and `token_cost.{input_tokens,output_tokens}` originate from the investigator's structured output (`specs/04-investigator.md`) — this route doesn't compute them, only relays and (for `estimated_cost_usd`/`tool_call_count`) derives them. `investigation_steps_taken` and `token_cost.tool_call_count` are the same underlying number (`evidence_sources.length`) surfaced under two field names for response-shape backward compatibility with the original contract draft — don't treat them as independently sourced.

## Request Sequence (Workflow)

1. Validate the request body against the schema above — reject with `400` before doing anything else if it doesn't conform, including a `patient_context_id` that doesn't exist in `synthea_patients` (`specs/01`). Don't pass an unvalidated payload downstream (`skills/security-foundation/SKILL.md`).
2. Call Azure Prompt Shield with the payload content → `injection_flag`.
3. Call the investigator (`specs/04-investigator.md`) with the payload and `injection_flag` → `risk_tier`, `reasoning`, `evidence_sources`, `confidence`, token usage. Validate the investigator's output against its structured schema before using it — if it doesn't conform, treat as a step-3 failure (see Fail-Closed below), not a crash.
4. Call the Policy Engine (`specs/02-policy-engine.md`) with `risk_tier` + `injection_flag` → `decision`.
5. Write `agent_actions`, `risk_classifications`, `incidents` rows (`specs/01-database-schema.md`), in that order, in a single logical unit — see Edge Cases for what happens if step 5 itself fails partway through.
6. Emit OpenTelemetry spans for each step above (`specs/07-observability.md`) — additive, never blocking the response if the exporter is slow/unavailable.
7. Return the response. Validate it against the schema above before returning — reject/500 rather than return a malformed payload.

## Fail-Closed Rule

Any failure at steps 2–4 (timeout, error, or a `confidence` below the low-confidence threshold defined in `specs/04-investigator.md`) routes to `decision: "escalate"` — the request still completes normally through steps 5–7 with `decision` forced to `escalate`, `risk_tier` set to the best available guess (or `HIGH` if none is available), and `reasoning` prefixed to state which step failed and why. This is never a `500` and never drops the action silently, and it is never `auto_approve`.

## Non-Negotiable

- Every response must validate against this schema — no untyped `any`.
- Any failure at steps 2–4 routes to `decision: "escalate"` per the Fail-Closed Rule above, not a `500` and not an `auto_approve`.
- A failure at step 5 (the Supabase write itself) is the one case that **does** return `500` — see Edge Cases. A decision that isn't durably logged must never be reported to the caller as if it were, since "every decision has an audit trail entry" is a 100% reliability target (`docs/rflx_PRD.md` §1).
- P95 target: <3 seconds end-to-end. **Not currently met — investigated and documented, not silently missed.** Measured live against the full `specs/08-eval-harness.md` suite (100 cases, production build, real Prompt Shield configured): P95 = 8.5s (`docs/rflx_PRD.md`'s Success Metrics table has the full before/after, including two architectural changes tried against it, neither of which moved the P95 number). Root cause: the number of sequential reasoning-model round-trips the investigator's loop makes, not request-handling or infra overhead — `reasoning_effort` is already at its floor (`"low"`, `specs/04-investigator.md`). Closing this further needs a different kind of architectural change (a faster non-reasoning model for lower-complexity cases, a hybrid tiering approach, or revisiting the target) — a deliberate future decision. Separately, this investigation surfaced and fixed a real reliability bug along the way: two requests silently stalled 11-12 minutes despite an already-configured client timeout (`specs/04-investigator.md`'s Client Timeout section) — now hard-capped independent of the OpenAI SDK's own timeout handling. The two metrics that actually validate the hypothesis, catch rate and false-positive rate, both clear their targets cleanly and held steady at 100%/0% throughout.

## Edge Cases

- **Step 5 (Supabase write) fails after a real decision was already computed:** the decision exists in memory but isn't durably recorded. Return `500` with `error: "persistence_failed"` rather than `200` with the computed decision — a decision the caller acts on but that never made it into the audit trail is worse than a visible failure the caller can retry. This is a deliberate asymmetry with the Fail-Closed Rule above: steps 2–4 failing still produces a *logged* `escalate` decision; step 5 failing means there's nothing to log yet, so there's nothing safe to return.
- **Partial write within step 5** (`agent_actions` succeeds, `risk_classifications` or `incidents` fails): still a `persistence_failed` 500. The orphaned `agent_actions` row this leaves behind is the same scenario `specs/01`'s Edge Cases section already documents as acceptable — invisible to both UIs, not cleaned up automatically at MVP scope.
- **`patient_context_id` valid but has zero medications on file:** not an error — `specs/04`'s `get_patient_current_medications` returns an empty list, and the investigator reasons with whatever evidence it has.
- **Duplicate submissions (same logical action posted twice):** no idempotency key in the request schema, and none is added here — each POST is treated as an independent action, producing two separate `agent_actions`/`incidents` rows. Acceptable for this scope (no client retry-with-dedup story is required by the PRD); flagged so a future spec change is deliberate, not an oversight.
- **Investigator exceeds its 5-tool-call cap without terminating:** per `specs/04`'s Termination section, this surfaces as a low-confidence result, not a hang or an exception — handled by the Fail-Closed Rule like any other step-3 failure.
- **Oversized or malformed `payload.content`:** rejected at step 1 validation (`400`) if it fails schema validation (e.g. wrong type); an excessively long but schema-valid string is passed through to Prompt Shield and the investigator as-is — no separate length cap is specified here, so don't silently truncate content that could hide the injection the pipeline exists to catch.

## Acceptance Criteria

- [ ] A request with a missing required field, wrong type, invalid `action_type`, or a `patient_context_id` not present in `synthea_patients` returns `400` with a `details` array identifying the specific field(s), and calls nothing downstream (verifiable by mocking Prompt Shield/investigator/Supabase and asserting zero calls).
- [ ] A well-formed request produces exactly one row in each of `agent_actions`, `risk_classifications`, and `incidents`, correctly linked by `action_id`.
- [ ] Every field in the 200 response matches the corresponding persisted row exactly (`decision` == `incidents.decision`, `risk_tier`/`injection_flag`/`confidence`/`reasoning` == the `risk_classifications` row, etc.) — no drift between what's returned and what's logged.
- [ ] Simulating a Prompt Shield timeout, an investigator error, and an investigator low-confidence result each independently produce a `200` response with `decision: "escalate"` and a logged `incidents` row — never a `500`, never `auto_approve`.
- [ ] Simulating a Supabase write failure after a decision is computed produces a `500` with `error: "persistence_failed"` and no misleading decision returned to the caller.
- [ ] P95 latency across a representative eval run (`specs/08-eval-harness.md`) is under 3 seconds. **Known open item as of this build** (measured 8.5s, root-caused, two architectural fixes tried with no P95 improvement, documented above and in `docs/rflx_PRD.md`'s Success Metrics table) — left unchecked deliberately, not an oversight.
