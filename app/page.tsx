import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-bg px-6 py-12">
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-text-primary">rflx.ai</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Clinical AI agent guardrail middleware — screens a proposed agent action for manipulation, classifies
            clinical risk, and returns one governed decision with a full audit trail.
          </p>
        </header>

        <section className="rounded-lg border border-border bg-surface p-6">
          <h2 className="text-lg font-medium text-text-primary">Get started</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Escalated actions awaiting review, and aggregate incident trends.
          </p>
          <div className="mt-3 flex gap-3">
            <Link
              href="/review-queue"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
            >
              Open Review Queue
            </Link>
            <Link
              href="/dashboard"
              className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-bg"
            >
              Open Dashboard
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
