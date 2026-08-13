import type { RiskTier } from "@/lib/supabase/types";

/**
 * Shared between the review queue (app/review-queue) and the read-only
 * incident log (app/incidents) — same badge/row presentation for the same
 * underlying IncidentDetail shape, just a different set of decisions and no
 * review-submission form on the read-only side.
 */
export const RISK_TIER_CLASS: Record<RiskTier, string> = {
  LOW: "bg-risk-low",
  MEDIUM: "bg-risk-medium",
  HIGH: "bg-risk-high",
  CRITICAL: "bg-risk-critical",
};

// Left accent stripe on each row — scannable at a glance before even
// reading the badge text, same pattern as most incident-queue tools
// (Sentry, PagerDuty). docs/design.md's review-queue principle: "prioritize
// scan-ability... over whitespace."
export const RISK_BORDER_CLASS: Record<RiskTier, string> = {
  LOW: "border-risk-low",
  MEDIUM: "border-risk-medium",
  HIGH: "border-risk-high",
  CRITICAL: "border-risk-critical",
};

export function formatActionType(actionType: string): string {
  return actionType
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function contentOf(payload: Record<string, unknown>): string {
  return typeof payload.content === "string" ? payload.content : JSON.stringify(payload);
}
