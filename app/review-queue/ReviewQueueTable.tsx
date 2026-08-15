import type { IncidentDetail } from "@/lib/supabase/queries";
import { IncidentRow } from "./IncidentRow";

/**
 * Plain list renderer — filtering (risk tier, injection flag, date range) and
 * sorting (time, risk) all happen server-side now (app/FilterSortBar.tsx,
 * app/DateRangeFilter.tsx, lib/supabase/queries.ts), so `incidents` here is
 * already exactly the page the reviewer asked for. No client state needed;
 * this used to filter/sort client-side over just the current page's already-
 * fetched rows, which silently broke once the queue outgrew one page
 * (verified live: "sort by risk" only ever reordered the 25 rows already on
 * screen, never the full 700+-incident backlog).
 */
export function ReviewQueueTable({ incidents }: { incidents: IncidentDetail[] }) {
  if (incidents.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm text-text-secondary">No actions awaiting review.</p>
      </div>
    );
  }

  return (
    <div className="mt-6 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {incidents.map((incident) => (
        <IncidentRow key={incident.id} incident={incident} />
      ))}
    </div>
  );
}
