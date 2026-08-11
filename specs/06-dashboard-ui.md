# Spec 06 — Dashboard UI

**Builds on:** `specs/01-database-schema.md`.
**Integrates with:** reads `incidents` in aggregate via `lib/supabase/queries.ts`'s `getIncidentCountsByDecision()`. Uses `docs/design.md` tokens throughout.

## File

`app/dashboard/page.tsx`, currently a scaffolded stub with placeholder text. This spec is what replaces the stub body.

## Priority

P1 — strengthens the demo narrative but the review queue (`specs/05-review-queue-ui.md`) alone already proves the core loop. Build second, and it's the first thing to cut if the Day 10 checkpoint (`docs/engineering/build-stages.md`) is missed.

## Data

Aggregate queries against `incidents`: total actions, block/escalate/auto_approve rate, one time-series chart of volume over time. `getIncidentCountsByDecision()` already returns the decision breakdown (`Record<Decision, number>`); a second, new query is needed for the time-series view (see Workflow). Recharts is sufficient — no heavier charting library needed.

## Workflow

1. CISO/reviewer navigates to `/dashboard`.
2. Page loads the current decision breakdown via `getIncidentCountsByDecision()` and renders it as summary stat tiles (`--text-2xl` per `docs/design.md`) plus a share-of-total breakdown (e.g. a simple bar or donut), using the decision color tokens (`--color-decision-*`).
3. Page loads a time-bucketed incident count (a new query, e.g. `getIncidentVolumeByDay()`, grouping `incidents` by `date_trunc('day', created_at)` and `decision`) and renders it as one time-series chart.
4. Reviewer can filter both views by decision type and by a time range (e.g. last 24h / 7d / 30d / all) — filters apply to both the stat tiles and the chart together, not independently, so the two views never show inconsistent time windows.

## Behavior

Read-only view, no writes. Filterable by decision type and time range at minimum.

## Edge Cases

- **No incidents yet (empty database or a very narrow time filter):** show an explicit zero/empty state on both the stat tiles and the chart — not a broken chart render or a misleading "0%" that reads as a real rate rather than "no data."
- **Time filter with no matching rows:** same empty state as above, distinct from the true-zero-incidents case if practical (e.g. "no incidents in this window" vs. "no incidents recorded yet"), but not required to be pixel-distinct — the key requirement is never rendering a chart axis or percentage computed from a zero denominator without guarding it.
- **Division-by-zero in rate calculations:** any "block/escalate/auto_approve rate" percentage must guard against a zero total (return `0%` or `—`, not `NaN` or `Infinity`) — this is a real, easy-to-miss bug in a stat tile built directly from `getIncidentCountsByDecision()`'s counts.
- **Large volume (thousands of incidents):** the time-series query must bucket and aggregate in SQL (`date_trunc` + `group by`, per the Workflow step above), not fetch every row and bucket client-side — `getIncidentCountsByDecision()`'s current implementation of fetching every `decision` column value and counting in application code is acceptable at MVP row counts but is exactly the pattern the time-series query must *not* copy at scale; flagged here so it isn't copy-pasted into a query that will actually see volume.

## Acceptance Criteria

- [ ] Stat tiles match `getIncidentCountsByDecision()`'s counts exactly for the selected time range.
- [ ] The time-series chart's bucketed counts sum to the same total as the stat tiles for the same filter state.
- [ ] Changing the decision-type filter or time-range filter updates both the stat tiles and the chart together, never one without the other.
- [ ] Zero-data states (no incidents at all, or none in the selected window) render an explicit empty state, not a `NaN`/broken chart.
- [ ] All color usage for decision breakdowns comes from `docs/design.md`'s `--color-decision-*` tokens, checked by `/design-system` before ship.
- [ ] No write operation exists anywhere on this page — verified by code review, not just by the absence of a button.
