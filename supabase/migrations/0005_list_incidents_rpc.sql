-- rflx.ai — server-side sort for the Review Queue / Incident Log. Mirrors /database.sql
-- (canonical, documented version — see that file for full rationale). Duplicated here
-- per 0001_init.sql's own header: `supabase db push` needs real SQL content in this folder.
--
-- Why an RPC instead of PostgREST's embedded-resource ordering
-- (`.order(col, { referencedTable })`): verified live against this project's actual
-- PostgREST instance — ordering agent_actions by an embedded risk_classifications
-- column fails with PGRST118 ("'agent_actions' and 'risk_classifications' do not form
-- a many-to-one or one-to-one relationship"), even with `!inner` and even though
-- risk_classifications.action_id is UNIQUE. PostgREST determines relationship
-- direction from which table holds the FK; from agent_actions' side this reads as
-- one-to-many for order-by purposes regardless of the unique constraint. Filtering on
-- the same embedded resource (`.eq("risk_classification.risk_tier", ...)`) works fine —
-- only ordering is affected — so lib/supabase/queries.ts keeps its existing PostgREST
-- head-count query for totals and routes only the actual page fetch through this RPC,
-- which does a plain SQL join with a real ORDER BY and has no such ambiguity.

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
