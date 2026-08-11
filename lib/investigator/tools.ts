import "server-only";
import { getActiveMedicationsForPatient } from "@/lib/supabase/queries";

/**
 * Tool implementations for specs/04-investigator.md. Read-only, no side
 * effects — the concrete enforcement of "bounded agency" lives one layer up
 * in index.ts's call-count cap, but every tool here is incapable of writing
 * anything even if called without limit.
 */

const OPENFDA_TIMEOUT_MS = 5000;

export interface DrugLabelResult {
  found: boolean;
  contraindications: string;
  warnings: string;
  boxed_warning: string;
  drug_interactions: string;
}

interface OpenFdaLabelResult {
  contraindications?: string[];
  warnings?: string[];
  warnings_and_cautions?: string[];
  boxed_warning?: string[];
  drug_interactions?: string[];
}

interface OpenFdaResponse {
  results?: OpenFdaLabelResult[];
}

const NOT_FOUND_RESULT: DrugLabelResult = {
  found: false,
  contraindications: "",
  warnings: "",
  boxed_warning: "",
  drug_interactions: "",
};

/**
 * openFDA drug label lookup (api.fda.gov/drug/label.json) — free, public, no
 * auth required. A drug openFDA doesn't recognize, or an unavailable/timed-out
 * API, both resolve to `found: false` rather than throwing — specs/04's Edge
 * Cases: a failed lookup is itself evidence, not a reason to crash the
 * investigation.
 */
export async function lookupDrugLabel(drugName: string): Promise<DrugLabelResult> {
  // drugName ultimately traces back to the investigator's own tool-call
  // arguments, which the model derives from payload.content — the exact
  // untrusted input this whole system exists to defend against. openFDA's
  // search API has no auth and no PHI, so the worst case here was always low
  // severity (malformed/unintended search, not data exposure), but stripping
  // the query-string metacharacter (`"`, which closes the quoted field value
  // early) before interpolating costs nothing and closes it outright rather
  // than relying on that severity ceiling.
  const sanitizedDrugName = drugName.replace(/"/g, "");
  const query = `(openfda.generic_name:"${sanitizedDrugName}" OR openfda.brand_name:"${sanitizedDrugName}")`;
  const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(query)}&limit=1`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENFDA_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 404) {
      return NOT_FOUND_RESULT;
    }
    if (!response.ok) {
      return NOT_FOUND_RESULT;
    }

    const data = (await response.json()) as OpenFdaResponse;
    const result = data.results?.[0];
    if (!result) {
      return NOT_FOUND_RESULT;
    }

    return {
      found: true,
      contraindications: result.contraindications?.[0] ?? "Not specified in label.",
      warnings: result.warnings?.[0] ?? result.warnings_and_cautions?.[0] ?? "Not specified in label.",
      boxed_warning: result.boxed_warning?.[0] ?? "None.",
      drug_interactions: result.drug_interactions?.[0] ?? "Not specified in label.",
    };
  } catch {
    // Timeout or network failure — treated identically to "not found" per
    // specs/04's openFDA-unavailable edge case: the investigator reasons
    // with whatever else it has, rather than the whole investigation failing.
    return NOT_FOUND_RESULT;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface PatientMedicationsResult {
  medications: { name: string; dose: string; start_date: string }[];
}

/**
 * Active medications for a patient, from synthea_medications
 * (specs/01-database-schema.md). Returns an empty list for a patient with
 * none on file — a valid result, not an error.
 */
export async function getPatientCurrentMedications(patientContextId: string): Promise<PatientMedicationsResult> {
  const rows = await getActiveMedicationsForPatient(patientContextId);
  return {
    medications: rows.map((row) => ({
      name: row.name,
      dose: row.dose ?? "unspecified",
      start_date: row.start_date ?? "unknown",
    })),
  };
}

export function summarizeDrugLabelFinding(drugName: string, result: DrugLabelResult): string {
  if (!result.found) {
    return `No FDA label found for "${drugName}".`;
  }
  const parts = [`Boxed warning: ${result.boxed_warning}`, `Contraindications: ${result.contraindications}`];
  return parts.join(" | ");
}

export function summarizeMedicationsFinding(result: PatientMedicationsResult): string {
  if (result.medications.length === 0) {
    return "Patient has no active medications on file.";
  }
  return `Patient has ${result.medications.length} active medication(s): ${result.medications
    .map((m) => `${m.name} ${m.dose}`)
    .join(", ")}.`;
}
