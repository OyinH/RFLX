import Link from "next/link";

/**
 * Plain server-rendered nav (no client JS needed) — page.tsx is
 * force-dynamic, so a new page number is just a normal navigation that
 * re-runs getEscalatedIncidents() with a different offset.
 */
export function PaginationControls({ page, totalPages }: { page: number; totalPages: number }) {
  if (totalPages <= 1) return null;

  return (
    <nav
      className="mt-6 flex items-center justify-between border-t border-border pt-4"
      aria-label="Review queue pagination"
    >
      {page > 1 ? (
        <Link
          href={`/review-queue?page=${page - 1}`}
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
          href={`/review-queue?page=${page + 1}`}
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
