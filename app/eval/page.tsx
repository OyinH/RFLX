import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseEvalResultsCsv } from "@/lib/eval/csv";
import { computeEvalSummary, type EvalSummary } from "@/lib/eval/score";
import { getErrorMessage } from "@/lib/errors";
import { EvalResultsView } from "./EvalResultsView";

const RESULTS_PATH = path.join(process.cwd(), "eval", "results.csv");

/**
 * rflx evaluating itself — specs/10-eval-results-ui.md. Reads the committed
 * eval/results.csv (the same file `npm run eval` writes and the same numbers
 * printed to the terminal — lib/eval/score.ts's computeEvalSummary() is the
 * single source of truth both places call) and renders it as a real page, so
 * seeing the guardrail's own accuracy against its Go/No-Go baseline (catch
 * rate, false-positive rate, P95 latency — specs/08-eval-harness.md) doesn't
 * require opening the repo or asking an assistant to read the file.
 *
 * Deliberately NOT force-dynamic, unlike review-queue/dashboard/incidents:
 * this reads a file that only changes between deploys (a new committed run),
 * not live Supabase data — a static prerender at build time correctly
 * reflects "this deploy's committed results" and is faster than a per-request
 * read would be, no live-data-caching risk to close here.
 */
export default async function EvalPage() {
  let summary: EvalSummary | null = null;
  let loadError: string | null = null;
  let missing = false;
  let generatedAt: string | null = null;

  try {
    const [text, fileStat] = await Promise.all([readFile(RESULTS_PATH, "utf-8"), stat(RESULTS_PATH)]);
    summary = computeEvalSummary(parseEvalResultsCsv(text));
    generatedAt = fileStat.mtime.toISOString();
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      missing = true;
    } else {
      loadError = getErrorMessage(err);
    }
  }

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-12">
      <header>
        <h1 className="text-xl font-semibold text-text-primary">Eval Results</h1>
        <p className="mt-1 text-sm text-text-secondary">
          How the guardrail performs against the accuracy baseline it must meet before shipping — a standardized
          suite of 100 test cases (40 adversarial injection attempts, 60 legitimate clinical actions), evaluated
          every time the system changes.
          {generatedAt ? ` Last evaluated ${new Date(generatedAt).toLocaleString()}.` : ""}
        </p>
      </header>

      {loadError ? (
        <div className="mt-6 rounded-lg border border-risk-critical bg-surface p-6">
          <p className="text-sm font-medium text-risk-critical">Could not load eval results.</p>
          <p className="mt-1 text-xs text-text-secondary">{loadError}</p>
        </div>
      ) : missing ? (
        <div className="mt-6 rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-secondary">No evaluation has been run yet.</p>
        </div>
      ) : (
        <EvalResultsView summary={summary!} />
      )}
    </main>
  );
}
