import { getEscalatedIncidents } from "@/lib/supabase/queries";
import { getErrorMessage } from "@/lib/errors";
import { ReviewQueueTable } from "./ReviewQueueTable";

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
 */
export const dynamic = "force-dynamic";
export default async function ReviewQueuePage() {
  let loadError: string | null = null;
  let incidents: Awaited<ReturnType<typeof getEscalatedIncidents>> = [];

  try {
    incidents = await getEscalatedIncidents();
  } catch (err) {
    loadError = getErrorMessage(err);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header>
        <h1 className="text-xl font-semibold text-text-primary">Review Queue</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Escalated actions awaiting a human decision, oldest first.
        </p>
      </header>

      {loadError ? (
        <div className="mt-6 rounded-lg border border-risk-critical bg-surface p-6">
          <p className="text-sm font-medium text-risk-critical">Could not load the review queue.</p>
          <p className="mt-1 text-xs text-text-secondary">{loadError}</p>
        </div>
      ) : (
        <ReviewQueueTable incidents={incidents} />
      )}
    </main>
  );
}
