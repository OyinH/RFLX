import type { AgeBand } from "@/lib/supabase/types";

/**
 * Representative synthetic patients for the eval suite. No live Synthea data
 * is loaded yet (skills/engineering-planner/SKILL.md's Test Data Setup is a
 * separate, not-yet-run step) — specs/08-eval-harness.md's benign cases still
 * need real `patient_context_id` values that pass specs/03's gateway
 * validation, so this is the eval suite's own small, self-contained patient
 * set. Single source of truth for both:
 *   - supabase/seed.sql (INSERT statements generated from this file — keep in sync)
 *   - eval/generate-benign-cases.ts (imports this directly)
 *
 * One patient per (age_band, sex) cell, cycling race across all 5 values
 * across the 10 rows so every fairness dimension value appears in the eval
 * suite at least once (docs/engineering/architecture.md's Evaluation
 * Framework section).
 */
export interface SeedPatient {
  patient_context_id: string;
  birth_date: string;
  age_band: AgeBand;
  sex: "M" | "F";
  race: string;
  ethnicity: string;
  medications: { name: string; dose: string }[];
}

const MEDICATIONS_BY_AGE_BAND: Record<AgeBand, { name: string; dose: string }[]> = {
  "0-17": [],
  "18-34": [{ name: "sertraline", dose: "50mg" }],
  "35-49": [
    { name: "lisinopril", dose: "10mg" },
    { name: "metformin", dose: "500mg" },
  ],
  "50-64": [
    { name: "atorvastatin", dose: "20mg" },
    { name: "lisinopril", dose: "10mg" },
    { name: "metformin", dose: "500mg" },
  ],
  "65+": [
    { name: "atorvastatin", dose: "20mg" },
    { name: "lisinopril", dose: "10mg" },
    { name: "levothyroxine", dose: "75mcg" },
    { name: "aspirin", dose: "81mg" },
  ],
};

const CELLS: { age_band: AgeBand; birth_date: string; sex: "M" | "F"; race: string; ethnicity: string }[] = [
  { age_band: "0-17", birth_date: "2015-06-15", sex: "M", race: "white", ethnicity: "nonhispanic" },
  { age_band: "0-17", birth_date: "2016-02-28", sex: "F", race: "black", ethnicity: "hispanic" },
  { age_band: "18-34", birth_date: "1998-03-20", sex: "M", race: "asian", ethnicity: "nonhispanic" },
  { age_band: "18-34", birth_date: "1999-09-11", sex: "F", race: "native", ethnicity: "nonhispanic" },
  { age_band: "35-49", birth_date: "1985-11-02", sex: "M", race: "other", ethnicity: "hispanic" },
  { age_band: "35-49", birth_date: "1988-07-19", sex: "F", race: "white", ethnicity: "nonhispanic" },
  { age_band: "50-64", birth_date: "1968-01-30", sex: "M", race: "black", ethnicity: "nonhispanic" },
  { age_band: "50-64", birth_date: "1970-12-05", sex: "F", race: "asian", ethnicity: "hispanic" },
  { age_band: "65+", birth_date: "1950-09-10", sex: "M", race: "native", ethnicity: "nonhispanic" },
  { age_band: "65+", birth_date: "1954-04-22", sex: "F", race: "other", ethnicity: "nonhispanic" },
];

export const SEED_PATIENTS: SeedPatient[] = CELLS.map((cell, i) => ({
  patient_context_id: `eval-patient-${String(i + 1).padStart(2, "0")}`,
  birth_date: cell.birth_date,
  age_band: cell.age_band,
  sex: cell.sex,
  race: cell.race,
  ethnicity: cell.ethnicity,
  medications: MEDICATIONS_BY_AGE_BAND[cell.age_band],
}));
