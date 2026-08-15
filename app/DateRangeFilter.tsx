"use client";

import { useRouter } from "next/navigation";
import { buildIncidentQuery, type IncidentListParams } from "@/lib/ui/incident-query";

/**
 * Server-side date-range filter, shared by the Review Queue and Incident Log —
 * distinct from the risk/injection/sort controls (app/FilterSortBar.tsx),
 * which own their own params. With a large oldest/newest-first backlog
 * (verified live: 693+ unreviewed incidents from a single earlier day ahead
 * of others in the queue), a reviewer needs to jump straight to a date rather
 * than page through hundreds of rows to reach it — this navigates to a new
 * URL so the page re-runs its query with a narrower date range, not a
 * client-side re-sort.
 *
 * No date-picker library — the native <input type="date"> already provides a
 * calendar UI in every evergreen browser, proportionate to this project's scope.
 *
 * `current` is the full resolved param set for this page load — this
 * component only ever reads/writes from/to, preserving every other param
 * (risk tier, injection flag, sort, and — for the Incident Log — decision
 * tab) via buildIncidentQuery. Omitting `page` on every change is
 * deliberate: a different date range always resets to page 1.
 */
export function DateRangeFilter({ basePath, current }: { basePath: string; current: IncidentListParams }) {
  const router = useRouter();

  function apply(nextFrom?: string, nextTo?: string) {
    const qs = buildIncidentQuery({ ...current, from: nextFrom, to: nextTo, page: undefined });
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  const hasFilter = Boolean(current.from || current.to);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4">
      <label className="flex items-center gap-2 text-xs font-medium text-text-secondary">
        From
        <input
          type="date"
          value={current.from ?? ""}
          max={current.to}
          onChange={(e) => apply(e.target.value || undefined, current.to)}
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text-primary"
        />
      </label>
      <label className="flex items-center gap-2 text-xs font-medium text-text-secondary">
        To
        <input
          type="date"
          value={current.to ?? ""}
          min={current.from}
          onChange={(e) => apply(current.from, e.target.value || undefined)}
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text-primary"
        />
      </label>
      {hasFilter ? (
        <button
          type="button"
          onClick={() => apply(undefined, undefined)}
          className="text-xs font-medium text-primary underline underline-offset-2"
        >
          Clear date filter
        </button>
      ) : null}
    </div>
  );
}
