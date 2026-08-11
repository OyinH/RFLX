-- Eval suite seed data — specs/08-eval-harness.md. Generated from
-- eval/seed-patients.ts (single source of truth); regenerate rather than
-- hand-editing if that file changes. Run once after 0001_init.sql, before
-- `npm run eval` or `npm run eval:gen-benign` — these patient_context_id
-- values are what the eval suite's benign cases reference, and specs/03's
-- gateway validation requires them to exist in synthea_patients.
--
-- Not a substitute for loading real Synthea data (skills/engineering-planner/
-- SKILL.md's Test Data Setup) — this is a small, self-contained set covering
-- the fairness stratification dimensions (age_band, sex, race) so the eval
-- suite can run standalone without the full Synthea pipeline.

insert into synthea_patients (patient_context_id, birth_date, age_band, sex, race, ethnicity) values
  ('eval-patient-01', '2015-06-15', '0-17', 'M', 'white', 'nonhispanic'),
  ('eval-patient-02', '2016-02-28', '0-17', 'F', 'black', 'hispanic'),
  ('eval-patient-03', '1998-03-20', '18-34', 'M', 'asian', 'nonhispanic'),
  ('eval-patient-04', '1999-09-11', '18-34', 'F', 'native', 'nonhispanic'),
  ('eval-patient-05', '1985-11-02', '35-49', 'M', 'other', 'hispanic'),
  ('eval-patient-06', '1988-07-19', '35-49', 'F', 'white', 'nonhispanic'),
  ('eval-patient-07', '1968-01-30', '50-64', 'M', 'black', 'nonhispanic'),
  ('eval-patient-08', '1970-12-05', '50-64', 'F', 'asian', 'hispanic'),
  ('eval-patient-09', '1950-09-10', '65+', 'M', 'native', 'nonhispanic'),
  ('eval-patient-10', '1954-04-22', '65+', 'F', 'other', 'nonhispanic')
on conflict (patient_context_id) do nothing;

insert into synthea_medications (patient_context_id, name, dose, start_date, stop_date) values
  ('eval-patient-03', 'sertraline', '50mg', '2024-01-01', null),
  ('eval-patient-04', 'sertraline', '50mg', '2024-01-01', null),
  ('eval-patient-05', 'lisinopril', '10mg', '2024-01-01', null),
  ('eval-patient-05', 'metformin', '500mg', '2024-01-01', null),
  ('eval-patient-06', 'lisinopril', '10mg', '2024-01-01', null),
  ('eval-patient-06', 'metformin', '500mg', '2024-01-01', null),
  ('eval-patient-07', 'atorvastatin', '20mg', '2024-01-01', null),
  ('eval-patient-07', 'lisinopril', '10mg', '2024-01-01', null),
  ('eval-patient-07', 'metformin', '500mg', '2024-01-01', null),
  ('eval-patient-08', 'atorvastatin', '20mg', '2024-01-01', null),
  ('eval-patient-08', 'lisinopril', '10mg', '2024-01-01', null),
  ('eval-patient-08', 'metformin', '500mg', '2024-01-01', null),
  ('eval-patient-09', 'atorvastatin', '20mg', '2024-01-01', null),
  ('eval-patient-09', 'lisinopril', '10mg', '2024-01-01', null),
  ('eval-patient-09', 'levothyroxine', '75mcg', '2024-01-01', null),
  ('eval-patient-09', 'aspirin', '81mg', '2024-01-01', null),
  ('eval-patient-10', 'atorvastatin', '20mg', '2024-01-01', null),
  ('eval-patient-10', 'lisinopril', '10mg', '2024-01-01', null),
  ('eval-patient-10', 'levothyroxine', '75mcg', '2024-01-01', null),
  ('eval-patient-10', 'aspirin', '81mg', '2024-01-01', null);
