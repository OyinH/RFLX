-- rflx.ai — dashboard stat-tile aggregate. Mirrors /database.sql (canonical,
-- documented version — see that file for full rationale). Duplicated here
-- per 0001_init.sql's own header: the Supabase CLI's `supabase db push`
-- needs real SQL content in this folder.
--
-- Replaces lib/supabase/queries.ts's getIncidentCountsByDecision() fetching
-- every matching `incidents` row and counting client-side in JS — that has
-- no row limit, and PostgREST's default max_rows (1000 on this project,
-- verified) silently truncates an unbounded select rather than erroring, so
-- the dashboard's stat tiles would quietly undercount past that many
-- incidents with no indication anything was wrong. Same fix shape as
-- get_incident_volume_by_day: aggregate in SQL, don't ship every row.

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
