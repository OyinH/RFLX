import Link from "next/link";
import { getIncidentsByDecision, INCIDENT_LIST_PAGE_SIZE } from "@/lib/supabase/queries";
import { getErrorMessage } from "@/lib/errors";
import { resolveDateRange } from "@/lib/ui/date-range";
import { buildIncidentQuery, parseRiskTier, parseInjectionFilter, parseSortField, parseSortDir } from "@/lib/ui/incident-query";
import { IncidentLogTable } from "./IncidentLogTable";
import { PaginationControls } from "../PaginationControls";
import { DateRangeFilter } from "../DateRangeFilter";
import { FilterSortBar } from "../FilterSortBar";

/**
 * Read-only incident log — the counterpart to the review queue for
 * already-terminal decisions (auto_approve, block) that never went to a
 * human reviewer in the first place. Reachable from the clickable stat
 * numbers on the landing page and dashboard, plus the main nav.
 *
 * force-dynamic for the same reason as review-queue/dashboard: Next.js can't
 * detect a Supabase client call is a dynamic data source, so without this it
 * statically prerenders once at build time and serves a frozen snapshot.
 *
 * risk/injection/sort/dir filter and order server-side (lib/supabase/queries.ts) —
 * same fix as the review queue: IncidentLogTable used to filter/sort
 * client-side over just the current page's already-fetched rows.
 */
export const dynamic = "force-dynamic";

// Newest first — this is a history view, not a work queue. Distinct from
// app/review-queue/page.tsx's oldest-first default. Only applies when
// `sort`/`dir` aren't present in the URL at all.
const DEFAULT_SORT_FIELD = "created_at" as const;
const DEFAULT_SORT_ASCENDING = false;

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
  searchParams: Promise<{
    decision?: string;
    page?: string;
    from?: string;
    to?: string;
    risk?: string;
    injection?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const params = await searchParams;
  const decision = isValidDecision(params.decision) ? params.decision : "block";
  const page = Math.max(1, Math.trunc(Number(params.page)) || 1);
  const dateRange = resolveDateRange(params.from, params.to);
  const riskTier = parseRiskTier(params.risk);
  const injection = parseInjectionFilter(params.injection);
  const sortField = parseSortField(params.sort) ?? DEFAULT_SORT_FIELD;
  const sortAscending = params.sort ? (parseSortDir(params.dir) ?? "asc") === "asc" : DEFAULT_SORT_ASCENDING;

  const isFiltered = Boolean(dateRange.startTs || dateRange.endTs || riskTier || injection);

  const current = {
    decision,
    from: params.from,
    to: params.to,
    risk: riskTier,
    injection,
    sort: sortField,
    dir: sortAscending ? ("asc" as const) : ("desc" as const),
  };
  const query = buildIncidentQuery(current);

  let loadError: string | null = null;
  let incidents: Awaited<ReturnType<typeof getIncidentsByDecision>>["incidents"] = [];
  let totalCount = 0;

  try {
    const result = await getIncidentsByDecision(
      decision,
      page,
      INCIDENT_LIST_PAGE_SIZE,
      { dateRange, riskTier, injectionFlag: injection === undefined ? undefined : injection === "flagged" },
      { field: sortField, ascending: sortAscending },
    );
    incidents = result.incidents;
    totalCount = result.totalCount;
  } catch (err) {
    loadError = getErrorMessage(err);
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / INCIDENT_LIST_PAGE_SIZE));
  const isOutOfRangePage = !loadError && totalCount > 0 && incidents.length === 0;
  // Distinct from the above: a filter combination that legitimately matches
  // nothing, vs. a stale/out-of-range ?page= on an otherwise non-empty
  // filtered set.
  const isEmptyFilteredResult = !loadError && totalCount === 0 && isFiltered;
  const clearFilterHref = `/incidents?decision=${decision}`;

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-12">
      <header>
        <h1 className="text-xl font-semibold text-text-primary">Incident Log</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Already-decided actions — auto-approved or blocked automatically, never routed to a reviewer. Read-only.
          {totalCount > 0 ? ` ${totalCount.toLocaleString()} total.` : ""}
          {dateRange.startTs || dateRange.endTs
            ? ` Between ${params.from ?? "the beginning"} and ${params.to ?? "now"}.`
            : ""}
        </p>
      </header>

      <nav aria-label="Decision filter" className="mt-6 flex gap-2 border-b border-border">
        {TABS.map((tab) => {
          const tabQuery = buildIncidentQuery({ ...current, decision: tab.value, page: undefined });
          return (
            <Link
              key={tab.value}
              href={`/incidents?${tabQuery}`}
              aria-current={decision === tab.value ? "page" : undefined}
              className={
                decision === tab.value
                  ? "border-b-2 border-primary px-1 pb-3 text-sm font-semibold text-primary"
                  : "border-b-2 border-transparent px-1 pb-3 text-sm font-medium text-text-secondary hover:text-text-primary"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 space-y-4">
        <DateRangeFilter basePath="/incidents" current={current} />
        <FilterSortBar basePath="/incidents" current={current} />
      </div>

      {loadError ? (
        <div className="mt-6 rounded-lg border border-risk-critical bg-surface p-6">
          <p className="text-sm font-medium text-risk-critical">Could not load the incident log.</p>
          <p className="mt-1 text-xs text-text-secondary">{loadError}</p>
        </div>
      ) : isEmptyFilteredResult ? (
        <div className="mt-6 rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-secondary">
            No {decision === "block" ? "blocked" : "auto-approved"} incidents match the current filters.{" "}
            <Link href={clearFilterHref} className="text-primary underline">
              Clear filters
            </Link>
            .
          </p>
        </div>
      ) : isOutOfRangePage ? (
        <div className="mt-6 rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-secondary">
            No incidents on page {page}.{" "}
            <Link href={query ? `/incidents?${query}` : "/incidents"} className="text-primary underline">
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
          <PaginationControls route="/incidents" query={query} page={page} totalPages={totalPages} />
        </>
      )}
    </main>
  );
}
