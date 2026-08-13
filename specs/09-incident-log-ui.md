# Spec 09 — Incident Log UI

**Status:** built directly in response to user feedback during manual UI testing, not part of the original spec pipeline — added here after the fact to keep the docs honest, same discipline as specs 00-08.
**Builds on:** `specs/01-database-schema.md`, `specs/05-review-queue-ui.md` (shares its query/pagination pattern and row presentation).
**Integrates with:** reads `incidents` + `risk_classifications` + `agent_actions` for `decision IN ('auto_approve', 'block')`, via `getIncidentsByDecision()` in `lib/supabase/queries.ts`. No writes. Linked from the clickable stat tiles on `app/page.tsx` and `app/dashboard/DashboardClient.tsx`, and from the main nav (`app/NavBar.tsx`).

## Why This Exists

`specs/05`'s review queue only ever shows `escalate` incidents — by design, that's the only decision awaiting a human. But `auto_approve` and `block` are both real, already-final decisions with their own full reasoning and evidence trail, and before this spec there was no way to see them after the fact except a raw SQL query. A CISO or clinical reviewer auditing the system needs to see what got blocked and why, not just what's pending.

## File

`app/incidents/page.tsx`, `IncidentLogTable.tsx`, `IncidentLogRow.tsx`, `PaginationControls.tsx`.

## Priority

P1 — an auditability/trust feature, not required to demonstrate the core guardrail loop (`specs/05`/`specs/06` are P0).

## Data

Table bound to `incidents` filtered on `decision = 'auto_approve'` or `decision = 'block'` (toggle, one at a time via `?decision=`), joined to `risk_classifications` and `agent_actions` — same shape as `specs/05`'s `EscalatedIncident` (now generalized to `IncidentDetail` in `lib/supabase/queries.ts`, shared by both views). Unlike the review queue, nothing here is excluded — `auto_approve`/`block` never route through `review_decisions` in the first place (that table only exists for escalated incidents a human actually decided on), so there's no "already handled" row to filter out.

Ordered **newest first** (`created_at DESC`) — deliberately the opposite of the review queue's oldest-first FIFO. This is a history log a reviewer skims for recent activity, not a work queue processed in submission order.

Paginated identically to `specs/05` (`INCIDENT_LIST_PAGE_SIZE` = 25, `?page=`), including the same head-count-before-range fix (`lib/supabase/queries.ts`'s `fetchIncidentsByDecision`) so a stale/out-of-range page link degrades to a friendly message instead of a PostgREST "Requested range not satisfiable" error.

## Workflow

1. Reviewer clicks a "Blocked" or "Auto-approved" stat number on the landing page or dashboard (or "Incidents" in the main nav, which defaults to the Blocked tab).
2. Page loads incidents for that decision, newest first, with the same risk-tier/injection filters and time/risk sort as the review queue (`IncidentLogTable`, same client-side filter/sort convention as `ReviewQueueTable`).
3. Reviewer clicks a row to expand full detail: payload, reasoning, evidence sources — identical presentation to `specs/05`'s expanded incident view.
4. That's the whole workflow. No decision to make, no form, no write.

## Behavior

- **Read-only, deliberately.** `auto_approve` and `block` are terminal Policy Engine decisions (`specs/02-policy-engine.md`) — there's nothing here for a human to change, and no UI affordance suggests otherwise (no Approve/Reject buttons, no reviewer-name field).
- Same row layout as the review queue's fixed 5-column grid (risk tier / action type / injection icon / content preview / timestamp) and left accent stripe per risk tier — one visual language across both views (`lib/ui/incident-display.ts` is the shared source for badge/border classes and formatting).
- `agent_actions.payload.content` renders as inert text, same as `specs/05`'s Edge Case — this view is exactly as capable of displaying adversarial content as the review queue is, so the same "never interpret it" rule applies.
- Gated behind the same reviewer Basic Auth as `/review-queue` and `/dashboard` (`middleware.ts`) — this is the same sensitive payload/reasoning data, not a public surface.

## Edge Cases

- **Invalid or missing `?decision=`:** falls back to `block` rather than erroring — a reviewer landing here from the nav link (no query string) should see something meaningful, not a blank/error state.
- **`?page=` past the last page:** same handling as `specs/05` — a distinct "no incidents on page N" message with a link back to page 1, not the same copy as a genuinely empty decision bucket.
- **Injection filter on the "Blocked" tab is meaningful; on "Auto-approved" it's always empty.** Per the Policy Engine, an injection-flagged action always routes to `block`, never `auto_approve` — so filtering "Flagged" on the Auto-approved tab correctly returns nothing every time. Not a bug, same reasoning as why "Flagged" returns nothing on the review queue at all (`specs/05`'s incidents never carry `injection_flag = true` either, for the same reason).

## Metric This View Supports

Auditability/trust — no PRD-numbered metric, but directly supports `docs/rflx_PRD.md`'s "full audit trail" claim: every decision the system makes is inspectable after the fact, not just the ones awaiting review.

## Acceptance Criteria

- [x] `/incidents?decision=block` shows every incident with `decision = 'block'`, newest first, paginated at 25/page.
- [x] `/incidents?decision=auto_approve` shows every incident with `decision = 'auto_approve'`, same pagination.
- [x] No write affordance anywhere on this page — no Approve/Reject, no reviewer-name field, no way to submit anything.
- [x] Gated behind reviewer Basic Auth, same as `/review-queue` and `/dashboard`.
- [x] An out-of-range `?page=` shows a distinct message with a link back to page 1, not a crash and not the empty-decision-bucket message.
- [x] Landing page and dashboard stat tiles for `auto_approve`/`block`/`escalate` link to the correct destination (`/incidents?decision=X` or `/review-queue`).
