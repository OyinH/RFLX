import Link from "next/link";

/**
 * Plain server-rendered nav (no client JS needed) — page.tsx is
 * force-dynamic, so a new page number is just a normal navigation that
 * re-runs getEscalatedIncidents() with a different offset.
 *
 * `dateQuery` (e.g. "from=2026-08-13&to=2026-08-14", or "" when unfiltered)
 * carries the active date-range filter along so paging within a narrowed
 * range doesn't silently drop back to the unfiltered queue.
 */
export function PaginationControls({
  page,
  totalPages,
  dateQuery = "",
}: {
  page: number;
  totalPages: number;
  dateQuery?: string;
}) {
  if (totalPages <= 1) return null;

  const hrefForPage = (n: number) => `/review-queue?${dateQuery ? `${dateQuery}&` : ""}page=${n}`;

  return (
    <nav
      className="mt-6 flex items-center justify-between border-t border-border pt-4"
      aria-label="Review queue pagination"
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
