import Link from "next/link";
import { getIncidentsByDecision, INCIDENT_LIST_PAGE_SIZE } from "@/lib/supabase/queries";
import { getErrorMessage } from "@/lib/errors";
import { resolveDateRange, buildDateQuery } from "@/lib/ui/date-range";
import { IncidentLogTable } from "./IncidentLogTable";
import { PaginationControls } from "./PaginationControls";
import { DateRangeFilter } from "../DateRangeFilter";

/**
 * Read-only incident log — the counterpart to the review queue for
 * already-terminal decisions (auto_approve, block) that never went to a
 * human reviewer in the first place. Reachable from the clickable stat
 * numbers on the landing page and dashboard, plus the main nav.
 *
 * force-dynamic for the same reason as review-queue/dashboard: Next.js can't
 * detect a Supabase client call is a dynamic data source, so without this it
 * statically prerenders once at build time and serves a frozen snapshot.
 */
export const dynamic = "force-dynamic";

const TABS = [
  { value: "block" as const, label: "Blocked" },
  { value: "auto_approve" as const, label: "Auto-approved" },
];

function isValidDecision(value: string | undefined): value is "block" | "auto_approve" {
  return value === "block" || value === "auto_approve";
}

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ decision?: string; page?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const decision = isValidDecision(params.decision) ? params.decision : "block";
  const page = Math.max(1, Math.trunc(Number(params.page)) || 1);
  const { from, to } = params;
  const dateRange = resolveDateRange(from, to);
  const isDateFiltered = Boolean(dateRange.startTs || dateRange.endTs);
  const dateQuery = buildDateQuery(from, to);

  let loadError: string | null = null;
  let incidents: Awaited<ReturnType<typeof getIncidentsByDecision>>["incidents"] = [];
  let totalCount = 0;

  try {
    const result = await getIncidentsByDecision(decision, page, INCIDENT_LIST_PAGE_SIZE, dateRange);
    incidents = result.incidents;
    totalCount = result.totalCount;
  } catch (err) {
    loadError = getErrorMessage(err);
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / INCIDENT_LIST_PAGE_SIZE));
  const isOutOfRangePage = !loadError && totalCount > 0 && incidents.length === 0;
  // Distinct from the above: a date range that legitimately matches nothing,
  // vs. a stale/out-of-range ?page= on an otherwise non-empty filtered set.
  const isEmptyFilteredRange = !loadError && totalCount === 0 && isDateFiltered;
  const basePath = `/incidents?decision=${decision}${dateQuery ? `&${dateQuery}` : ""}`;
  const clearFilterHref = `/incidents?decision=${decision}`;

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-12">
      <header>
        <h1 className="text-xl font-semibold text-text-primary">Incident Log</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Already-decided actions — auto-approved or blocked automatically, never routed to a reviewer. Read-only.
          {totalCount > 0 ? ` ${totalCount.toLocaleString()} total.` : ""}
          {isDateFiltered ? ` Between ${from ?? "the beginning"} and ${to ?? "now"}.` : ""}
        </p>
      </header>

      <nav aria-label="Decision filter" className="mt-6 flex gap-2 border-b border-border">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/incidents?decision=${tab.value}${dateQuery ? `&${dateQuery}` : ""}`}
            aria-current={decision === tab.value ? "page" : undefined}
            className={
              decision === tab.value
                ? "border-b-2 border-primary px-1 pb-3 text-sm font-semibold text-primary"
                : "border-b-2 border-transparent px-1 pb-3 text-sm font-medium text-text-secondary hover:text-text-primary"
            }
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        <DateRangeFilter basePath="/incidents" from={from} to={to} extraParams={{ decision }} />
      </div>

      {loadError ? (
        <div className="mt-6 rounded-lg border border-risk-critical bg-surface p-6">
          <p className="text-sm font-medium text-risk-critical">Could not load the incident log.</p>
          <p className="mt-1 text-xs text-text-secondary">{loadError}</p>
        </div>
      ) : isEmptyFilteredRange ? (
        <div className="mt-6 rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-secondary">
            No {decision === "block" ? "blocked" : "auto-approved"} incidents between {from ?? "the beginning"} and{" "}
            {to ?? "now"}.{" "}
            <Link href={clearFilterHref} className="text-primary underline">
              Clear date filter
            </Link>
            .
          </p>
        </div>
      ) : isOutOfRangePage ? (
        <div className="mt-6 rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-secondary">
            No incidents on page {page}.{" "}
            <Link href={basePath} className="text-primary underline">
              Back to page 1
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <IncidentLogTable
            incidents={incidents}
            emptyLabel={decision === "block" ? "No blocked actions." : "No auto-approved actions."}
          />
          <PaginationControls basePath={basePath} page={page} totalPages={totalPages} />
        </>
      )}
    </main>
  );
}
