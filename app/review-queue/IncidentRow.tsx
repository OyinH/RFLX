"use client";

import { useState, useTransition } from "react";
import type { IncidentDetail } from "@/lib/supabase/queries";
import type { ClassificationAgreement, ReasonCode } from "@/lib/supabase/types";
import { RISK_TIER_CLASS, RISK_BORDER_CLASS, formatActionType, contentOf } from "@/lib/ui/incident-display";
import { submitReview } from "./actions";

// Reviewer-outcome calibration log (docs/rflx_PRD.md §6.1) — capture-only,
// required at the UI layer though the schema column is nullable (specs/01).
const AGREEMENT_OPTIONS: { value: ClassificationAgreement; label: string }[] = [
  { value: "agreed", label: "Agreed" },
  { value: "should_be_lower", label: "Should be lower" },
  { value: "should_be_higher", label: "Should be higher" },
];

const REASON_OPTIONS: { value: ReasonCode; label: string }[] = [
  { value: "correct_classification", label: "Correct classification" },
  { value: "overly_cautious", label: "Overly cautious" },
  { value: "missed_clinical_context", label: "Missed clinical context" },
  { value: "fabricated_evidence_not_flagged", label: "Fabricated evidence not flagged" },
  { value: "other", label: "Other" },
];

export function IncidentRow({ incident }: { incident: IncidentDetail }) {
  const [expanded, setExpanded] = useState(false);
  const [reviewerId, setReviewerId] = useState("");
  const [notes, setNotes] = useState("");
  const [classificationAgreement, setClassificationAgreement] = useState<ClassificationAgreement | "">("");
  const [reasonCode, setReasonCode] = useState<ReasonCode | "">("");
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState(false);
  const [isPending, startTransition] = useTransition();

  const risk = incident.risk_classification;
  const action = incident.agent_action;
  const canSubmit = reviewerId.trim() !== "" && classificationAgreement !== "" && reasonCode !== "";

  function handleDecision(outcome: "approved" | "rejected") {
    if (!classificationAgreement || !reasonCode) return;
    setError(null);
    startTransition(async () => {
      const result = await submitReview(incident.id, reviewerId, outcome, notes, classificationAgreement, reasonCode);
      if (!result.success) {
        setError(result.error ?? "Failed to submit review decision.");
        return;
      }
      // revalidatePath re-fetches the queue server-side; hide this row
      // locally too so the reviewer gets immediate feedback without waiting
      // on the round trip (specs/05: never remove it before the write is confirmed).
      setDecided(true);
    });
  }

  if (decided) {
    return (
      <div className="px-4 py-3">
        <p className="text-sm text-text-secondary">Decision recorded — this incident will leave the queue on refresh.</p>
      </div>
    );
  }

  return (
    <div className={`border-l-4 ${RISK_BORDER_CLASS[risk.risk_tier]}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="grid w-full grid-cols-[92px_150px_28px_1fr_180px] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg"
      >
        <span
          className={`inline-flex justify-center rounded-full px-3 py-1 text-xs font-medium text-white ${RISK_TIER_CLASS[risk.risk_tier]}`}
        >
          {risk.risk_tier}
        </span>
        <span className="truncate text-sm font-medium text-text-primary">{formatActionType(action.action_type)}</span>
        {risk.injection_flag ? (
          <span
            title="Injection detected"
            aria-label="Injection detected"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-risk-critical text-white"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M12 9v4m0 4h.01M10.29 3.86l-8.18 14.18A1 1 0 003 19.5h18a1 1 0 00.89-1.46L13.71 3.86a1 1 0 00-1.72 0z"
              />
            </svg>
          </span>
        ) : (
          <span aria-hidden="true" />
        )}
        <span className="min-w-0 truncate text-sm text-text-secondary">{contentOf(action.payload)}</span>
        <span className="shrink-0 whitespace-nowrap text-right text-xs text-text-secondary">
          {new Date(incident.created_at).toLocaleString()}
        </span>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border bg-bg px-4 py-4">
          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Full payload</h3>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-bg p-3 text-xs text-text-primary">
              {JSON.stringify(action.payload, null, 2)}
            </pre>
          </section>

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Investigator reasoning (confidence {(risk.confidence ?? 0).toFixed(2)})
            </h3>
            <p className="mt-1 text-sm text-text-primary">{risk.reasoning}</p>
          </section>

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">Evidence sources</h3>
            {risk.evidence_sources.length === 0 ? (
              <p className="mt-1 text-sm text-text-secondary">No tool calls were made for this investigation.</p>
            ) : (
              <ul className="mt-1 space-y-2">
                {risk.evidence_sources.map((source, i) => (
                  <li key={i} className="rounded-md border border-border bg-bg p-3 text-xs">
                    <p className="font-medium text-text-primary">
                      {source.tool} — <span className="font-normal text-text-secondary">{source.query}</span>
                    </p>
                    <p className="mt-1 text-text-primary">{source.finding}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3 rounded-md border border-border bg-bg p-4">
            <label className="block text-xs font-medium text-text-secondary">
              Reviewer name
              <input
                type="text"
                value={reviewerId}
                onChange={(e) => setReviewerId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
                placeholder="Your name"
              />
            </label>
            <label className="block text-xs font-medium text-text-secondary">
              Notes (optional)
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
              />
            </label>

            <div className="block text-xs font-medium text-text-secondary">
              Risk tier assessment
              <div className="mt-1 flex flex-wrap gap-2">
                {AGREEMENT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setClassificationAgreement(opt.value)}
                    aria-pressed={classificationAgreement === opt.value}
                    className={`rounded-md border border-border px-3 py-1.5 text-sm transition-colors ${
                      classificationAgreement === opt.value
                        ? "bg-primary text-white"
                        : "bg-surface text-text-primary"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block text-xs font-medium text-text-secondary">
              Reason
              <select
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value as ReasonCode)}
                className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
              >
                <option value="" disabled>
                  Select a reason…
                </option>
                {REASON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            {error && <p className="text-xs text-risk-critical">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={isPending || !canSubmit}
                onClick={() => handleDecision("approved")}
                className="rounded-md bg-decision-approve px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? "Submitting…" : "Approve"}
              </button>
              <button
                type="button"
                disabled={isPending || !canSubmit}
                onClick={() => handleDecision("rejected")}
                className="rounded-md bg-decision-block px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? "Submitting…" : "Reject"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
