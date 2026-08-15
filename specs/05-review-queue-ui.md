# Spec 05 — Review Queue UI

**Builds on:** `specs/01-database-schema.md`.
**Integrates with:** reads `incidents` + `risk_classifications` + `agent_actions`, writes `review_decisions`, via the already-scaffolded helpers in `lib/supabase/queries.ts` (`getEscalatedIncidents`, `submitReviewDecision`). Uses `docs/design.md` tokens throughout (`skills/design-system/SKILL.md` enforces this). `submitReviewDecision`'s signature needs extending for the two new fields below (`specs/01-database-schema.md`'s `review_decisions.classification_agreement`/`.reason_code`) — a Build-stage change, not yet reflected in `lib/supabase/queries.ts` as of this spec update.

## File

`app/review-queue/page.tsx`, currently a scaffolded stub with placeholder text. This spec is what replaces the stub body.

## Priority

P0 — this is what makes "escalate" a demonstrable outcome, not just a database row. Build before the dashboard (`specs/06-dashboard-ui.md`).

## Data

Table bound to `incidents` filtered on `decision = 'escalate'`, joined to `risk_classifications` for `reasoning` and `evidence_sources`, and the original `agent_actions.payload` for context — exactly what `getEscalatedIncidents()` in `lib/supabase/queries.ts` already returns as `EscalatedIncident[]` (an `Incident` with `risk_classification` and `agent_action` attached). This page is a Server Component that calls `getEscalatedIncidents()` directly — it does not fetch through the Gateway API and does not use the browser Supabase client.

## Workflow

1. Reviewer navigates to `/review-queue`.
2. Page loads incidents with `decision = 'escalate'` that have no `review_decisions` row yet, ordered oldest-first by default, paginated at `INCIDENT_LIST_PAGE_SIZE` (25) per page via a `?page=` search param — the full matching set can be large (800+ pending incidents verified live), and the header shows the total pending count for whatever's currently filtered, not just the current page. `?from=`/`?to=` (date-only, native `<input type="date">`), `?risk=` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), and `?injection=` (`flagged`/`clear`) narrow the set; `?sort=`/`?dir=` (`created_at`|`risk_tier`, `asc`|`desc`) override the default order. All of it is server-side (`lib/supabase/queries.ts`'s `getEscalatedIncidents`) — an earlier version filtered/sorted client-side over just the current page's already-fetched 25 rows, which silently only ever affected that one page, never the full backlog.
   - **Change note:** `risk_tier` sort orders on a generated `risk_rank` column (`supabase/migrations/0004`), not `risk_tier` text directly — that's plain text (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), so a naive order-by sorts alphabetically, not by clinical severity. The actual page fetch goes through a `list_incidents_by_decision()` SQL RPC (`supabase/migrations/0005`) rather than a plain PostgREST embedded-resource query — verified live, ordering `agent_actions` by an embedded `risk_classifications` column fails with PostgREST error `PGRST118` ("do not form a many-to-one or one-to-one relationship"), even with `!inner` and even though `action_id` is `UNIQUE`. Filtering the same embedded resource works fine (only ordering is affected), so the total-count query stays plain PostgREST.
3. Each row shows: `action_type`, `risk_tier` (colored per `docs/design.md`'s risk-tier tokens), `injection_flag` status, a summary of `reasoning`, and the originating `agent_actions.payload.content`.
4. Reviewer opens one incident to see full detail: complete `payload`, full `reasoning`, and every `evidence_sources` entry (tool name, query, finding).
5. Reviewer clicks Approve or Reject, optionally adding `notes`, and must also set two more fields before submitting (`docs/rflx_PRD.md` §6.1's reviewer-outcome calibration log):
   - **Classification agreement** — was `risk_classifications.risk_tier` for this incident correct, too low, or too high? A 3-way control (e.g. segmented buttons), not free text: `agreed | should_be_lower | should_be_higher`.
   - **Reason code** — a single-select from the closed enum in `specs/01-database-schema.md`: `correct_classification | overly_cautious | missed_clinical_context | fabricated_evidence_not_flagged | other`. Not a second free-text field — `notes` already covers open-ended commentary.
6. That action calls `submitReviewDecision(incidentId, reviewerId, outcome, notes, classificationAgreement, reasonCode)` — a single insert into `review_decisions`. No other table is touched.
7. On success, the incident is removed from the visible queue (it now has a `review_decisions` row) and the reviewer returns to the list.

## Behavior

- Approve/reject buttons write a row to `review_decisions` (`reviewer_id`, `outcome`, optional `notes`, required `classification_agreement`, required `reason_code`) via `submitReviewDecision` — this insert is the only write this view performs; never update an existing `incidents` or `risk_classifications` row, and never call `submitReviewDecision` twice for the same incident from the UI (see Edge Cases for what happens if it's attempted anyway).
- `classification_agreement` and `reason_code` are required at the UI layer even though the schema column is nullable (`specs/01-database-schema.md`) — disable the submit control until both are set, same pattern as any other required-field form validation. This is capture-only: nothing in this build reads these two fields back (`docs/rflx_PRD.md` §6.3 defers the analysis loop), so don't build a filter/summary view of them here — that's explicitly out of scope for this pass.
- Show the injection flag status and risk tier prominently — per `docs/design.md`'s semantic color tokens, not ad hoc colors.
- Access should be scoped to the reviewer role via Supabase Row Level Security, not client-side checks alone (`skills/security-foundation/SKILL.md`). At MVP scope with no reviewer auth system built yet, `reviewer_id` is a free-text field or a hardcoded single-reviewer identity — not a gap to silently "fix" with a full auth system beyond what `docs/rflx_PRD.md`'s scope calls for.

## Edge Cases

- **`getEscalatedIncidents()`'s current query doesn't exclude incidents that already have a `review_decisions` row** — as written in `lib/supabase/queries.ts`, it only filters on `decision = 'escalate'`, so a reviewed incident would still appear in the list. Fix required: either add a `left join` + `is null` filter on `review_decisions`, or filter client-side after fetching. Without this fix, an already-decided incident stays visibly "pending" forever, which directly undermines the queue's purpose.
- **Two reviewers open the same incident concurrently and both submit a decision:** nothing at the database layer prevents two `review_decisions` rows for one `incident_id` (`specs/01`'s schema has no unique constraint there, by design — append-only). The UI should treat the *first* successful insert as authoritative, but a second submission will still succeed as a second row. Flagged as an accepted MVP limitation, not silently fixed with a constraint that would break the append-only model — a future pass could add a unique index on `review_decisions.incident_id` if single-reviewer-only becomes a hard requirement.
- **`agent_actions.payload.content` contains the injection text itself:** the review queue must render this as plain text/escaped content, never interpret it (e.g. never render it as HTML, never feed it back into any prompt from this view) — this is exactly the kind of adversarial content the guardrail exists to catch, and the UI displaying it is a read-only audit view, not another place for it to execute.
- **Queue is empty:** show an explicit "no actions awaiting review" state, not a blank page indistinguishable from a loading or error state.
- **`?page=` points past the last page** (e.g. enough incidents on it were reviewed since the link was generated): distinct from the empty-queue state above — shows "no incidents on page N" with a link back to page 1, not the same "no actions awaiting review" message, since the queue itself may still have pending incidents on earlier pages.
- **A filter combination (`from`/`to`/`risk`/`injection`) matches zero pending incidents:** distinct from both of the above — "back to page 1" would be misleading (page 1 of the *unfiltered* queue is exactly what the filter was meant to skip past), so this shows its own "no pending incidents match the current filters" message with a link that clears every filter.
- **`submitReviewDecision` fails (network/Supabase error):** show the failure to the reviewer and keep the incident in the queue — don't optimistically remove it from the list before the write is confirmed.

## Metric This View Supports

Reviewer time-to-decision (`docs/rflx_PRD.md` §1 secondary metric) — self-measured during the manual walkthrough, target <5 minutes. Keep the view scannable, not decorative — this is a working tool used repeatedly, not a landing page.

## Acceptance Criteria

- [ ] `/review-queue` shows every incident with `decision = 'escalate'` and no existing `review_decisions` row, and no others (verifies the fix to `getEscalatedIncidents()` above).
- [ ] Approving or rejecting an incident inserts exactly one `review_decisions` row with the correct `incident_id`, `reviewer_id`, `outcome`, `notes`, `classification_agreement`, and `reason_code`, and never modifies `incidents` or `risk_classifications`.
- [ ] Submit is disabled until both `classification_agreement` and `reason_code` are set; both are drawn from their closed enums (`specs/01-database-schema.md`), never free text.
- [ ] After a successful decision, the incident no longer appears in the queue on next load.
- [ ] Risk tier and decision-adjacent UI elements use only `docs/design.md`'s semantic color tokens (`--color-risk-*`) — checked by `/design-system` before ship, not just at build time.
- [ ] `agent_actions.payload.content` renders as inert text even when it contains injection-attempt phrasing (verify with one of `specs/08-eval-harness.md`'s adversarial cases rendered in the queue).
- [ ] Empty-queue and write-failure states are each visually distinct from the normal loaded state.
- [ ] `/review-queue?page=N` shows the correct 25-incident slice for that page, oldest-first overall (not just within a page), and the header's total pending count matches the full filtered set, not just the current page.
