"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getDashboardData, type DashboardData, type TimeRange } from "./actions";
import type { Decision } from "@/lib/supabase/types";

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

const DECISION_OPTIONS: { value: Decision | "all"; label: string }[] = [
  { value: "all", label: "All decisions" },
  { value: "auto_approve", label: "Auto-approve" },
  { value: "escalate", label: "Escalate" },
  { value: "block", label: "Block" },
];

const DECISION_COLOR: Record<Decision, string> = {
  auto_approve: "var(--color-decision-approve)",
  escalate: "var(--color-decision-escalate)",
  block: "var(--color-decision-block)",
};

const DECISION_LABEL: Record<Decision, string> = {
  auto_approve: "Auto-approve",
  escalate: "Escalate",
  block: "Block",
};

// escalate goes to the review queue (the work-in-progress view); the two
// terminal decisions go to the read-only incident log, deep-linked to the
// matching tab (app/incidents).
const DECISION_HREF: Record<Decision, string> = {
  auto_approve: "/incidents?decision=auto_approve",
  escalate: "/review-queue",
  block: "/incidents?decision=block",
};

function formatRate(count: number, total: number): string {
  if (total === 0) return "—";
  return `${((count / total) * 100).toFixed(1)}%`;
}

function StatTile({
  label,
  value,
  sub,
  color,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  href?: string;
}) {
  const content = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-2 text-2xl font-semibold" style={color ? { color } : undefined}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-text-secondary">{sub}</p>}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="rounded-lg border border-border bg-surface p-6 transition-colors hover:bg-bg">
        {content}
      </Link>
    );
  }

  return <div className="rounded-lg border border-border bg-surface p-6">{content}</div>;
}

export function DashboardClient({ initialData }: { initialData: DashboardData }) {
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [decisionFilter, setDecisionFilter] = useState<Decision | "all">("all");
  const [data, setData] = useState<DashboardData>(initialData);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await getDashboardData(timeRange);
      setData(result);
    });
  }, [timeRange]);

  const total = data.counts.auto_approve + data.counts.escalate + data.counts.block;

  const chartData = useMemo(() => {
    const byDay = new Map<string, Record<string, number>>();
    for (const row of data.volume) {
      const entry = byDay.get(row.day) ?? { auto_approve: 0, escalate: 0, block: 0 };
      entry[row.decision] = row.count;
      byDay.set(row.day, entry);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, counts]) => ({ day, ...counts }));
  }, [data.volume]);

  const visibleDecisions: Decision[] =
    decisionFilter === "all" ? ["auto_approve", "escalate", "block"] : [decisionFilter];

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-4">
        <label className="flex items-center gap-2 text-xs font-medium text-text-secondary">
          Time range
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as TimeRange)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text-primary"
          >
            {TIME_RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs font-medium text-text-secondary">
          Decision
          <select
            value={decisionFilter}
            onChange={(e) => setDecisionFilter(e.target.value as Decision | "all")}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text-primary"
          >
            {DECISION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {isPending && <span className="text-xs text-text-secondary">Refreshing…</span>}
      </div>

      {data.error ? (
        <div className="rounded-lg border border-risk-critical bg-surface p-6">
          <p className="text-sm font-medium text-risk-critical">Could not load dashboard data.</p>
          <p className="mt-1 text-xs text-text-secondary">{data.error}</p>
        </div>
      ) : total === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-secondary">
            {timeRange === "all" ? "No incidents recorded yet." : "No incidents in this window."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile label="Total actions" value={String(total)} />
            {(["auto_approve", "escalate", "block"] as const).map((decision) => (
              <StatTile
                key={decision}
                label={DECISION_LABEL[decision]}
                value={String(data.counts[decision])}
                sub={formatRate(data.counts[decision], total)}
                color={DECISION_COLOR[decision]}
                href={DECISION_HREF[decision]}
              />
            ))}
          </div>

          <div className="rounded-lg border border-border bg-surface p-6">
            <h2 className="text-lg font-medium text-text-primary">Incident volume by day</h2>
            <div className="mt-4 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="day" tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }} />
                  <Tooltip />
                  <Legend formatter={(value: string) => DECISION_LABEL[value as Decision] ?? value} />
                  {visibleDecisions.map((decision) => (
                    <Bar key={decision} dataKey={decision} stackId="decision" fill={DECISION_COLOR[decision]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
