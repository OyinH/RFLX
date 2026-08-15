-- rflx.ai — clinical-severity rank for risk_tier. Mirrors /database.sql (canonical,
-- documented version — see that file for full rationale). Duplicated here per
-- 0001_init.sql's own header: `supabase db push` needs real SQL content in this folder.
--
-- risk_tier is a plain text column ('LOW'/'MEDIUM'/'HIGH'/'CRITICAL') — ordering
-- directly on it sorts alphabetically (CRITICAL, HIGH, LOW, MEDIUM), not by clinical
-- severity. This generated column gives PostgREST a real integer to order/index on
-- that actually matches severity order, without a trigger to keep it in sync.

alter table risk_classifications
  add column if not exists risk_rank smallint generated always as (
    case risk_tier
      when 'LOW' then 1
      when 'MEDIUM' then 2
      when 'HIGH' then 3
      when 'CRITICAL' then 4
    end
  ) stored;

create index if not exists idx_risk_classifications_risk_rank on risk_classifications(risk_rank);
