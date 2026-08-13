import Link from "next/link";

const riskTiers = [
  { label: "LOW", className: "bg-risk-low" },
  { label: "MEDIUM", className: "bg-risk-medium" },
  { label: "HIGH", className: "bg-risk-high" },
  { label: "CRITICAL", className: "bg-risk-critical" },
] as const;

const decisions = [
  { label: "auto_approve", className: "bg-decision-approve" },
  { label: "escalate", className: "bg-decision-escalate" },
  { label: "block", className: "bg-decision-block" },
] as const;

const typeScale = [
  { token: "text-xs", className: "text-xs", note: "Metadata, table cell secondary text" },
  { token: "text-sm", className: "text-sm", note: "Table body, form labels" },
  { token: "text-base", className: "text-base", note: "Default body text" },
  { token: "text-lg", className: "text-lg", note: "Section headings" },
  { token: "text-xl", className: "text-xl", note: "Page titles" },
  { token: "text-2xl", className: "text-2xl", note: "Dashboard summary numbers" },
] as const;

/**
 * Design-token verification screen — frontend-setup's checkpoint that the
 * shell is real, not just scaffolded (skills/frontend-setup/SKILL.md step 4).
 * Every color/type value below comes from a Tailwind utility mapped to a
 * docs/design.md token; none are inline hex/pixel values.
 */
export default function Home() {
  return (
    <main className="min-h-screen bg-bg px-6 py-12">
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-text-primary">rflx.ai</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Clinical AI agent guardrail middleware — frontend shell scaffolded, design tokens wired from{" "}
            <code className="text-xs">docs/design.md</code>.
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

        <section className="rounded-lg border border-border bg-surface p-6">
          <h2 className="text-lg font-medium text-text-primary">Risk tier</h2>
          <div className="mt-3 flex gap-3">
            {riskTiers.map((tier) => (
              <span
                key={tier.label}
                className={`rounded-full px-3 py-1 text-xs font-medium text-white ${tier.className}`}
              >
                {tier.label}
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface p-6">
          <h2 className="text-lg font-medium text-text-primary">Decision</h2>
          <div className="mt-3 flex gap-3">
            {decisions.map((decision) => (
              <span
                key={decision.label}
                className={`rounded-full px-3 py-1 text-xs font-medium text-white ${decision.className}`}
              >
                {decision.label}
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface p-6">
          <h2 className="text-lg font-medium text-text-primary">Typography scale</h2>
          <div className="mt-3 space-y-1">
            {typeScale.map((row) => (
              <p key={row.token} className={`${row.className} text-text-primary`}>
                {row.token} — {row.note}
              </p>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
