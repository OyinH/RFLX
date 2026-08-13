import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServiceRoleClient } from "../lib/supabase-client";
import { getErrorMessage } from "@/lib/errors";
import type { AgeBand, SyntheaPatient, SyntheaMedication } from "@/lib/supabase/types";

/**
 * skills/engineering-planner/SKILL.md's Test Data Setup — loads a Synthea
 * CSV export (patients.csv, medications.csv) into synthea_patients /
 * synthea_medications (specs/01-database-schema.md). Synthea itself isn't
 * run from here — generate output separately (`./run_synthea -p N` with
 * exporter.csv.export=true), then point this at the resulting csv/ folder.
 *
 *   npm run load-synthea -- --dir /path/to/synthea/output/csv
 *
 * Truncate-and-reload: synthea_medications has no natural unique key to
 * upsert against, so every run replaces both tables wholesale rather than
 * merging (specs/01's Edge Cases note on duplicate patient_context_id on
 * reload). Safe because nothing else FKs into these two tables.
 */

const BATCH_SIZE = 500;

function parseArgs(argv: string[]): { dir: string } {
  const dirFlagIndex = argv.indexOf("--dir");
  if (dirFlagIndex === -1 || !argv[dirFlagIndex + 1]) {
    console.error("Usage: npm run load-synthea -- --dir /path/to/synthea/output/csv");
    process.exit(1);
  }
  return { dir: argv[dirFlagIndex + 1] };
}

function parseCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, "utf-8").split("\n").filter((line) => line.length > 0);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    header.forEach((col, i) => {
      row[col] = cells[i] ?? "";
    });
    return row;
  });
}

// Fairness stratification bucketing (specs/01-database-schema.md) — computed
// at load time from birth_date, not a raw Synthea field.
function ageBand(birthDate: string): AgeBand {
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;

  if (age <= 17) return "0-17";
  if (age <= 34) return "18-34";
  if (age <= 49) return "35-49";
  if (age <= 64) return "50-64";
  return "65+";
}

function toDateOnly(timestamp: string): string | null {
  if (!timestamp) return null;
  return timestamp.slice(0, 10);
}

async function loadPatients(dir: string): Promise<{ patients: SyntheaPatient[]; aliveIds: Set<string> }> {
  const rows = parseCsv(join(dir, "patients.csv"));
  // Only living patients — a deceased patient can't plausibly be the target
  // of a new clinical agent action, and the schema has no deceased flag to
  // otherwise represent that distinction.
  const alive = rows.filter((row) => !row.DEATHDATE);

  const patients: SyntheaPatient[] = alive.map((row) => ({
    patient_context_id: row.Id,
    birth_date: row.BIRTHDATE,
    age_band: ageBand(row.BIRTHDATE),
    sex: row.GENDER,
    race: row.RACE || null,
    ethnicity: row.ETHNICITY || null,
    created_at: new Date().toISOString(),
  }));

  return { patients, aliveIds: new Set(patients.map((p) => p.patient_context_id)) };
}

function loadMedications(dir: string, aliveIds: Set<string>): SyntheaMedication[] {
  const rows = parseCsv(join(dir, "medications.csv"));
  return rows
    .filter((row) => aliveIds.has(row.PATIENT))
    .map((row) => ({
      id: crypto.randomUUID(),
      patient_context_id: row.PATIENT,
      name: row.DESCRIPTION,
      // Synthea's medications.csv has no discrete dose column — dosage is
      // embedded in DESCRIPTION text (e.g. "Acetaminophen 325 MG..."), not
      // reliably separable. Left null, matching the schema's nullable dose.
      dose: null,
      start_date: toDateOnly(row.START),
      stop_date: toDateOnly(row.STOP),
    }));
}

type Supabase = ReturnType<typeof createServiceRoleClient>;

async function insertBatched<T extends Record<string, unknown>>(
  supabase: Supabase,
  table: "synthea_patients" | "synthea_medications",
  rows: T[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    // @ts-expect-error — table name is a runtime parameter across two distinct row shapes.
    const { error } = await supabase.from(table).insert(batch);
    if (error) throw error;
  }
}

async function main() {
  const { dir } = parseArgs(process.argv.slice(2));
  const supabase = createServiceRoleClient();

  console.log(`Reading Synthea CSV export from ${dir}...`);
  const { patients, aliveIds } = await loadPatients(dir);
  const medications = loadMedications(dir, aliveIds);
  console.log(`Parsed ${patients.length} living patients, ${medications.length} medication records.`);

  console.log("Clearing existing reference data (truncate-and-reload)...");
  const { error: delMedsError } = await supabase.from("synthea_medications").delete().not("id", "is", null);
  if (delMedsError) throw delMedsError;
  const { error: delPatientsError } = await supabase
    .from("synthea_patients")
    .delete()
    .not("patient_context_id", "is", null);
  if (delPatientsError) throw delPatientsError;

  console.log(`Inserting ${patients.length} patients...`);
  await insertBatched(supabase, "synthea_patients", patients);

  console.log(`Inserting ${medications.length} medications...`);
  await insertBatched(supabase, "synthea_medications", medications);

  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal error:", getErrorMessage(err));
  process.exit(1);
});
