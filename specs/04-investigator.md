# Spec 04 — Bounded Agentic Investigator

**Builds on:** `specs/01-database-schema.md` (medication lookups query `synthea_medications`, joined against `synthea_patients` on `patient_context_id`).
**Integrates with:** called by `specs/03-gateway-api.md`; its `risk_tier` output must match `specs/02-policy-engine.md`'s taxonomy exactly; calls the external openFDA API.

## File

`lib/investigator/index.ts`, currently a scaffolded stub (`investigate()` throws). This spec is what replaces the stub body — the exported function signature stays the same; the return type below is a superset of the stub's current `InvestigatorResult` and requires updating that type too (see Code Changes Required).

## Tool Spec

Read-only, capped at 5 calls total per investigation. No write, messaging, or execution tools, ever — this is the concrete enforcement of "bounded agency."

```
lookup_drug_label(drug_name: string) -> {
  contraindications: string,
  warnings: string,
  boxed_warning: string,
  drug_interactions: string
}
  // Source: openFDA drug label API (api.fda.gov/drug/label.json) — free, public, no auth required
  // The only agentic tool as of v3 — the model decides whether/when to call it.
```

`get_patient_current_medications` is **not** an agentic tool as of v3 — see Latency Architecture (v3) below for why and what changed. It's still a read-only, never-real-PHI lookup against `synthea_medications` (`patient_context_id` matches, `stop_date` is null), just invoked unconditionally by the Gateway code path rather than on the model's request; `[]` for a patient with no active medications is still a valid result, not an error.

## Latency Architecture (v3) — Why `get_patient_current_medications` Isn't a Tool Call Anymore

Verified live (`docs/rflx_PRD.md`'s Success Metrics table has the numbers): P95 latency was 8.7-8.8s against a 3s target, and the bottleneck was the *number* of sequential reasoning-model round-trips, not per-call cost (`reasoning_effort` was already at its floor) or tool-execution time (parallelizing same-turn tool calls measured no improvement). `get_patient_current_medications` is always cheap (a direct Supabase query, tens of ms) and broadly relevant context for most clinical actions — there was no real reason to gate it behind an agentic decision that cost a whole extra reasoning-model turn in most investigations. It's now fetched eagerly in `investigate()`, before the loop starts, and handed to the model as a `patient_current_medications` field in its initial input (`prompts/investigator_v3.md`'s "What You Receive" section) — this removes a full round-trip from every case that would have called it, which was most of them.

This is not a security regression: same data source, same read-only access, no write/messaging/execution capability added — just delivered proactively instead of on demand, the same way a human investigator would already have the chart open before reasoning about it. `lookup_drug_label` stays a genuine agentic tool because whether a drug lookup is needed is much more clearly conditional than "does this investigation benefit from knowing the patient's current medications" (it almost always does). It's still recorded in `evidence_sources` with `tool: "get_patient_current_medications"` exactly as if it had been a tool call, so the review queue's transparency is unaffected — only the mechanism of invocation changed, not what's shown to a reviewer.

If a future investigation genuinely needs a *second* class of always-relevant, cheap, read-only context, the same eager-fetch pattern is the template — don't add another agentic tool call for something that isn't actually conditional.

## API Integration — Responses API, Not Chat Completions

Verified live against the real model: `gpt-5.6-terra` is a reasoning-tier model, and OpenAI's Chat Completions endpoint rejects function tools alongside reasoning on this model ("Function tools with reasoning_effort are not supported for gpt-5.6-terra in `/v1/chat/completions`. To use function tools, use `/v1/responses`..."). Use `client.responses.create()`, not `client.chat.completions.create()`:

- Function tools are flat (`{ type: "function", name, parameters, strict }`), not nested under a `function` key the way Chat Completions tools are.
- System prompt goes in the top-level `instructions` field, not a `system` message in the input array.
- Conversation continuation: push `response.output` (the model's items) and then a `{ type: "function_call_output", call_id, output }` item per tool call back into the `input` array for the next turn — `ResponseInputItem`'s type union already includes every item type `response.output` can contain, so this round-trips directly.
- Set `reasoning: { effort: "low" }` — real reasoning benefit without paying "high" effort's latency, given the P95 target below. (`"none"` is a Chat-Completions-only value; the Responses API's `reasoning.effort` type is `"low" | "medium" | "high" | null`.)
- Force termination via `tool_choice: { type: "function", name: "submit_assessment" }` (flat, matching the tool shape above — not Chat Completions' `{ type: "function", function: { name } }`).
- Token usage: `response.usage.input_tokens` / `response.usage.output_tokens` (same field names as Chat Completions' `usage.prompt_tokens`/`completion_tokens` conceptually, different key names).

**Client timeout, and why it alone wasn't enough:** an explicit `timeout` on the OpenAI client (20s, `lib/openai/client.ts`) replaced the SDK's 10-minute default after a handful of turns during a slow period on OpenAI's end compounded into single requests taking 6-75 minutes, twice ending in an outright failure. That helped, but **did not fully fix it** — verified in a later eval run, with the client timeout already in place: two separate requests each stalled for 11-12 minutes with zero error or retry signal in the logs, well past the 20s setting. The likely explanation is a hang below the SDK's own abort handling (e.g. DNS resolution or connection establishment, not response reading), which an SDK-internal timeout doesn't reliably cover. The actual fix (`lib/investigator/index.ts`'s `withHardTimeout()`) is a second, independent layer: a plain `Promise.race` against a JS `setTimeout` (25s) wrapped around every external call in the investigation loop (each `responses.create()` turn, `lookup_drug_label`, the eager medications fetch) — it has no dependency on the OpenAI SDK's network internals, so it fires regardless of where in the stack the stall is. A mid-loop timeout returns whatever evidence earlier turns already gathered via the existing low-confidence fallback path, rather than discarding it.

## Structured Output Schema

```ts
{
  risk_tier: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  reasoning: string,
  evidence_sources: Array<{ tool: "lookup_drug_label" | "get_patient_current_medications"; query: string; finding: string }>,
  confidence: number,          // 0.0-1.0 — the investigator's own self-assessed confidence in risk_tier
  token_usage: { input_tokens: number; output_tokens: number },  // summed across every LLM call this investigation made, not just the final one
}
```

`confidence` and `token_usage` were missing from the original spec pass even though `specs/03-gateway-api.md`'s response contract and `specs/01`'s `risk_classifications.confidence` column both already depended on them, and `specs/02-policy-engine.md`'s fail-closed rule explicitly references a "low-confidence result" with nothing defining what that means — this section is the fix. `estimated_cost_usd` and `tool_call_count` are **not** part of this schema — those are derived by `specs/03-gateway-api.md` from `token_usage` and `evidence_sources.length` respectively, not returned here.

## Low-Confidence Threshold

`confidence < 0.6` is treated as a low-confidence result by `specs/03-gateway-api.md`'s Fail-Closed Rule, routing to `escalate` regardless of the `risk_tier` value returned alongside it. `0.6` is a starting threshold, not a permanent constant — it's exactly the kind of number `docs/engineering/build-stages.md`'s Days 12–14 "thresholds tuned" step exists to calibrate against real eval results (`specs/08-eval-harness.md`); if the eval suite shows it's miscalibrated, change it there, re-run the full suite, and update this line in the same change.

## Prompt Strategy

- **Technique:** few-shot — 2–3 worked examples per risk tier (LOW/MEDIUM/HIGH/CRITICAL) embedded in the system prompt, not abstract tier definitions alone. Chosen because the taxonomy (`specs/02-policy-engine.md`) is small and stable enough that worked examples constrain judgment more reliably.
- **Output constraint:** every call must return the Structured Output Schema above — never free-form text.
- **File:** `prompts/investigator_v3.md` (current — earlier versions kept as history, never re-edited), never inlined in application code.
- **Versioning:** on a repeatable eval failure, add a targeted few-shot example, save as a new version, re-run the full eval suite, only then swap it into the API route. No prompt edit ships without a full eval re-run.
  - `v2`'s change: added a worked example for a real eval near-miss (`adv-context-aware-schedule-referral-02` — an unverifiable process-bypass claim with no `injection_flag` and no clinical-danger content for the taxonomy to catch it on) and guidance to batch independent tool calls in one turn (paired with a code change making the gateway actually run same-turn tool calls concurrently, `lib/investigator/index.ts`).
  - `v3`'s change: rewrote "Your Tools" and every worked example to reflect `get_patient_current_medications` no longer being an agentic tool call (Latency Architecture (v3) above) — the model now receives it as pre-fetched context instead of requesting it.

## Termination

The investigator must terminate within 5 tool calls with a valid structured output. If it can't reach a confident conclusion within the cap, it must still emit a structured output — with `confidence` set low enough to cross the threshold above — rather than throwing or returning nothing. The Gateway API treats a sub-threshold `confidence` as a fail-closed case (`specs/03-gateway-api.md`), routing to `escalate`, never returning an error to the caller and never silently dropping the low-confidence result.

## Code Changes Required

`lib/investigator/index.ts`'s current `InvestigatorResult` type is missing `confidence` and `token_usage` — add both before implementing the function body:

```ts
export interface InvestigatorResult {
  risk_tier: RiskTier;
  reasoning: string;
  evidence_sources: EvidenceSource[];
  confidence: number;
  token_usage: { input_tokens: number; output_tokens: number };
}
```

## Edge Cases

- **`lookup_drug_label` called with a drug name openFDA doesn't recognize** (misspelling, brand name it doesn't index, compounded/unlisted drug): openFDA returns no match, not an error. The tool should return an explicit "not found" finding string rather than throwing — a failed lookup is itself evidence (the investigator should reason about the absence of label data, not crash on it) and still counts toward the 5-call cap.
- **openFDA API unavailable or rate-limited:** treat as a tool-call failure. One failed tool call doesn't necessarily fail the whole investigation — the investigator can reason with whatever evidence it already has and should lower its `confidence` accordingly rather than retrying indefinitely (retries still count toward the 5-call cap if attempted).
- **`get_patient_current_medications` for a `patient_context_id` with no rows in `synthea_medications`:** returns `{ medications: [] }`, not an error (see Tool Spec above) — a patient on no active medications is a normal, expected case, not a data-quality problem.
- **The eager `get_patient_current_medications` fetch itself fails** (Supabase error, not just an empty result): as of v3, this degrades to an `evidence_sources` entry noting the retrieval failure and an empty medications list, rather than aborting the whole investigation before it even starts — consistent with how a failed `lookup_drug_label` call is itself treated as evidence, not a crash.
- **Investigator attempts a 6th `lookup_drug_label` call:** the calling harness must hard-stop at 5 and force termination into a structured output on the 5th call's result (or with whatever evidence exists if the 5th call is still pending) — this is the concrete mechanism behind "capped at 5 calls," not just a prompt instruction the model might ignore. (The cap only ever applied to `lookup_drug_label` calls as of v3, since it's now the only agentic tool.)
- **Model returns output that doesn't parse as valid JSON matching the schema:** treated identically to a timeout/error by `specs/03-gateway-api.md` — a step-3 failure routing to fail-closed `escalate`, not a crash propagated to the caller.
- **`risk_tier` returned doesn't match the taxonomy's baseline for the actual `action_type`** (e.g. LOW for an `update_medication`): not corrected or overridden here — the investigator's job is to reason about *this specific instance*, which may legitimately diverge from the taxonomy's baseline (that's exactly why an agentic investigator exists instead of a static lookup, per `docs/engineering/architecture.md` §3.5). Systematic divergence is an eval-harness signal (`specs/08`), not something this function should silently correct.

## Acceptance Criteria

- [ ] `investigate()` never calls a write, messaging, or execution tool — only `lookup_drug_label` (agentic) and `get_patient_current_medications` (eager, non-agentic) above, both read-only, verified by an allowlist at the tool-dispatch layer, not just prompt instructions.
- [ ] No investigation makes more than 5 `lookup_drug_label` calls, enforced in code (a hard counter), not left to the model's judgment alone.
- [ ] Every call returns a value matching the Structured Output Schema exactly, including `confidence` and `token_usage` — never free-form text, never a partial object.
- [ ] `token_usage` is the sum across every underlying LLM call the investigation made (a multi-step tool-calling loop may involve several), not just the final call's usage.
- [ ] A patient with zero active medications and a drug name openFDA doesn't recognize both produce valid low-friction results (empty list / "not found" finding), not thrown errors.
- [ ] Prompt changes are never made directly to the live version file after it's shipped — a change produces the next numbered version and a full eval re-run first (`specs/08-eval-harness.md`), verified by git history showing the eval run's commit predates the swap into the route. (`v1` → `v2` already followed this once; keep following it.)
