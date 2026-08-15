"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EvalSummary } from "@/lib/eval/score";

const PASS_COLOR = "var(--color-decision-approve)";
const FAIL_COLOR = "var(--color-decision-block)";

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function MetricTile({
  label,
  value,
  target,
  passed,
}: {
  label: string;
  value: string;
  target: string;
  passed: boolean;
}) {
  return (
    <div className={`rounded-lg border-l-4 border border-border bg-surface p-6 ${passed ? "border-l-decision-approve" : "border-l-decision-block"}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-2 text-2xl font-semibold" style={{ color: passed ? PASS_COLOR : FAIL_COLOR }}>
        {value}
      </p>
      <p className="mt-1 text-xs text-text-secondary">Target: {target}</p>
    </div>
  );
}

function downloadHref(format: "csv" | "json"): string {
  return `/api/eval/download?format=${format}`;
}

export function EvalResultsView({ summary }: { summary: EvalSummary }) {
  return (
    <div className="mt-6 space-y-6">
      <div
        className={`flex items-center justify-between rounded-lg border p-4 ${
          summary.goNoGo ? "border-decision-approve bg-surface" : "border-decision-block bg-surface"
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className="rounded-full px-3 py-1 text-sm font-semibold text-white"
            style={{ backgroundColor: summary.goNoGo ? PASS_COLOR : FAIL_COLOR }}
          >
            Go/No-Go: {summary.goNoGo ? "PASS" : "FAIL"}
          </span>
          <span className="text-sm text-text-secondary">
            {summary.totalCases} cases — {summary.injectionCount} injection, {summary.benignCount} benign
          </span>
        </div>
        <div className="flex gap-2">
          <a
            href={downloadHref("csv")}
            download="eval-results.csv"
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg"
          >
            Download CSV
          </a>
          <a
            href={downloadHref("json")}
            download="eval-results.json"
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg"
          >
            Download JSON
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricTile
          label="Injection catch rate"
          value={pct(summary.catchRate)}
          target={`≥ ${pct(summary.thresholds.catchRate)}`}
          passed={summary.catchRate >= summary.thresholds.catchRate}
        />
        <MetricTile
          label="Benign false-positive rate"
          value={pct(summary.falsePositiveRate)}
          target={`< ${pct(summary.thresholds.falsePositiveRate)}`}
          passed={summary.falsePositiveRate < summary.thresholds.falsePositiveRate}
        />
        <MetricTile
          label="P95 latency"
          value={`${summary.p95LatencyMs.toLocaleString()}ms`}
          target={`< ${summary.thresholds.p95LatencyMs.toLocaleString()}ms`}
          passed={summary.p95LatencyMs < summary.thresholds.p95LatencyMs}
        />
      </div>

      <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-lg font-medium text-text-primary">Catch rate by injection strategy × harm stratum</h2>
        {summary.catchRateByStrategyStratum.length === 0 ? (
          <p className="mt-4 text-sm text-text-secondary">No injection cases in this run.</p>
        ) : (
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.catchRateByStrategyStratum.map((r) => ({ ...r, ratePct: r.rate * 100 }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="key" tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }} unit="%" />
                <Tooltip formatter={(value: number, _name, item) => [`${value.toFixed(1)}% (${item.payload.passed}/${item.payload.total})`, "Catch rate"]} />
                <Bar dataKey="ratePct" fill="var(--color-primary)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-lg font-medium text-text-primary">False-positive rate by fairness dimension</h2>
        <p className="mt-1 text-xs text-text-secondary">
          docs/engineering/architecture.md&apos;s fairness stratification — flags a stratum where the false-positive rate
          diverges sharply from the aggregate, not a full fairness audit.
        </p>
        {summary.falsePositiveByFairnessDimension.length === 0 ? (
          <p className="mt-4 text-sm text-text-secondary">No benign cases in this run.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-text-secondary">
                  <th className="py-2 pr-4">Dimension</th>
                  <th className="py-2 pr-4">Value</th>
                  <th className="py-2 pr-4">False positives</th>
                  <th className="py-2">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.falsePositiveByFairnessDimension.map((row) => (
                  <tr key={`${row.dimension}-${row.value}`}>
                    <td className="py-2 pr-4 text-text-secondary">{row.dimension}</td>
                    <td className="py-2 pr-4 font-medium text-text-primary">{row.value}</td>
                    <td className="py-2 pr-4 text-text-primary">
                      {row.failed}/{row.total}
                    </td>
                    <td className="py-2" style={{ color: row.rate > 0 ? FAIL_COLOR : "var(--color-text-primary)" }}>
                      {pct(row.rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {summary.errors.length > 0 ? (
        <div className="rounded-lg border border-risk-critical bg-surface p-6">
          <h2 className="text-lg font-medium text-risk-critical">{summary.errors.length} case(s) errored</h2>
          <ul className="mt-2 space-y-1 text-xs text-text-secondary">
            {summary.errors.map((e) => (
              <li key={e.id}>
                <span className="font-medium text-text-primary">{e.id}</span>: {e.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
