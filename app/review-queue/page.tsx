import Link from "next/link";
import { getEscalatedIncidents, INCIDENT_LIST_PAGE_SIZE } from "@/lib/supabase/queries";
import { getErrorMessage } from "@/lib/errors";
import { resolveDateRange } from "@/lib/ui/date-range";
import { buildIncidentQuery, parseRiskTier, parseInjectionFilter, parseSortField, parseSortDir } from "@/lib/ui/incident-query";
import { ReviewQueueTable } from "./ReviewQueueTable";
import { PaginationControls } from "../PaginationControls";
import { DateRangeFilter } from "../DateRangeFilter";
import { FilterSortBar } from "../FilterSortBar";

// Oldest-first — specs/05-review-queue-ui.md: process the longest-waiting
// escalations first. Distinct from app/incidents/page.tsx's newest-first
// default (a history view, not a work queue) — both defaults only apply when
// `sort`/`dir` aren't present in the URL at all.
const DEFAULT_SORT_FIELD = "created_at" as const;
const DEFAULT_SORT_ASCENDING = true;

/**
 * Review Queue — specs/05-review-queue-ui.md. Server Component: reads
 * getEscalatedIncidents() directly, never through the Gateway API and never
 * via the browser Supabase client.
 *
 * force-dynamic is required, not optional: Next.js can't detect that a
 * Supabase client call is a dynamic data source, so without this it
 * statically prerenders the page once at build time and serves that frozen
 * snapshot on every request — verified directly (the build baked in "Could
 * not load the review queue" from a build-time query against a table that
 * didn't exist yet).
 *
 * Paginated via a `?page=` search param rather than fetching every pending
 * incident — the queue grows unboundedly (verified live: 500+ pending
 * incidents produced a multi-megabyte unpaginated page). `page` is just a
 * normal navigation on a force-dynamic route, so no client state is needed
 * for it.
 *
 * risk/injection/sort/dir filter and order server-side (lib/supabase/queries.ts) —
 * previously ReviewQueueTable filtered/sorted client-side over just the
 * current page's already-fetched rows, which silently only ever affected
 * that one page, not the full backlog (same class of bug the date filter
 * fixed: verified live, "sort by risk" on page 1 only reordered 25 rows out
 * of 700+ pending incidents).
 */
export const dynamic = "force-dynamic";
export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; from?: string; to?: string; risk?: string; injection?: string; sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Math.trunc(Number(params.page)) || 1);
  const dateRange = resolveDateRange(params.from, params.to);
  const riskTier = parseRiskTier(params.risk);
  const injection = parseInjectionFilter(params.injection);
  const sortField = parseSortField(params.sort) ?? DEFAULT_SORT_FIELD;
  const sortAscending = params.sort ? (parseSortDir(params.dir) ?? "asc") === "asc" : DEFAULT_SORT_ASCENDING;

  const isFiltered = Boolean(dateRange.startTs || dateRange.endTs || riskTier || injection);

  // Full param set as it actually resolved (used to build every control's
  // "preserve everything else" query — DateRangeFilter, FilterSortBar,
  // PaginationControls all read from this single source rather than each
  // hand-assembling their own subset).
  const current = {
    from: params.from,
    to: params.to,
    risk: riskTier,
    injection,
    sort: sortField,
    dir: sortAscending ? ("asc" as const) : ("desc" as const),
  };
  const query = buildIncidentQuery(current);

  let loadError: string | null = null;
  let incidents: Awaited<ReturnType<typeof getEscalatedIncidents>>["incidents"] = [];
  let totalCount = 0;

  try {
    const result = await getEscalatedIncidents(
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
  // Distinct from a genuinely empty queue (totalCount === 0, which
  // ReviewQueueTable already renders its own "no actions awaiting review"
  // state for) — this is a stale/out-of-range page link, e.g. after enough
  // incidents on it were reviewed since the link was generated.
  const isOutOfRangePage = !loadError && totalCount > 0 && incidents.length === 0;
  // Distinct from both: a filter combination (date/risk/injection) that
  // legitimately matches nothing — "back to page 1" would be misleading here
  // since page 1 of the *unfiltered* queue is exactly what the reviewer was
  // trying to skip past.
  const isEmptyFilteredResult = !loadError && totalCount === 0 && isFiltered;

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-12">
      <header>
        <h1 className="text-xl font-semibold text-text-primary">Review Queue</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Escalated actions awaiting a human decision
          {totalCount > 0 ? ` — ${totalCount} pending` : ""}
          {dateRange.startTs || dateRange.endTs
            ? ` between ${params.from ?? "the beginning"} and ${params.to ?? "now"}`
            : ""}
          .
        </p>
      </header>

      <div className="mt-6 space-y-4">
        <DateRangeFilter basePath="/review-queue" current={current} />
        <FilterSortBar basePath="/review-queue" current={current} />
      </div>

      {loadError ? (
        <div className="mt-6 rounded-lg border border-risk-critical bg-surface p-6">
          <p className="text-sm font-medium text-risk-critical">Could not load the review queue.</p>
          <p className="mt-1 text-xs text-text-secondary">{loadError}</p>
        </div>
      ) : isEmptyFilteredResult ? (
        <div className="mt-6 rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-secondary">
            No pending incidents match the current filters.{" "}
            <Link href="/review-queue" className="text-primary underline">
              Clear filters
            </Link>
            .
          </p>
        </div>
      ) : isOutOfRangePage ? (
        <div className="mt-6 rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-secondary">
            No incidents on page {page}.{" "}
            <Link href={query ? `/review-queue?${query}` : "/review-queue"} className="text-primary underline">
              Back to page 1
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <ReviewQueueTable incidents={incidents} />
          <PaginationControls route="/review-queue" query={query} page={page} totalPages={totalPages} />
        </>
      )}
    </main>
  );
}
