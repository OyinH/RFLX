"use client";

import { useMemo, useState } from "react";
import type { IncidentDetail } from "@/lib/supabase/queries";
import type { RiskTier } from "@/lib/supabase/types";
import { IncidentLogRow } from "./IncidentLogRow";

const RISK_ORDER: Record<RiskTier, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const RISK_TIER_OPTIONS: (RiskTier | "all")[] = ["all", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

type SortKey = "created_at" | "risk_tier";
type SortDir = "asc" | "desc";

/**
 * Read-only counterpart to app/review-queue/ReviewQueueTable.tsx — same
 * client-side filter/sort convention (docs/design.md's Tables convention),
 * different empty-state copy per decision type since "no actions awaiting
 * review" doesn't make sense for an already-decided log.
 */
export function IncidentLogTable({
  incidents,
  emptyLabel,
}: {
  incidents: IncidentDetail[];
  emptyLabel: string;
}) {
  const [riskFilter, setRiskFilter] = useState<RiskTier | "all">("all");
  const [injectionFilter, setInjectionFilter] = useState<"all" | "flagged" | "clear">("all");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const visible = useMemo(() => {
    let rows = incidents;
    if (riskFilter !== "all") {
      rows = rows.filter((i) => i.risk_classification.risk_tier === riskFilter);
    }
    if (injectionFilter !== "all") {
      const wantFlagged = injectionFilter === "flagged";
      rows = rows.filter((i) => i.risk_classification.injection_flag === wantFlagged);
    }

    const sorted = [...rows].sort((a, b) => {
      const cmp =
        sortKey === "created_at"
          ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          : RISK_ORDER[a.risk_classification.risk_tier] - RISK_ORDER[b.risk_classification.risk_tier];
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [incidents, riskFilter, injectionFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  if (incidents.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm text-text-secondary">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-4">
        <label className="flex items-center gap-2 text-xs font-medium text-text-secondary">
          Risk tier
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value as RiskTier | "all")}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text-primary"
          >
            {RISK_TIER_OPTIONS.map((tier) => (
              <option key={tier} value={tier}>
                {tier === "all" ? "All" : tier}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs font-medium text-text-secondary">
          Injection
          <select
            value={injectionFilter}
            onChange={(e) => setInjectionFilter(e.target.value as "all" | "flagged" | "clear")}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text-primary"
          >
            <option value="all">All</option>
            <option value="flagged">Flagged</option>
            <option value="clear">Not flagged</option>
          </select>
        </label>

        <div className="ml-auto flex items-center gap-2 text-xs font-medium text-text-secondary">
          Sort by
          <button
            type="button"
            onClick={() => toggleSort("created_at")}
            className={`rounded-md border border-border px-2 py-1 ${sortKey === "created_at" ? "bg-primary text-white" : "bg-bg text-text-primary"}`}
          >
            Time {sortKey === "created_at" ? (sortDir === "asc" ? "↑" : "↓") : ""}
          </button>
          <button
            type="button"
            onClick={() => toggleSort("risk_tier")}
            className={`rounded-md border border-border px-2 py-1 ${sortKey === "risk_tier" ? "bg-primary text-white" : "bg-bg text-text-primary"}`}
          >
            Risk {sortKey === "risk_tier" ? (sortDir === "asc" ? "↑" : "↓") : ""}
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-secondary">No incidents match the current filters.</p>
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {visible.map((incident) => (
            <IncidentLogRow key={incident.id} incident={incident} />
          ))}
        </div>
      )}
    </div>
  );
}
