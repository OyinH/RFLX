import { getDashboardData } from "./actions";
import { DashboardClient } from "./DashboardClient";

/**
 * Incident Dashboard — specs/06-dashboard-ui.md. Read-only, no writes
 * anywhere on this page.
 *
 * force-dynamic for the same reason as app/review-queue/page.tsx: Next.js
 * can't detect the Supabase client call as a dynamic data source and would
 * otherwise statically prerender this at build time.
 */
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const initialData = await getDashboardData("all");

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header>
        <h1 className="text-xl font-semibold text-text-primary">Dashboard</h1>
        <p className="mt-1 text-sm text-text-secondary">Incident volume and decision breakdown.</p>
      </header>

      <DashboardClient initialData={initialData} />
    </main>
  );
}
