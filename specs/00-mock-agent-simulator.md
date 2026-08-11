# Spec 00 — Mock Clinical Agent Simulator

**Status:** no spec existed for this P0 component until now (`docs/engineering/build-stages.md`'s Spec Coverage section tracks this as closed). Numbered `00` because it's the entry point that exercises everything else, not because it's built first: it has no reason to exist until `specs/01` (schema) and `specs/03` (gateway) are real. **Builds on:** `specs/01-database-schema.md` (`synthea_patients`), `specs/03-gateway-api.md` (the endpoint it calls).
**Integrates with:** its core generation logic is reused by `specs/08-eval-harness.md` to produce the committed benign eval cases (see Integration with the Eval Harness below) — don't reimplement action-proposal generation twice.

## Purpose

Per `docs/rflx_PRD.md` §6.1: "Issues structured action requests using OpenAI-generated proposals over Synthea-derived synthetic patients... nothing else in the pipeline is testable without a source of action requests." There is no live EHR and no real agent in this system (deliberately, per PRD §6.2) — this script is the entire "front door" traffic source for manual testing and demo purposes. It is not part of the Next.js app; it's a standalone Node script that acts as an external HTTP client of the Gateway API, exactly like a real clinical agent would.

## Files

- `scripts/mock-agent/generate-action.ts` — core generation logic, exported as a function so `specs/08-eval-harness.md` can import it directly rather than duplicating it.
- `scripts/mock-agent/run.ts` — CLI entry point for interactive/demo use.
- `package.json` needs a `"mock-agent": "tsx scripts/mock-agent/run.ts"` script and `tsx` as a new devDependency — neither exists yet; add both when this is built.

## Contract

```ts
async function generateBenignAction(
  actionType: ActionType,
  patient: { patient_context_id: string; age_band: string; sex: string; medications: string[] },
): Promise<{
  agent_id: string;
  action_type: ActionType;
  payload: {
    patient_context_id: string;
    content: string;
    source_channel: SourceChannel;
  };
  timestamp: string; // ISO8601, generated at call time
}>
```

Calls OpenAI once per invocation to draft plausible `payload.content` for the given `action_type`, grounded in the patient's actual `synthea_medications` (e.g. a `draft_note` mentioning their real current prescriptions, an `update_medication` proposing a change consistent with their existing regimen). Uses a smaller/cheaper OpenAI model than the investigator's GPT-5.6 Terra (`docs/engineering/architecture.md`'s Model Choice table) — this call only needs to produce plausible clinical text, not judge risk, so the cost/quality bar is different and shouldn't be conflated with the investigator's model choice.

`agent_id` is a fixed constant identifying this simulator (e.g. `"mock-clinical-agent-v1"`) — not per-invocation random — so `agent_actions.agent_id` can be filtered/grouped meaningfully later.

## CLI Behavior

```
npm run mock-agent -- --count 10 [--action-type <type>] [--patient-id <id>] [--base-url http://localhost:3000]
```

For each of `count` iterations: pick a random `synthea_patients` row (or use `--patient-id`), pick a random `action_type` from the closed enum (or use `--action-type`), call `generateBenignAction()`, `POST` the result to `${baseUrl}/api/agent/action-request`, and log the response (`decision`, `risk_tier`, `latency_ms`) to stdout. `--base-url` defaults to `http://localhost:3000` for local dev against `next dev`.

## Integration with the Eval Harness

`specs/08-eval-harness.md`'s benign eval cases are generated **once**, offline, by calling `generateBenignAction()` directly (not through the CLI) for a fixed, deterministic list of `(action_type, patient)` pairs covering the fairness stratification dimensions (`docs/engineering/data-model.md`), then hand-reviewed and committed as static JSON files under `eval/cases/benign/`. The eval runner never calls OpenAI live at eval-run time to generate benign cases — that would make eval results non-reproducible between runs, which defeats the purpose of a committed, git-timestamped eval suite (`docs/engineering/build-stages.md`'s Git Discipline section). This script's job ends at producing the candidate content; a human reviews and commits it before it becomes an eval case.

## Edge Cases

- **OpenAI call fails or times out during generation:** log the failure clearly (which patient/action_type was being generated) and skip that iteration rather than retrying indefinitely or crashing the whole run — a `--count 10` run that produces 8 successful requests and 2 logged failures is acceptable; a run that silently produces fewer than requested with no explanation is not.
- **Gateway API unreachable** (dev server not running, wrong `--base-url`): fail fast with a clear connection-error message on the first request, not a generic timeout after retrying every one of `count` iterations.
- **Patient with no active medications selected for `update_medication`:** the generator must still produce plausible content (e.g. proposing a new medication rather than referencing a nonexistent existing one) — this is the same "empty medication list is valid, not an error" case `specs/04-investigator.md` documents, viewed from the generation side instead of the lookup side.
- **`--patient-id` that doesn't exist in `synthea_patients`:** fail immediately with a clear error before attempting any OpenAI call or Gateway API request, not a downstream 400 from the gateway that obscures the actual mistake.
- **Rapid repeated runs hitting OpenAI rate limits:** not a concern this spec needs to solve beyond surfacing the rate-limit error clearly per the "OpenAI call fails" case above — no built-in backoff/retry queue required at this scope.

## Acceptance Criteria

- [ ] `generateBenignAction()`'s output always validates against `specs/03-gateway-api.md`'s request schema without modification.
- [ ] `npm run mock-agent -- --count N` makes at most `N` Gateway API calls and logs a decision or a clearly-labeled failure for each attempted one.
- [ ] Running with `--action-type` or `--patient-id` constrains generation to exactly that value; omitting either produces a uniform random choice across the closed `action_type` enum / all rows in `synthea_patients`.
- [ ] `generateBenignAction()` is imported (not reimplemented) by whatever script produces `specs/08-eval-harness.md`'s committed benign case files.
- [ ] A patient with zero active medications produces valid, plausible generated content for every `action_type`, not an error or empty content.
