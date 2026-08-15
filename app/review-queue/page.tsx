import Link from "next/link";
import { getEscalatedIncidents, INCIDENT_LIST_PAGE_SIZE } from "@/lib/supabase/queries";
import { getErrorMessage } from "@/lib/errors";
import { ReviewQueueTable } from "./ReviewQueueTable";
import { PaginationControls } from "./PaginationControls";
import { DateRangeFilter } from "./DateRangeFilter";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// `from`/`to` are date-only (native <input type="date"> values, no time
// component) — resolved to UTC day boundaries here so the query layer
// (lib/supabase/queries.ts) only ever deals in already-resolved timestamps.
// `to` is inclusive of the whole day, hence the +1-day exclusive upper bound.
function toValidUtcDate(value?: string): Date | undefined {
  if (!value || !DATE_ONLY.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function resolveDateRange(from?: string, to?: string): { startTs?: string; endTs?: string } {
  const startDate = toValidUtcDate(from);
  const endDate = toValidUtcDate(to);
  return {
    startTs: startDate?.toISOString(),
    endTs: endDate ? new Date(endDate.getTime() + 86_400_000).toISOString() : undefined,
  };
}

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
 */
export const dynamic = "force-dynamic";
export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; from?: string; to?: string }>;
}) {
  const { page: pageParam, from, to } = await searchParams;
  const page = Math.max(1, Math.trunc(Number(pageParam)) || 1);
  const dateRange = resolveDateRange(from, to);
  const isDateFiltered = Boolean(dateRange.startTs || dateRange.endTs);

  const dateQueryParams = new URLSearchParams();
  if (dateRange.startTs && DATE_ONLY.test(from ?? "")) dateQueryParams.set("from", from!);
  if (dateRange.endTs && DATE_ONLY.test(to ?? "")) dateQueryParams.set("to", to!);
  const dateQuery = dateQueryParams.toString();

  let loadError: string | null = null;
  let incidents: Awaited<ReturnType<typeof getEscalatedIncidents>>["incidents"] = [];
  let totalCount = 0;

  try {
    const result = await getEscalatedIncidents(page, INCIDENT_LIST_PAGE_SIZE, dateRange);
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
  // Distinct from both: a date range that legitimately matches nothing
  // (typo'd date, or a range with no pending incidents in it) — "back to
  // page 1" would be misleading here since page 1 of the *unfiltered* queue
  // is exactly what the reviewer was trying to skip past.
  const isEmptyFilteredRange = !loadError && totalCount === 0 && isDateFiltered;

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-12">
      <header>
        <h1 className="text-xl font-semibold text-text-primary">Review Queue</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Escalated actions awaiting a human decision, oldest first
          {totalCount > 0 ? ` — ${totalCount} pending` : ""}
          {isDateFiltered ? ` between ${from ?? "the beginning"} and ${to ?? "now"}` : ""}.
        </p>
      </header>

      <div className="mt-6">
        <DateRangeFilter from={from} to={to} />
      </div>

      {loadError ? (
        <div className="mt-6 rounded-lg border border-risk-critical bg-surface p-6">
          <p className="text-sm font-medium text-risk-critical">Could not load the review queue.</p>
          <p className="mt-1 text-xs text-text-secondary">{loadError}</p>
        </div>
      ) : isEmptyFilteredRange ? (
        <div className="mt-6 rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-secondary">
            No pending incidents between {from ?? "the beginning"} and {to ?? "now"}.{" "}
            <Link href="/review-queue" className="text-primary underline">
              Clear date filter
            </Link>
            .
          </p>
        </div>
      ) : isOutOfRangePage ? (
        <div className="mt-6 rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-secondary">
            No incidents on page {page}.{" "}
            <Link href={dateQuery ? `/review-queue?${dateQuery}` : "/review-queue"} className="text-primary underline">
              Back to page 1
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <ReviewQueueTable incidents={incidents} />
          <PaginationControls page={page} totalPages={totalPages} dateQuery={dateQuery} />
        </>
      )}
    </main>
  );
}
