"use client";

import { useRouter } from "next/navigation";
import { buildIncidentQuery, type IncidentListParams, type SortField } from "@/lib/ui/incident-query";
import type { RiskTier } from "@/lib/supabase/types";

const RISK_TIER_OPTIONS: (RiskTier | "all")[] = ["all", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

/**
 * Server-side risk-tier/injection-flag filter + time/risk sort, shared by the
 * Review Queue and Incident Log — replaces what used to be client-side-only
 * controls in ReviewQueueTable/IncidentLogTable that filtered/sorted just the
 * 25 rows already fetched for the current page, not the full result set
 * (same class of bug DateRangeFilter fixed for dates: confirmed live, "sort
 * by risk" on page 1 only ever reordered that page's own rows).
 *
 * `current` is the full resolved param set for this page load (defaults
 * already applied server-side, e.g. Review Queue's oldest-first vs Incident
 * Log's newest-first when `sort`/`dir` aren't in the URL) — this component
 * only ever reads/writes risk/injection/sort/dir, preserving every other
 * param (date range, decision tab) via buildIncidentQuery. Any change here
 * resets to page 1, same reasoning as DateRangeFilter: a different
 * filter/sort invalidates whatever page offset was in view.
 */
export function FilterSortBar({ basePath, current }: { basePath: string; current: IncidentListParams }) {
  const router = useRouter();

  function navigate(next: Partial<IncidentListParams>) {
    const qs = buildIncidentQuery({ ...current, ...next, page: undefined });
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  function toggleSort(field: SortField) {
    if (current.sort === field) {
      navigate({ dir: current.dir === "asc" ? "desc" : "asc" });
    } else {
      navigate({ sort: field, dir: "asc" });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-4">
      <label className="flex items-center gap-2 text-xs font-medium text-text-secondary">
        Risk tier
        <select
          value={current.risk ?? "all"}
          onChange={(e) => navigate({ risk: e.target.value === "all" ? undefined : (e.target.value as RiskTier) })}
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
          value={current.injection ?? "all"}
          onChange={(e) =>
            navigate({ injection: e.target.value === "all" ? undefined : (e.target.value as "flagged" | "clear") })
          }
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
          className={`rounded-md border border-border px-2 py-1 ${current.sort === "created_at" ? "bg-primary text-white" : "bg-bg text-text-primary"}`}
        >
          Time {current.sort === "created_at" ? (current.dir === "asc" ? "↑" : "↓") : ""}
        </button>
        <button
          type="button"
          onClick={() => toggleSort("risk_tier")}
          className={`rounded-md border border-border px-2 py-1 ${current.sort === "risk_tier" ? "bg-primary text-white" : "bg-bg text-text-primary"}`}
        >
          Risk {current.sort === "risk_tier" ? (current.dir === "asc" ? "↑" : "↓") : ""}
        </button>
      </div>
    </div>
  );
}
