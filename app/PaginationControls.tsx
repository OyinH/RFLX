import Link from "next/link";

/**
 * Shared by the Review Queue and Incident Log (previously two near-identical
 * per-page copies). Plain server-rendered nav (no client JS needed) — both
 * pages are force-dynamic, so a new page number is just a normal navigation
 * that re-runs the query with a different offset.
 *
 * `route` is the page path ("/review-queue" or "/incidents"). `query` is the
 * query string (no leading `?`) for every OTHER active param (date range,
 * risk tier, injection flag, sort, and — for the Incident Log — decision
 * tab), built via lib/ui/incident-query.ts's buildIncidentQuery so paging
 * never silently drops another active filter.
 */
export function PaginationControls({
  route,
  query,
  page,
  totalPages,
}: {
  route: string;
  query: string;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  const hrefForPage = (n: number) => `${route}?${query ? `${query}&` : ""}page=${n}`;

  return (
    <nav
      className="mt-6 flex items-center justify-between border-t border-border pt-4"
      aria-label="Pagination"
    >
      {page > 1 ? (
        <Link
          href={hrefForPage(page - 1)}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface"
        >
          ← Previous
        </Link>
      ) : (
        <span className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary opacity-50">
          ← Previous
        </span>
      )}

      <span className="text-xs text-text-secondary">
        Page {page} of {totalPages}
      </span>

      {page < totalPages ? (
        <Link
          href={hrefForPage(page + 1)}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface"
        >
          Next →
        </Link>
      ) : (
        <span className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary opacity-50">
          Next →
        </span>
      )}
    </nav>
  );
}
