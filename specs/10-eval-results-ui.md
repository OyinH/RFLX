# Spec 10 — Eval Results UI

**Status:** built directly in response to user feedback, not part of the original spec pipeline — added here after the fact to keep the docs honest, same discipline as specs 00-09.
**Builds on:** `specs/08-eval-harness.md` (this is a read-only viewer over that harness's output, not a new scoring implementation).
**Integrates with:** reads the committed `eval/results.csv`, via `lib/eval/csv.ts` (parse/format) and `lib/eval/score.ts` (`computeEvalSummary`) — the exact same modules `eval/run.ts` imports for its own terminal output, so the two can never silently disagree on a number. No Supabase, no new table.

## Why This Exists

rflx.ai's whole premise is monitoring what other AI agents are doing. This page is the same idea turned on rflx itself: visible, no-prompting-required access to how the guardrail is performing against its own Go/No-Go baseline (catch rate ≥90%, false-positive rate <10%, P95 latency <13000ms — `specs/08-eval-harness.md`), not just a terminal printout or a CSV someone has to open and read by hand.

## File

`app/eval/page.tsx`, `app/eval/EvalResultsView.tsx`, `app/api/eval/download/route.ts`, `lib/eval/csv.ts`, `lib/eval/score.ts`.

## Priority

P1 — auditability/trust, same tier as `specs/09-incident-log-ui.md`. Not required for the core guardrail loop, but flagged by the user as a major part of the product's value proposition (visibility into rflx's own accuracy, not just the agents it screens).

## Data

`eval/results.csv` — the file `npm run eval` already writes, one row per case (100 rows: 40 injection, 60 benign), columns unchanged from `specs/08-eval-harness.md`'s Runner Behavior. `lib/eval/csv.ts` is the single source of truth for that column order/escaping now — both the writer (`eval/run.ts`) and the readers (this page, the download route) go through it, so a column can't be added on one side and silently misread on the other.

`lib/eval/score.ts`'s `computeEvalSummary()` is the single source of truth for the actual Go/No-Go math (catch rate, false-positive rate, P95 latency, catch-rate-by-strategy×harm-stratum, false-positive-rate-by-fairness-dimension) — `eval/run.ts`'s terminal summary is now a thin `console.log` wrapper around the same function this page calls. Verified live: running the shared modules against a real committed `eval/results.csv` reproduced the terminal's printed numbers exactly (100.0% catch rate, 0.0% FP rate, 7145ms P95, PASS), and a format→parse round-trip of the CSV is lossless.

## Workflow

1. Someone (not necessarily via an assistant) navigates to `/eval`.
2. Page reads `eval/results.csv` from disk and renders: a Go/No-Go PASS/FAIL banner, three metric tiles (catch rate, false-positive rate, P95 latency) each showing actual vs. its own target and colored pass/fail independently — a mixed result (e.g., catch rate passing but FP rate failing) is visible at a glance, not flattened into one banner.
3. A bar chart for catch rate by injection strategy × harm stratum, and a table for false-positive rate by fairness dimension (age band, sex, race) — same breakdowns the terminal prints, same data.
4. Any errored cases (Gateway API failure/timeout during the run) get their own list, same as the terminal's "case(s) errored" section.
5. Two download buttons: CSV (byte-identical to the committed file) and JSON (same rows, parsed).
6. That's the whole workflow — read-only, no write affordance, no way to trigger a run from the page (see Edge Cases below).

## Behavior

- **Deliberately NOT `force-dynamic`, unlike review-queue/dashboard/incidents.** Those pages read live Supabase data that changes on every request; this page reads a file that only changes between deploys. A static prerender at build time is the *correct* behavior here, not a bug to fix — it's also faster (served from Netlify's CDN) than a per-request file read would be.
- Gated behind the same reviewer Basic Auth as `/review-queue`/`/dashboard`/`/incidents` (`middleware.ts`) — this is the same class of sensitive data (system accuracy against its own safety baseline), not a public surface. `/api/eval/download` is gated identically.
- Go/No-Go banner and per-metric pass/fail coloring reuse `--color-decision-approve`/`--color-decision-block` (green/red) — `docs/design.md`'s Change Process note on this: a Go/No-Go verdict isn't a `decision` enum value, but the intent (functional pass/fail signal) is identical, and a separate token pair for the same two colors would just be two names for one thing.
- "Last run" timestamp comes from `eval/results.csv`'s file mtime, shown plainly so the page is honest about its own freshness — the eval suite isn't wired to CI (`CLAUDE.md`'s Build and Test Commands), so this only reflects whatever was last committed, not live/real-time accuracy.

## Edge Cases

- **`eval/results.csv` doesn't exist yet** (fresh clone, before the first `npm run eval`): distinct empty state — "No eval results yet. Run `npm run eval`..." — not a crash, not the same message as a load error.
- **File read fails for any other reason** (permissions, corrupt file, header mismatch from a stale schema): shows a load-error state with the actual error message, same pattern as every other page's `loadError` handling in this app.
- **CSV header doesn't match the current schema** (e.g., someone hand-edits the file, or an old-format file survives a schema change): `parseEvalResultsCsv` throws explicitly rather than silently misreading columns — surfaces as the load-error state above with a message pointing at re-running the suite, not a page that renders wrong numbers with no indication anything's off.
- **No way to trigger a run or see a live-in-progress run from this page, on purpose.** 100 sequential cases at several seconds each is a multi-minute job that doesn't fit a normal request/response cycle on Netlify's serverless functions — this page is a viewer for the last committed result, not a job runner. Running the suite is still `npm run eval` from a terminal.
- **No history across runs.** Each `npm run eval` overwrites `eval/results.csv` in place (unchanged from `specs/08`'s existing behavior) — this page only ever shows the most recent run, not a trend over time. Adding that would mean persisting runs to Supabase, a deliberate architecture decision `docs/engineering/data-model.md` explicitly calls out as out of scope ("the file is the record") — revisit only if trend-tracking becomes a real need, not as a default extension of this page.

## Metric This View Supports

Self-auditability — no PRD-numbered metric, but directly supports the same "full audit trail" claim `specs/09-incident-log-ui.md` supports for production incidents, applied to the guardrail's own accuracy against its stated baseline instead.

## Acceptance Criteria

- [x] `/eval` renders the Go/No-Go verdict, all three metric tiles with actual-vs-target, the strategy×harm-stratum breakdown, and the fairness-dimension breakdown, sourced from the committed `eval/results.csv`.
- [x] The numbers shown match `npm run eval`'s terminal output exactly, computed by the same `lib/eval/score.ts` function both call — verified live against a real run (100.0%/0.0%/7145ms/PASS, identical on both sides).
- [x] CSV download is byte-identical to `eval/results.csv`; JSON download is the same 100 rows, correctly typed, verified live.
- [x] Gated behind reviewer Basic Auth, same as `/review-queue`/`/dashboard`/`/incidents` — verified live, both `/eval` and `/api/eval/download` return 401 without credentials.
- [x] Missing-file and load-error states are each distinct from the normal loaded state.
