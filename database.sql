-- ============================================================================
-- rflx.ai — Database Schema
-- ============================================================================
-- Complete, production-ready schema for the rflx.ai clinical AI agent
-- guardrail middleware. Derived from:
--   - docs/engineering/data-model.md      (entities, relationships)
--   - docs/engineering/architecture.md    (evaluation/fairness reference data)
--   - specs/01-database-schema.md         (exact column-level contract)
--   - specs/02-policy-engine.md           (closed enums this schema enforces)
--   - specs/06-dashboard-ui.md            (get_incident_volume_by_day())
--
-- This is the canonical, executable version of that contract — run this file
-- (SQL Editor, `psql -f database.sql`, or equivalent) against a fresh Supabase
-- Postgres database to fully provision it. Every statement is idempotent
-- (`if not exists` / `create or replace`), so re-running is safe.
--
-- Kept in sync with supabase/migrations/0001_init.sql (identical DDL, in the
-- Supabase CLI's migration-folder convention for `supabase db push` — the
-- CLI requires real SQL there, not a pointer to this file).
--
-- NOT included here: seed/test data. supabase/seed.sql separately loads a
-- small set of synthetic patients for the eval suite (specs/08-eval-harness.md)
-- — a production database setup should never silently seed fake patients, so
-- that stays a deliberate, separate, optional step.
--
-- Non-negotiables this schema enforces (CLAUDE.md, skills/security-foundation):
--   - No real PHI, ever, in any environment — every table here holds either
--     rflx's own audit trail or 100% synthetic Synthea-derived data.
--   - `incidents` and `review_decisions` are append-only — enforced by
--     convention in application code (no UPDATE/DELETE statement exists
--     anywhere in the codebase), not by a database trigger; documented here
--     as a deliberate, currently-accepted limitation.
--   - Row Level Security is enabled on every table with no permissive
--     policies — the service-role key (server-only) bypasses RLS by design;
--     this is a default-deny backstop for the anon/authenticated roles.
-- ============================================================================

-- gen_random_uuid() is native to Postgres 13+ (Supabase runs 15+), so this is
-- a defensive no-op on Supabase — included for portability to any other
-- Postgres host running this file.
create extension if not exists pgcrypto;

-- ============================================================================
-- Audit trail tables
-- Written by rflx itself, one row per event, never updated or deleted.
-- agent_actions (1) ──< risk_classifications (1)
-- agent_actions (1) ──< incidents (1) ──< review_decisions (0 or 1)
-- ============================================================================

create table if not exists agent_actions (
  id              uuid primary key default gen_random_uuid(),
  agent_id        text not null,
  action_type     text not null
    check (action_type in (
      'draft_note', 'update_medication', 'schedule_referral',
      'message_patient', 'export_record', 'update_problem_list'
    )),
  payload         jsonb not null,
  source_channel  text not null
    check (source_channel in ('direct_input', 'patient_portal_message', 'ingested_document')),
  created_at      timestamptz not null default now()
);

comment on table agent_actions is
  'Source record — one row per action a clinical agent submits to the Gateway API (specs/03-gateway-api.md). Foundation table; every other audit table traces back to this one.';
comment on column agent_actions.action_type is
  'Closed enum (specs/02-policy-engine.md). Adding a value requires updating the risk taxonomy and policy rule table in the same change.';
comment on column agent_actions.payload is
  'Validated against specs/03-gateway-api.md''s request schema before insert — never trusted raw. Never contains real PHI (synthetic data only).';

create table if not exists risk_classifications (
  id                  uuid primary key default gen_random_uuid(),
  action_id           uuid not null unique references agent_actions(id) on delete restrict,
  risk_tier           text not null
    check (risk_tier in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  injection_flag      boolean not null,
  confidence          numeric
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  reasoning           text,
  evidence_sources    jsonb not null default '[]'::jsonb,
  input_tokens        int
    check (input_tokens is null or input_tokens >= 0),
  output_tokens       int
    check (output_tokens is null or output_tokens >= 0),
  estimated_cost_usd  numeric
    check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  created_at          timestamptz not null default now(),
  risk_rank           smallint generated always as (
    case risk_tier
      when 'LOW' then 1
      when 'MEDIUM' then 2
      when 'HIGH' then 3
      when 'CRITICAL' then 4
    end
  ) stored
);

comment on table risk_classifications is
  'Layer 2 (bounded investigator) output for one agent_actions row — risk tier, injection flag, reasoning, evidence, and token cost. One-to-one with agent_actions (specs/04-investigator.md). action_id is UNIQUE so PostgREST recognizes this as a true 1:1 relationship and embeds it as a single object, not an array, in specs/05-review-queue-ui.md''s query.';
comment on column risk_classifications.confidence is
  '0.0-1.0 self-assessed confidence. Below the threshold in specs/04-investigator.md (0.6 as of that spec), the Gateway API''s fail-closed rule forces the decision to escalate regardless of risk_tier.';
comment on column risk_classifications.evidence_sources is
  'Array<{tool, query, finding}> from the investigator''s tool calls (specs/04-investigator.md) — never fabricated by the model, only ever populated from real tool call/response pairs by application code.';
comment on column risk_classifications.risk_rank is
  'Generated clinical-severity rank (LOW=1..CRITICAL=4) — risk_tier is plain text, so ordering directly on it sorts alphabetically (CRITICAL, HIGH, LOW, MEDIUM), not by severity. Review Queue/Incident Log "sort by risk" (specs/05, specs/09) orders on this column instead.';

create table if not exists incidents (
  id          uuid primary key default gen_random_uuid(),
  action_id   uuid not null unique references agent_actions(id) on delete restrict,
  decision    text not null
    check (decision in ('auto_approve', 'escalate', 'block')),
  latency_ms  int
    check (latency_ms is null or latency_ms >= 0),
  created_at  timestamptz not null default now()
);

comment on table incidents is
  'The Policy Engine''s deterministic decision for one agent_actions row (specs/02-policy-engine.md). One-to-one with agent_actions (action_id is UNIQUE — see risk_classifications'' comment for why). Append-only — the compliance-grade audit record alongside review_decisions.';

create table if not exists review_decisions (
  id                       uuid primary key default gen_random_uuid(),
  incident_id              uuid not null references incidents(id) on delete restrict,
  reviewer_id              text,
  outcome                  text
    check (outcome is null or outcome in ('approved', 'rejected')),
  notes                    text,
  classification_agreement text
    check (classification_agreement is null or classification_agreement in ('agreed', 'should_be_lower', 'should_be_higher')),
  reason_code              text
    check (reason_code is null or reason_code in (
      'correct_classification', 'overly_cautious', 'missed_clinical_context',
      'fabricated_evidence_not_flagged', 'other'
    )),
  decided_at               timestamptz not null default now()
);

comment on table review_decisions is
  'A human reviewer''s outcome for an escalated incident (specs/05-review-queue-ui.md). Zero or one per incident *by convention*, not by constraint — incident_id is deliberately NOT unique (specs/01''s Edge Cases): two reviewers submitting near-simultaneously both succeed as separate rows rather than one hitting a constraint violation; the UI treats the first successful insert as authoritative. Not constrained at the database layer to incidents.decision = ''escalate'' either — enforced by the review queue UI only ever offering review actions for escalated incidents.';

comment on column review_decisions.classification_agreement is
  'Reviewer-outcome calibration log (docs/rflx_PRD.md §6.1, added post-MVP). Whether the reviewer thinks risk_classifications.risk_tier for this incident was correct, too low, or too high — independent of outcome above. Nullable, no CHECK-enforced NOT NULL: required at the UI layer (specs/05) so existing rows don''t need a backfill migration. Capture-only — nothing reads this back yet; the analysis/tuning loop is deferred (docs/rflx_PRD.md §6.3).';

comment on column review_decisions.reason_code is
  'Closed-enum "why" behind classification_agreement above, same reviewer-outcome calibration log. Nullable for the same backfill reason. Capture-only, not yet consumed anywhere.';

-- Every join in specs/05 (review queue) and specs/06 (dashboard) traverses
-- these foreign keys or filters/sorts on these columns — index what's queried.
create index if not exists idx_risk_classifications_action_id on risk_classifications(action_id);
create index if not exists idx_risk_classifications_risk_rank on risk_classifications(risk_rank);
create index if not exists idx_incidents_action_id on incidents(action_id);
create index if not exists idx_review_decisions_incident_id on review_decisions(incident_id);
create index if not exists idx_incidents_decision on incidents(decision);
create index if not exists idx_incidents_created_at on incidents(created_at);

-- ============================================================================
-- Reference data tables — Synthea-loaded, read-only from the application's
-- perspective. Never written to by the Gateway API, investigator, review
-- queue, or dashboard — only by the one-time Synthea load script
-- (skills/engineering-planner/SKILL.md's Test Data Setup; out of scope here).
-- ============================================================================

create table if not exists synthea_patients (
  patient_context_id  text primary key,
  birth_date          date not null,
  age_band            text not null
    check (age_band in ('0-17', '18-34', '35-49', '50-64', '65+')),
  sex                 text not null,
  race                text,
  ethnicity           text,
  created_at          timestamptz not null default now()
);

comment on table synthea_patients is
  'Synthea-derived synthetic patients — never real PHI. patient_context_id is Synthea''s generated UUID, used verbatim. age_band/sex/race are the three fairness stratification dimensions (docs/engineering/architecture.md''s Evaluation Framework section).';
comment on column synthea_patients.age_band is
  'Derived at load time from birth_date, not a raw Synthea field — the load script must compute this.';

create table if not exists synthea_medications (
  id                   uuid primary key default gen_random_uuid(),
  patient_context_id   text not null references synthea_patients(patient_context_id) on delete restrict,
  name                 text not null,
  dose                 text,
  start_date           date,
  stop_date            date
);

comment on table synthea_medications is
  'Synthea-derived synthetic medications, read by specs/04-investigator.md''s get_patient_current_medications tool. stop_date is null for an active medication; a patient with none active is valid, not an error.';

create index if not exists idx_synthea_medications_patient on synthea_medications(patient_context_id);

-- ============================================================================
-- Dashboard support — specs/06-dashboard-ui.md requires the time-series view
-- to bucket/aggregate in SQL, not fetch every row and bucket client-side.
-- Called via supabase.rpc('get_incident_volume_by_day', ...) from
-- lib/supabase/queries.ts's getIncidentVolumeByDay().
-- ============================================================================

create or replace function get_incident_volume_by_day(start_ts timestamptz, end_ts timestamptz)
returns table (day date, decision text, count bigint)
language sql
stable
as $$
  select date_trunc('day', created_at)::date as day, decision, count(*) as count
  from incidents
  where created_at >= start_ts and created_at < end_ts
  group by 1, 2
  order by 1;
$$;

comment on function get_incident_volume_by_day(timestamptz, timestamptz) is
  'Dashboard time-series aggregate (specs/06-dashboard-ui.md) — buckets incident counts by day and decision in SQL so the query scales with volume instead of shipping every row to the client.';

-- Same fix shape as get_incident_volume_by_day above: the stat-tile counts
-- were previously computed by fetching every matching `incidents` row
-- (select "decision" with no limit) and counting client-side in JS —
-- PostgREST's default max_rows (1000) silently truncates an unbounded
-- select rather than erroring, so this would have quietly undercounted past
-- that many incidents with no indication anything was wrong.
create or replace function get_incident_counts_by_decision(start_ts timestamptz, end_ts timestamptz)
returns table (decision text, count bigint)
language sql
stable
as $$
  select decision, count(*) as count
  from incidents
  where created_at >= start_ts and created_at < end_ts
  group by 1
  order by 1;
$$;

comment on function get_incident_counts_by_decision(timestamptz, timestamptz) is
  'Dashboard stat-tile aggregate (specs/06-dashboard-ui.md) — counts incidents by decision in SQL instead of fetching every row and counting client-side, so the query scales with volume rather than being silently truncated by PostgREST''s default max_rows.';

-- Review Queue / Incident Log page fetch (specs/05, specs/09) — an RPC rather than a
-- plain PostgREST embedded-resource query because ordering agent_actions by an
-- embedded risk_classifications column fails at the PostgREST layer: verified live,
-- PGRST118 ("'agent_actions' and 'risk_classifications' do not form a many-to-one or
-- one-to-one relationship"), even with `!inner` and even though action_id is UNIQUE —
-- PostgREST determines relationship direction from which table holds the FK, and reads
-- this as one-to-many for order-by purposes regardless of the unique constraint.
-- Filtering the same embedded resource works fine (only ordering is affected), so
-- lib/supabase/queries.ts keeps a plain PostgREST head-count query for totals and
-- routes only the actual page fetch through this function, which does a real SQL join
-- with a real ORDER BY and has no such ambiguity.
create or replace function list_incidents_by_decision(
  p_decision text,
  p_exclude_reviewed boolean,
  p_start_ts timestamptz,
  p_end_ts timestamptz,
  p_risk_tier text,
  p_injection_flag boolean,
  p_sort_field text,
  p_sort_ascending boolean,
  p_limit int,
  p_offset int
)
returns table (
  agent_action jsonb,
  incident jsonb,
  risk_classification jsonb
)
language sql
stable
as $$
  select
    to_jsonb(aa) as agent_action,
    to_jsonb(i) as incident,
    to_jsonb(rc) as risk_classification
  from agent_actions aa
  join incidents i on i.action_id = aa.id
  join risk_classifications rc on rc.action_id = aa.id
  where i.decision = p_decision
    and (
      not p_exclude_reviewed
      or not exists (select 1 from review_decisions rd where rd.incident_id = i.id)
    )
    and (p_start_ts is null or aa.created_at >= p_start_ts)
    and (p_end_ts is null or aa.created_at < p_end_ts)
    and (p_risk_tier is null or rc.risk_tier = p_risk_tier)
    and (p_injection_flag is null or rc.injection_flag = p_injection_flag)
  -- Exactly one of these four expressions is non-null for every row on a given
  -- call (p_sort_field/p_sort_ascending are constant across the call), so the
  -- other three are a uniform NULL and don't affect ordering — this avoids
  -- dynamic SQL for what's really a single order-by choice made once per call.
  order by
    case when p_sort_field = 'risk_tier' and p_sort_ascending then rc.risk_rank end asc,
    case when p_sort_field = 'risk_tier' and not p_sort_ascending then rc.risk_rank end desc,
    case when p_sort_field = 'created_at' and p_sort_ascending then aa.created_at end asc,
    case when p_sort_field = 'created_at' and not p_sort_ascending then aa.created_at end desc,
    aa.id asc
  limit p_limit offset p_offset;
$$;

comment on function list_incidents_by_decision(text, boolean, timestamptz, timestamptz, text, boolean, text, boolean, int, int) is
  'Review Queue / Incident Log paginated fetch (specs/05, specs/09) — real SQL join + ORDER BY, used instead of PostgREST embedded-resource ordering because that fails with PGRST118 for this relationship (see comment above). Total count for pagination still comes from a separate PostgREST head-count query in lib/supabase/queries.ts, which filters correctly on the same embedded resource — only ordering is affected.';

-- ============================================================================
-- Access control — RLS enabled on every table, no permissive policies by
-- default. The service-role client (lib/supabase/server.ts, guarded by the
-- `server-only` package) bypasses RLS entirely by design and is the only
-- thing that ever reads or writes these tables from the application
-- (skills/security-foundation/SKILL.md). This is a default-deny backstop for
-- the anon/authenticated roles, not the primary access control mechanism.
--
-- If a future screen ever reads directly from the browser Supabase client,
-- add an explicit, narrowly-scoped SELECT policy for that table at that
-- time — don't pre-emptively open access this application doesn't use yet.
-- ============================================================================

alter table agent_actions        enable row level security;
alter table risk_classifications enable row level security;
alter table incidents            enable row level security;
alter table review_decisions     enable row level security;
alter table synthea_patients     enable row level security;
alter table synthea_medications  enable row level security;
