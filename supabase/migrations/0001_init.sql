-- rflx.ai — initial schema. Mirrors /database.sql (the canonical, documented
-- version — see that file for full comments and rationale on every table/
-- column). Duplicated here, not referenced, because the Supabase CLI's
-- `supabase db push` requires real SQL content in this migrations folder,
-- not a pointer to another file. Keep both in sync if either changes.

create extension if not exists pgcrypto;

-- ============================================================================
-- Audit trail tables
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
  created_at          timestamptz not null default now()
);

create table if not exists incidents (
  id          uuid primary key default gen_random_uuid(),
  action_id   uuid not null unique references agent_actions(id) on delete restrict,
  decision    text not null
    check (decision in ('auto_approve', 'escalate', 'block')),
  latency_ms  int
    check (latency_ms is null or latency_ms >= 0),
  created_at  timestamptz not null default now()
);

create table if not exists review_decisions (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references incidents(id) on delete restrict,
  reviewer_id  text,
  outcome      text
    check (outcome is null or outcome in ('approved', 'rejected')),
  notes        text,
  decided_at   timestamptz not null default now()
);

create index if not exists idx_risk_classifications_action_id on risk_classifications(action_id);
create index if not exists idx_incidents_action_id on incidents(action_id);
create index if not exists idx_review_decisions_incident_id on review_decisions(incident_id);
create index if not exists idx_incidents_decision on incidents(decision);
create index if not exists idx_incidents_created_at on incidents(created_at);

-- ============================================================================
-- Reference data tables — Synthea-loaded, read-only from the application's
-- perspective. See skills/engineering-planner/SKILL.md's Test Data Setup for
-- the generation/loading steps; this migration only creates the shape.
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

create table if not exists synthea_medications (
  id                   uuid primary key default gen_random_uuid(),
  patient_context_id   text not null references synthea_patients(patient_context_id) on delete restrict,
  name                 text not null,
  dose                 text,
  start_date           date,
  stop_date            date
);

create index if not exists idx_synthea_medications_patient on synthea_medications(patient_context_id);

-- ============================================================================
-- Dashboard support — specs/06-dashboard-ui.md requires the time-series view to
-- bucket/aggregate in SQL, not fetch every row and bucket client-side. Called via
-- supabase.rpc('get_incident_volume_by_day', ...) from lib/supabase/queries.ts.
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

-- ============================================================================
-- Access control — RLS enabled, no permissive policies by default. The
-- service-role client (lib/supabase/server.ts) bypasses RLS entirely by
-- design; this is a default-deny backstop for the anon/authenticated roles.
-- ============================================================================

alter table agent_actions        enable row level security;
alter table risk_classifications enable row level security;
alter table incidents            enable row level security;
alter table review_decisions     enable row level security;
alter table synthea_patients     enable row level security;
alter table synthea_medications  enable row level security;
