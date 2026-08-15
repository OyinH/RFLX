import Link from "next/link";
import { getIncidentCountsByDecision } from "@/lib/supabase/queries";
import { getErrorMessage } from "@/lib/errors";
import type { Decision } from "@/lib/supabase/types";

// getIncidentCountsByDecision is a live Supabase call — without this, Next.js
// can't detect that and statically prerenders the page once at build time,
// serving a frozen stats snapshot on every request (same class of bug
// documented in app/review-queue/page.tsx and app/dashboard/page.tsx).
export const dynamic = "force-dynamic";

const FEATURES = [
  {
    title: "Injection Detection",
    description:
      "Every proposed action is screened for manipulation before it's evaluated for clinical risk — hidden instructions, adversarial phrasing, and cross-domain prompt injection.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 2.5l7.5 3v6c0 5-3.2 8.6-7.5 10-4.3-1.4-7.5-5-7.5-10v-6l7.5-3z"
      />
    ),
  },
  {
    title: "Clinical Risk Classification",
    description:
      "A bounded, read-only investigator reasons about each action's actual clinical context — patient medications, drug interactions — not just keyword matching.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3 12h4l2-7 4 14 2-7h6"
      />
    ),
  },
  {
    title: "Full Audit Trail",
    description:
      "Every decision — auto-approved, escalated, or blocked — is durably logged with its full reasoning and evidence, never silently dropped.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 3.5h6a1 1 0 011 1V5h1a1 1 0 011 1v14a1 1 0 01-1 1H7a1 1 0 01-1-1V6a1 1 0 011-1h1v-.5a1 1 0 011-1z M9 11h6M9 15h6"
      />
    ),
  },
];

const STAT_LABELS: Record<Decision, string> = {
  auto_approve: "Auto-approved",
  escalate: "Escalated",
  block: "Blocked",
};

// escalate goes to the review queue (the work-in-progress view); the two
// terminal decisions go to the read-only incident log, deep-linked to the
// matching tab.
const STAT_HREF: Record<Decision, string> = {
  auto_approve: "/incidents?decision=auto_approve",
  escalate: "/review-queue",
  block: "/incidents?decision=block",
};

async function getLiveStats(): Promise<Record<Decision, number> | null> {
  try {
    return await getIncidentCountsByDecision(new Date(0).toISOString(), new Date().toISOString());
  } catch (err) {
    console.error("Landing page stats fetch failed:", getErrorMessage(err));
    return null;
  }
}

export default async function Home() {
  const stats = await getLiveStats();
  const total = stats ? stats.auto_approve + stats.escalate + stats.block : 0;

  return (
    <main id="main-content" className="relative overflow-hidden bg-bg px-6 py-16">
      {/* Soft brand-tinted glow behind the hero — landing page only. The
          working-tool views (review-queue/dashboard/incidents) stay flat and
          neutral on purpose (docs/design.md: scan-ability over whitespace
          for those), but a plain white/light-gray page reads as a generic
          template for the one page that's actually meant to make a first
          impression. Verified the tint doesn't affect text contrast: even at
          its strongest point the effective background stays at 13.64:1
          against text-primary, still far past WCAG AA's 4.5:1. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,rgba(49,46,129,0.12),transparent)]"
      />
      <div className="relative z-10 mx-auto max-w-5xl">
        <section className="text-center">
          <h1 className="text-2xl font-semibold text-text-primary sm:text-3xl">
            Clinical AI agent guardrail middleware
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base text-text-secondary">
            Screens a proposed agent action for manipulation, classifies clinical risk, and returns one governed
            decision — with a full audit trail.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/review-queue"
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
            >
              Open Review Queue
            </Link>
            <Link
              href="/dashboard"
              className="rounded-md border border-border bg-surface px-5 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-bg"
            >
              Open Dashboard
            </Link>
          </div>
        </section>

        {stats && total > 0 ? (
          <section aria-label="Live incident totals" className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(["auto_approve", "escalate", "block"] as const).map((decision) => (
              <Link
                key={decision}
                href={STAT_HREF[decision]}
                className="group rounded-lg border border-border bg-surface p-6 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
              >
                <p className="text-2xl font-semibold text-text-primary">{stats[decision].toLocaleString()}</p>
                <p className="mt-1 text-sm text-text-secondary">{STAT_LABELS[decision]}</p>
                <p className="mt-3 text-xs font-medium text-primary">
                  View details <span className="transition-transform group-hover:translate-x-0.5">→</span>
                </p>
              </Link>
            ))}
          </section>
        ) : null}

        <section className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-lg border border-border bg-surface p-6">
              <svg
                className="h-6 w-6 text-primary"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                aria-hidden="true"
              >
                {feature.icon}
              </svg>
              <h2 className="mt-3 text-lg font-medium text-text-primary">{feature.title}</h2>
              <p className="mt-1 text-sm text-text-secondary">{feature.description}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
