import type { IncidentDetail } from "@/lib/supabase/queries";
import { IncidentLogRow } from "./IncidentLogRow";

/**
 * Read-only counterpart to app/review-queue/ReviewQueueTable.tsx — same plain
 * list renderer now that filtering/sorting happen server-side
 * (app/FilterSortBar.tsx, app/DateRangeFilter.tsx, lib/supabase/queries.ts).
 */
export function IncidentLogTable({ incidents, emptyLabel }: { incidents: IncidentDetail[]; emptyLabel: string }) {
  if (incidents.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm text-text-secondary">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="mt-6 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {incidents.map((incident) => (
        <IncidentLogRow key={incident.id} incident={incident} />
      ))}
    </div>
  );
}
