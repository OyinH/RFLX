/**
 * eval/results.csv read/write — single source of truth for the column order,
 * header, and escaping rules, shared by eval/run.ts (writer) and app/eval/page.tsx
 * + app/api/eval/download/route.ts (readers). Splitting write and read across two
 * hand-rolled, independently-drifting implementations is exactly how a column
 * gets added on one side and silently misread on the other — this file is the
 * only place either side touches the format.
 *
 * No "server-only" — eval/run.ts is a plain Node script (tsx, not a Next.js
 * request), so this can't depend on anything Next-request-scoped.
 */

export type EvalResultRow = {
  id: string;
  category: "injection" | "benign";
  injection_strategy: string;
  harm_stratum: string;
  attack_vector: string;
  fairness_stratum_age_band: string;
  fairness_stratum_sex: string;
  fairness_stratum_race: string;
  expected_acceptable_decisions: string[];
  actual_decision: string;
  actual_risk_tier: string;
  actual_injection_flag: string;
  latency_ms: number;
  pass: boolean;
};

export const EVAL_RESULTS_CSV_HEADER = [
  "id",
  "category",
  "injection_strategy",
  "harm_stratum",
  "attack_vector",
  "fairness_stratum_age_band",
  "fairness_stratum_sex",
  "fairness_stratum_race",
  "expected_acceptable_decisions",
  "actual_decision",
  "actual_risk_tier",
  "actual_injection_flag",
  "latency_ms",
  "pass",
] as const;

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function formatEvalResultsCsv(rows: EvalResultRow[]): string {
  const lines = rows.map((r) =>
    [
      r.id,
      r.category,
      r.injection_strategy,
      r.harm_stratum,
      r.attack_vector,
      r.fairness_stratum_age_band,
      r.fairness_stratum_sex,
      r.fairness_stratum_race,
      r.expected_acceptable_decisions.join("|"),
      r.actual_decision,
      r.actual_risk_tier,
      r.actual_injection_flag,
      String(r.latency_ms),
      String(r.pass),
    ]
      .map(csvEscape)
      .join(","),
  );
  return [EVAL_RESULTS_CSV_HEADER.join(","), ...lines].join("\n") + "\n";
}

/** One line of a CSV, respecting quoted fields (commas/quotes/newlines inside "..."). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Splits on newlines outside quoted fields — a quoted field can legitimately
 * contain "\n" (csvEscape above quotes exactly that case), so a naive
 * text.split("\n") would cut a row in half.
 */
function splitCsvRecords(text: string): string[] {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "\n" && !inQuotes) {
      records.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) records.push(current);
  return records;
}

export function parseEvalResultsCsv(text: string): EvalResultRow[] {
  const records = splitCsvRecords(text.trim());
  if (records.length === 0) return [];

  const [headerLine, ...rowLines] = records;
  const header = parseCsvLine(headerLine);
  const expectedHeader = EVAL_RESULTS_CSV_HEADER as readonly string[];
  if (header.length !== expectedHeader.length || header.some((h, i) => h !== expectedHeader[i])) {
    throw new Error(
      `eval/results.csv header doesn't match the expected schema — got [${header.join(", ")}], expected [${expectedHeader.join(", ")}]. Re-run "npm run eval" to regenerate it.`,
    );
  }

  return rowLines.map((line) => {
    const [
      id,
      category,
      injection_strategy,
      harm_stratum,
      attack_vector,
      fairness_stratum_age_band,
      fairness_stratum_sex,
      fairness_stratum_race,
      expected_acceptable_decisions,
      actual_decision,
      actual_risk_tier,
      actual_injection_flag,
      latency_ms,
      pass,
    ] = parseCsvLine(line);
    return {
      id,
      category: category as "injection" | "benign",
      injection_strategy,
      harm_stratum,
      attack_vector,
      fairness_stratum_age_band,
      fairness_stratum_sex,
      fairness_stratum_race,
      expected_acceptable_decisions: expected_acceptable_decisions ? expected_acceptable_decisions.split("|") : [],
      actual_decision,
      actual_risk_tier,
      actual_injection_flag,
      latency_ms: Number(latency_ms),
      pass: pass === "true",
    };
  });
}
