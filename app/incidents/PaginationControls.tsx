import Link from "next/link";

/**
 * Same pattern as app/review-queue/PaginationControls.tsx, generalized to
 * take a full query string prefix (basePath) since this page also carries a
 * ?decision= param that page links must preserve alongside ?page=.
 */
export function PaginationControls({
  basePath,
  page,
  totalPages,
}: {
  basePath: string;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav
      className="mt-6 flex items-center justify-between border-t border-border pt-4"
      aria-label="Incident log pagination"
    >
      {page > 1 ? (
        <Link
          href={`${basePath}&page=${page - 1}`}
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
          href={`${basePath}&page=${page + 1}`}
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
