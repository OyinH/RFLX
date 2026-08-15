import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EvalCaseSchema, type EvalCase } from "./types";
import { getErrorMessage } from "@/lib/errors";
import { formatEvalResultsCsv, type EvalResultRow } from "@/lib/eval/csv";
import { computeEvalSummary } from "@/lib/eval/score";

/**
 * specs/08-eval-harness.md's Runner Behavior. Run via `npm run eval`.
 *
 * CSV formatting and Go/No-Go scoring live in lib/eval/csv.ts and
 * lib/eval/score.ts, shared with app/eval/page.tsx (specs/10-eval-results-ui.md)
 * — this file's own terminal output is a thin formatting layer over the same
 * computeEvalSummary() the UI calls, so the two can't silently disagree.
 */

const CASES_DIR = path.join(process.cwd(), "eval", "cases");
const RESULTS_PATH = path.join(process.cwd(), "eval", "results.csv");

interface GatewayResponse {
  decision: "auto_approve" | "escalate" | "block";
  risk_tier: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  injection_flag: boolean;
}

interface CaseResult {
  eval_case: EvalCase;
  actual: GatewayResponse | null;
  latency_ms: number;
  pass: boolean;
  error?: string;
}

function loadCases(subdir: string): { file: string; data: unknown }[] {
  const dir = path.join(CASES_DIR, subdir);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch (err) {
    throw new Error(`Could not read ${dir}: ${getErrorMessage(err)}`);
  }
  return files.map((file) => {
    const raw = readFileSync(path.join(dir, file), "utf-8");
    try {
      return { file, data: JSON.parse(raw) as unknown };
    } catch (err) {
      throw new Error(`${subdir}/${file} is not valid JSON: ${getErrorMessage(err)}`);
    }
  });
}

function loadAndValidateCases(): EvalCase[] {
  const raw = [...loadCases("injection").map((c) => ({ ...c, subdir: "injection" })), ...loadCases("benign").map((c) => ({ ...c, subdir: "benign" }))];

  const errors: string[] = [];
  const cases: EvalCase[] = [];

  for (const entry of raw) {
    const result = EvalCaseSchema.safeParse(entry.data);
    if (!result.success) {
      errors.push(`${entry.subdir}/${entry.file}: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    } else {
      cases.push(result.data);
    }
  }

  if (errors.length > 0) {
    console.error("Eval case validation failed — aborting before any Gateway API call:\n");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  return cases;
}

// Generous relative to the ~13s P95 target (specs/03-gateway-api.md), but
// far short of the ~10 minutes a genuine stall previously took to surface —
// without this, a single hung request makes the whole suite wait
// indefinitely instead of failing that one case fast and moving on.
const CASE_FETCH_TIMEOUT_MS = 60_000;

async function runCase(baseUrl: string, evalCase: EvalCase): Promise<CaseResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}/api/agent/action-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(evalCase.request),
      signal: AbortSignal.timeout(CASE_FETCH_TIMEOUT_MS),
    });
    const latency_ms = Date.now() - startedAt;

    if (!response.ok) {
      const body = await response.text();
      return { eval_case: evalCase, actual: null, latency_ms, pass: false, error: `HTTP ${response.status}: ${body}` };
    }

    const actual = (await response.json()) as GatewayResponse;
    const pass = evalCase.expected.acceptable_decisions.includes(actual.decision);
    return { eval_case: evalCase, actual, latency_ms, pass };
  } catch (err) {
    return {
      eval_case: evalCase,
      actual: null,
      latency_ms: Date.now() - startedAt,
      pass: false,
      error: getErrorMessage(err),
    };
  }
}

function toEvalResultRow(r: CaseResult): EvalResultRow {
  const c = r.eval_case;
  return {
    id: c.id,
    category: c.category,
    injection_strategy: c.injection_strategy ?? "",
    harm_stratum: c.harm_stratum ?? "",
    attack_vector: c.attack_vector ?? "",
    fairness_stratum_age_band: c.fairness_stratum?.age_band ?? "",
    fairness_stratum_sex: c.fairness_stratum?.sex ?? "",
    fairness_stratum_race: c.fairness_stratum?.race ?? "",
    expected_acceptable_decisions: c.expected.acceptable_decisions,
    actual_decision: r.actual?.decision ?? r.error ?? "ERROR",
    actual_risk_tier: r.actual?.risk_tier ?? "",
    actual_injection_flag: r.actual ? String(r.actual.injection_flag) : "",
    latency_ms: r.latency_ms,
    pass: r.pass,
  };
}

function logSummary(summary: ReturnType<typeof computeEvalSummary>): void {
  console.log("\n=== Eval Summary ===");
  console.log(
    `Injection cases: ${summary.injectionCount} | Catch rate: ${(summary.catchRate * 100).toFixed(1)}% (target >= ${summary.thresholds.catchRate * 100}%)`,
  );
  console.log(
    `Benign cases: ${summary.benignCount} | False-positive rate: ${(summary.falsePositiveRate * 100).toFixed(1)}% (target < ${summary.thresholds.falsePositiveRate * 100}%)`,
  );
  console.log(`P95 latency: ${summary.p95LatencyMs}ms (target < ${summary.thresholds.p95LatencyMs}ms)`);

  console.log("\n--- Catch rate by strategy x harm_stratum ---");
  for (const { key, passed, total, rate } of summary.catchRateByStrategyStratum) {
    console.log(`  ${key}: ${passed}/${total} (${(rate * 100).toFixed(1)}%)`);
  }

  console.log("\n--- False-positive rate by fairness dimension ---");
  let lastDimension: string | null = null;
  for (const { dimension, value, failed, total, rate } of summary.falsePositiveByFairnessDimension) {
    if (dimension !== lastDimension) {
      console.log(`  ${dimension}:`);
      lastDimension = dimension;
    }
    console.log(`    ${value}: ${failed}/${total} false positives (${(rate * 100).toFixed(1)}%)`);
  }

  if (summary.errors.length > 0) {
    console.log(`\n--- ${summary.errors.length} case(s) errored (counted as failed) ---`);
    for (const e of summary.errors) console.log(`  ${e.id}: ${e.reason}`);
  }

  console.log(`\nGo/No-Go: ${summary.goNoGo ? "PASS" : "FAIL"}`);
}

async function main() {
  const baseUrl = process.env.GATEWAY_BASE_URL ?? "http://localhost:3000";
  const cases = loadAndValidateCases();
  console.log(`Loaded ${cases.length} eval cases. Running sequentially against ${baseUrl}...\n`);

  const results: CaseResult[] = [];
  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];
    const result = await runCase(baseUrl, evalCase);
    results.push(result);
    console.log(
      `[${i + 1}/${cases.length}] ${evalCase.id} -> ${result.actual?.decision ?? "ERROR"} ` +
        `(expected one of: ${evalCase.expected.acceptable_decisions.join(",")}) ${result.pass ? "PASS" : "FAIL"} [${result.latency_ms}ms]`,
    );
  }

  const rows = results.map(toEvalResultRow);
  writeFileSync(RESULTS_PATH, formatEvalResultsCsv(rows), "utf-8");
  console.log(`\nWrote ${rows.length} rows to ${RESULTS_PATH}`);

  const summary = computeEvalSummary(rows);
  logSummary(summary);
  process.exit(summary.goNoGo ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", getErrorMessage(err));
  process.exit(1);
});
