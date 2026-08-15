"use client";

import { useRouter } from "next/navigation";

/**
 * Server-side date-range filter — distinct from ReviewQueueTable's risk/injection/
 * sort controls, which only reorder or filter the 25 rows already fetched for the
 * current page. With a large oldest-first backlog (verified live: 693 unreviewed
 * incidents from a single earlier day ahead of the most recent ones in the queue),
 * a reviewer needs to jump straight to a date rather than page through hundreds of
 * older rows to reach it — this navigates to a new URL so page.tsx re-runs
 * getEscalatedIncidents() with a narrower query, not a client-side re-sort.
 *
 * No date-picker library — the native <input type="date"> already provides a
 * calendar UI in every evergreen browser, proportionate to this project's scope.
 */
export function DateRangeFilter({ from, to }: { from?: string; to?: string }) {
  const router = useRouter();

  function apply(nextFrom?: string, nextTo?: string) {
    const params = new URLSearchParams();
    if (nextFrom) params.set("from", nextFrom);
    if (nextTo) params.set("to", nextTo);
    // Omitting `page` resets to page 1 — a different date range invalidates
    // whatever page offset was in view.
    const qs = params.toString();
    router.push(qs ? `/review-queue?${qs}` : "/review-queue");
  }

  const hasFilter = Boolean(from || to);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4">
      <label className="flex items-center gap-2 text-xs font-medium text-text-secondary">
        From
        <input
          type="date"
          value={from ?? ""}
          max={to}
          onChange={(e) => apply(e.target.value || undefined, to)}
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text-primary"
        />
      </label>
      <label className="flex items-center gap-2 text-xs font-medium text-text-secondary">
        To
        <input
          type="date"
          value={to ?? ""}
          min={from}
          onChange={(e) => apply(from, e.target.value || undefined)}
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
