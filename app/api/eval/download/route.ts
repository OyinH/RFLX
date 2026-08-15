import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { parseEvalResultsCsv } from "@/lib/eval/csv";
import { getErrorMessage } from "@/lib/errors";

const RESULTS_PATH = path.join(process.cwd(), "eval", "results.csv");

/**
 * Download affordance for app/eval/page.tsx (specs/10-eval-results-ui.md) —
 * ?format=csv (default) streams the committed eval/results.csv verbatim;
 * ?format=json parses it through the same lib/eval/csv.ts reader the page
 * uses and returns the rows as JSON, for anyone who wants to pull this into
 * another tool rather than open a spreadsheet. Gated by the same reviewer
 * Basic Auth as the page (middleware.ts) — this is the same sensitive
 * accuracy/reasoning data, not a public export.
 */
export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get("format") === "json" ? "json" : "csv";

  let text: string;
  try {
    text = await readFile(RESULTS_PATH, "utf-8");
  } catch (err) {
    const status = err instanceof Error && "code" in err && err.code === "ENOENT" ? 404 : 500;
    return NextResponse.json({ error: getErrorMessage(err) }, { status });
  }

  if (format === "json") {
    const rows = parseEvalResultsCsv(text);
    return new NextResponse(JSON.stringify(rows, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="eval-results.json"',
      },
    });
  }

  return new NextResponse(text, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="eval-results.csv"',
    },
  });
}
