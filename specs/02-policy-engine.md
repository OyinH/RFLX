# Spec 02 — Policy Engine (Risk Taxonomy + Rule Table)

**Builds on:** `specs/01-database-schema.md` (writes to `incidents.decision`).
**Integrates with:** `specs/03-gateway-api.md` calls this with the investigator's output; `specs/04-investigator.md`'s `risk_tier` output must match one of the four values here exactly. Pure logic, no external calls — buildable and testable in isolation before the investigator exists.

## Non-Negotiable

This is a fixed rule table. It never calls a model. Given the same two inputs, it always produces the same output. If a future feature seems to need model reasoning at this step, that's a signal to stop and flag it, not to add a call here.

## Function Contract

```ts
function decide(riskTier: RiskTier, injectionFlag: boolean): Decision
```

Matches the stub already scaffolded at `lib/policy-engine/index.ts`. Pure, synchronous, no I/O, no Supabase/OpenAI/Azure calls of any kind — implement the body directly against the rule table below, replacing the stub's `throw`. `RiskTier` and `Decision` are the types already defined in `lib/supabase/types.ts`; import them from there rather than redeclaring.

## Risk Classification Taxonomy

| action_type | Baseline Risk Tier | Escalation Trigger |
|---|---|---|
| draft_note | LOW | Injection flag detected → CRITICAL |
| update_medication | HIGH | Always requires review; CRITICAL if injection flag or contraindication pattern detected |
| schedule_referral | MEDIUM | Injection flag → CRITICAL |
| message_patient | MEDIUM | Injection flag or content mismatch → HIGH |
| export_record | CRITICAL | Always blocked pending explicit reviewer approval |
| update_problem_list | HIGH | Injection flag → CRITICAL |

`action_type` is a closed enum: `draft_note | update_medication | schedule_referral | message_patient | export_record | update_problem_list`. Don't add a new value without updating both tables on this page in the same change. This taxonomy is what `specs/04-investigator.md`'s prompt teaches the model to reproduce — the investigator, not this function, is responsible for landing on the right `risk_tier` for a given `action_type`. `decide()` itself never looks at `action_type` directly; it only consumes the `risk_tier` the investigator already derived from it.

## Policy Rule Table

| risk_tier | injection_flag | Decision |
|---|---|---|
| LOW | false | auto_approve |
| LOW | true | escalate |
| MEDIUM | false | auto_approve |
| MEDIUM | true | escalate |
| HIGH | false | escalate |
| HIGH | true | block |
| CRITICAL | any | block |

All eight `(risk_tier, injection_flag)` combinations resolve to exactly one of the three decisions above — no combination is undefined. (An earlier draft of this table appended "(with logging)" to the `MEDIUM`/`false` row; dropped as misleading — every decision from every row gets logged identically to `incidents` per `specs/01`, so calling out logging on one row implied the others weren't, which isn't true.)

## Fail-Closed Rule

Any upstream error, timeout, or low-confidence result from the investigator or Prompt Shield routes here as if it were `escalate` — never `auto_approve`. This overrides the table above; it's not one of the four risk tiers, it's a separate failure path that always lands on the safe side. This fail-closed routing happens in `specs/03-gateway-api.md`'s request sequence, **before** `decide()` is ever called — `decide()` itself is never invoked with a failure state as input; it only ever sees a real `risk_tier` and a real `injection_flag`.

## Edge Cases

- **`risk_tier` outside the four-value enum:** shouldn't happen if `specs/03` validates the investigator's structured output against its schema before calling `decide()` (which it must — see `specs/03`'s Request Sequence step 3), so `decide()` itself doesn't need its own defensive fallback. If it's ever called with something outside `LOW | MEDIUM | HIGH | CRITICAL` regardless, throw rather than silently defaulting — that's a caller bug (schema validation was skipped), not a case this function should paper over by guessing a decision.
- **`injection_flag` and `risk_tier` disagreeing with the taxonomy's own escalation trigger column:** e.g. the investigator returns `risk_tier: LOW` for an `update_medication` action, which the taxonomy says should baseline at HIGH. `decide()` doesn't second-guess the investigator's `risk_tier` against the taxonomy table — it trusts the input and applies the rule table mechanically. Catching a systematically wrong `risk_tier` is the eval harness's job (`specs/08-eval-harness.md`), not a runtime check here; adding one would turn this back into a judgment call, which is exactly what this function must never do.
- **CRITICAL with `injection_flag: false`:** still `block`, per "CRITICAL | any". A CRITICAL classification (e.g. `export_record`) blocks regardless of whether an injection was detected — CRITICAL's baseline risk alone is sufficient, independent of the injection signal.

## Acceptance Criteria

- [ ] `decide()` is a pure function: same two inputs always produce the same output, no side effects, no async.
- [ ] Unit tests cover all eight `(risk_tier, injection_flag)` combinations exhaustively, each asserting the exact `Decision` value from the table above.
- [ ] `decide()` never imports or calls anything from `lib/supabase/`, `lib/investigator/`, or any HTTP client — verified by code review (no I/O in a deterministic rule table).
- [ ] Adding a fifth `action_type` value anywhere in the codebase without a corresponding update to both tables on this page is caught in review, not shipped silently (`CLAUDE.md` Naming Conventions already states this rule; this is the concrete enforcement point).
