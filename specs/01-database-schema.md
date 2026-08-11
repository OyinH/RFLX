# Spec 01 — Database Schema

**Builds on:** nothing — this is the foundation, build first.
**Integrates with:** every other spec reads or writes these tables. `specs/03-gateway-api.md` writes `agent_actions`/`risk_classifications`/`incidents`; `specs/04-investigator.md` reads `synthea_patients`/`synthea_medications`; `specs/05-review-queue-ui.md` reads/writes `review_decisions`; `specs/06-dashboard-ui.md` reads `incidents` in aggregate; `specs/00-mock-agent-simulator.md` and `specs/08-eval-harness.md` both read `synthea_patients`/`synthea_medications` as their source of realistic patient context.

This file covers two distinct kinds of table. Don't conflate them:
- **Audit trail tables** — `agent_actions`, `risk_classifications`, `incidents`, `review_decisions`. Written by rflx itself, append-only, the compliance-grade record.
- **Reference data tables** — `synthea_patients`, `synthea_medications`. Loaded once from Synthea's output (`skills/engineering-planner/SKILL.md`'s Test Data Setup section), read-only from the application's perspective, never written to by any spec in this pipeline.

**Canonical executable schema:** `/database.sql` (project root) — run that file to actually set up the database. The SQL blocks below show the core table shapes for reference; `database.sql` is the production-hardened, fully-commented version (adds `CHECK` constraints enforcing every closed enum in this file, `ON DELETE RESTRICT` on all foreign keys, and `COMMENT ON` documentation) and is kept in sync with `supabase/migrations/0001_init.sql` for the Supabase CLI. If the two ever appear to disagree, `database.sql` wins.

## Audit Trail Tables

```sql
create table agent_actions (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  action_type text not null,
  payload jsonb not null,
  source_channel text not null,
  created_at timestamptz default now()
);

create table risk_classifications (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references agent_actions(id),
  risk_tier text not null,
  injection_flag boolean not null,
  confidence numeric,
  reasoning text,
  evidence_sources jsonb not null default '[]'::jsonb, -- Array<{tool, query, finding}> — specs/04's investigator output; specs/05's review queue reads this
  input_tokens int,
  output_tokens int,
  estimated_cost_usd numeric,
  created_at timestamptz default now()
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references agent_actions(id),
  decision text not null, -- auto_approve | escalate | block
  latency_ms int,
  created_at timestamptz default now()
);

create table review_decisions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id),
  reviewer_id text,
  outcome text, -- approved | rejected
  notes text,
  classification_agreement text, -- agreed | should_be_lower | should_be_higher — reviewer's view of risk_classifications.risk_tier for this incident, not of the outcome above
  reason_code text, -- correct_classification | overly_cautious | missed_clinical_context | fabricated_evidence_not_flagged | other
  decided_at timestamptz default now()
);

-- Every join in specs/05 and specs/06 traverses these foreign keys — index them.
create index idx_risk_classifications_action_id on risk_classifications(action_id);
create index idx_incidents_action_id on incidents(action_id);
create index idx_review_decisions_incident_id on review_decisions(incident_id);

-- specs/05's review queue query and specs/06's dashboard aggregates both filter
-- on decision and order/bucket by created_at — index what's actually queried.
create index idx_incidents_decision on incidents(decision);
create index idx_incidents_created_at on incidents(created_at);
```

`lib/supabase/types.ts`'s `AgentAction` / `RiskClassification` / `Incident` / `ReviewDecision` types are the TypeScript mirror of these four tables — keep both in sync; the TS file's header comment says as much. `ReviewDecision` needs `classification_agreement` and `reason_code` added — not yet reflected in `lib/supabase/types.ts` as of this spec update, since that's a Build-stage change, not this one.

**`classification_agreement` and `reason_code` (added post-MVP, `docs/rflx_PRD.md` §6.1's reviewer-outcome calibration log):** nullable at the schema level — same convention as `outcome` above (which itself is nullable but `CHECK`-constrained to its two valid values), so existing pre-feature `review_decisions` rows don't need a backfill migration. Not `NOT NULL` — required-ness is enforced at submission time by `specs/05-review-queue-ui.md`'s UI and re-validated in the Server Action (a Server Action is a callable endpoint, not a client-trusted form). *Is* `CHECK`-constrained to its closed enum when non-null, same as `outcome` — a value can be absent, never invalid. `classification_agreement` records whether the reviewer thinks `risk_classifications.risk_tier` for this incident was correct, too low, or too high — independent of `outcome` (a reviewer can *approve* an action while still flagging its risk tier as too high, or *reject* one while agreeing the tier was right). `reason_code` is the closed-enum "why" behind that judgment. Neither field is read by any other spec yet — they're captured for the deferred calibration loop (`docs/rflx_PRD.md` §6.3), not consumed anywhere in this build.

## Reference Data Tables (Synthea-loaded, read-only)

Not in the original spec pass — added because `specs/04-investigator.md`'s `get_patient_current_medications` tool and the fairness stratification design (`docs/engineering/architecture.md`'s Evaluation Framework section) both assume this data exists in Supabase, but no spec defined its shape until now.

```sql
create table synthea_patients (
  patient_context_id text primary key,  -- Synthea's generated patient UUID, used verbatim, never regenerated
  birth_date date not null,
  age_band text not null,               -- derived at load time from birth_date, not a raw Synthea field: '0-17' | '18-34' | '35-49' | '50-64' | '65+'
  sex text not null,                    -- Synthea's coded value verbatim, e.g. 'M' | 'F'
  race text,                            -- Synthea's coded value verbatim, e.g. 'white' | 'black' | 'asian' | 'native' | 'other'
  ethnicity text,                       -- Synthea's coded value verbatim, e.g. 'hispanic' | 'nonhispanic'
  created_at timestamptz default now()
);

create table synthea_medications (
  id uuid primary key default gen_random_uuid(),
  patient_context_id text not null references synthea_patients(patient_context_id),
  name text not null,
  dose text,
  start_date date,
  stop_date date  -- null means still active; specs/04's get_patient_current_medications filters on this
);

create index idx_synthea_medications_patient on synthea_medications(patient_context_id);
```

`age_band`, `sex`, and `race` are exactly the three fairness stratification dimensions `docs/engineering/architecture.md` and `docs/engineering/data-model.md` reference — this table is where they physically live. The load script (Synthea CSV → these two tables) is out of scope for this spec; see `skills/engineering-planner/SKILL.md`'s Test Data Setup section for the generation/loading steps. `age_band` specifically must be computed by that load script from `birth_date`, not copied from a Synthea column — Synthea doesn't emit an age-band field directly.

## Rules

- `incidents` and `review_decisions` are append-only. No UPDATE, no DELETE, ever — not even for corrections. If a decision was wrong, a new row/process handles it; the record never changes retroactively.
- `payload` is `jsonb`, never a raw string — validate its shape against `specs/03-gateway-api.md`'s request schema before insert, don't trust it blind.
- No real PHI in `payload` or anywhere else in these tables, in any environment, including local dev (`skills/security-foundation/SKILL.md`). This applies equally to `synthea_patients`/`synthea_medications` — Synthea output is synthetic by construction, but never substitute a real patient export into these tables even for a quick local test.
- `synthea_patients` / `synthea_medications` are never written to by the Gateway API, the investigator, the review queue, or the dashboard — only by the one-time load script. If a spec ever needs to write to them, that's a signal the data model has changed and this file needs updating first.

## Access Control

All application access to every table in this file goes through the service-role client (`lib/supabase/server.ts`, guarded by the `server-only` package) from Route Handlers / Server Components — never the browser client (`lib/supabase/client.ts`) for anything beyond a future authenticated read explicitly designed for it. Enable RLS on every table with **no permissive policies by default** — the service-role key bypasses RLS entirely by design, so this is a deliberate default-deny backstop for the anon/authenticated roles, not the primary access control mechanism:

```sql
alter table agent_actions enable row level security;
alter table risk_classifications enable row level security;
alter table incidents enable row level security;
alter table review_decisions enable row level security;
alter table synthea_patients enable row level security;
alter table synthea_medications enable row level security;
-- No policies created here on purpose: default-deny for anon/authenticated roles.
-- If a future screen ever reads directly from the browser client, add an
-- explicit, narrowly-scoped SELECT policy for that table at that time —
-- don't pre-emptively open access this MVP doesn't use yet.
```

See `skills/security-foundation/SKILL.md` for the full audit checklist this gets checked against before ship.

## Edge Cases

- **Orphaned reads mid-write:** the Gateway API (`specs/03`) writes `agent_actions` → `risk_classifications` → `incidents` as three sequential inserts, not one transaction. If the process crashes between the first and third insert, a reader could see an `agent_actions` row with no `incidents` row yet. The review queue and dashboard queries only ever read from `incidents` outward (never list bare `agent_actions`), so a dangling `agent_actions` row is invisible to both UIs and simply orphaned — acceptable for MVP, but don't build a feature that lists `agent_actions` directly without accounting for this.
- **`review_decisions` referencing a non-escalated incident:** the schema doesn't enforce `incidents.decision = 'escalate'` at the database level for a `review_decisions` row — that's enforced by `specs/05`'s UI only ever offering review actions for escalated incidents. A malformed insert (e.g. from a future API misuse) could technically attach a review decision to an auto-approved incident; not blocked at the schema layer, flagged here so it isn't a silent surprise later.
- **`synthea_patients` with no medications:** `synthea_medications` has no NOT NULL/existence constraint tying every patient to at least one medication — a patient with no active prescriptions is valid and common. `specs/04`'s `get_patient_current_medications` must return an empty list, not an error, for such a patient.
- **Duplicate `patient_context_id` on reload:** re-running the Synthea load script against an already-populated `synthea_patients` table will violate the primary key constraint on the second run. The load script (out of scope here) needs an explicit upsert or truncate-and-reload strategy — flagged so whoever builds it doesn't discover this by trial and error.

## Acceptance Criteria

- [ ] All six tables exist in Supabase with exactly the columns, types, and constraints above.
- [ ] `lib/supabase/types.ts`'s TS types match this file's SQL column-for-column (already true for the four audit tables as of `/frontend-setup`; must be extended to cover `synthea_patients`/`synthea_medications` when the investigator/mock-agent/eval-harness specs are implemented).
- [ ] Inserting into `incidents` or `review_decisions` twice for the same logical event produces two rows, not an upsert — confirms append-only behavior.
- [ ] Attempting an UPDATE or DELETE against `incidents` or `review_decisions` via the service-role client succeeds at the database level (RLS doesn't block service-role) but is never invoked anywhere in application code — verified by code review, not a runtime constraint, since Postgres-level immutability isn't enforced here (documented limitation, not a gap to silently fix with triggers unless a future pass decides otherwise).
- [ ] RLS is enabled on all six tables; a query against any of them using the anon key (not service-role) returns zero rows, not an error and not real data.
- [ ] The five indexes above exist; `EXPLAIN` on `specs/05`'s review-queue query and `specs/06`'s dashboard aggregate query shows index usage, not a sequential scan, once the tables have non-trivial row counts.
- [ ] `review_decisions.classification_agreement` and `.reason_code` exist as nullable `text` columns, each `CHECK`-constrained to its closed enum (same pattern as `outcome`); inserting a row via `submitReviewDecision` (`specs/05`) always populates both going forward, enforced by both UI-layer and Server Action-layer validation, not only the database constraint.
