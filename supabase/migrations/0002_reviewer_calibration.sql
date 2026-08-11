-- rflx.ai — reviewer-outcome calibration log (docs/rflx_PRD.md §6.1, P1).
-- Mirrors /database.sql (canonical, documented version — see that file for
-- full rationale). Duplicated here per 0001_init.sql's own header: the
-- Supabase CLI's `supabase db push` needs real SQL content in this folder.
--
-- Nullable, no CHECK constraint, no backfill — matches specs/01-database-schema.md's
-- explicit choice: existing review_decisions rows predate this feature, and
-- required-ness is enforced by specs/05-review-queue-ui.md's UI, not the schema.

alter table review_decisions
  add column if not exists classification_agreement text,
  add column if not exists reason_code text;

alter table review_decisions
  drop constraint if exists review_decisions_classification_agreement_check;
alter table review_decisions
  add constraint review_decisions_classification_agreement_check
  check (classification_agreement is null or classification_agreement in ('agreed', 'should_be_lower', 'should_be_higher'));

alter table review_decisions
  drop constraint if exists review_decisions_reason_code_check;
alter table review_decisions
  add constraint review_decisions_reason_code_check
  check (reason_code is null or reason_code in (
    'correct_classification', 'overly_cautious', 'missed_clinical_context',
    'fabricated_evidence_not_flagged', 'other'
  ));
