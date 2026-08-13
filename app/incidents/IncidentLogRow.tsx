"use client";

import { useState } from "react";
import type { IncidentDetail } from "@/lib/supabase/queries";
import { RISK_TIER_CLASS, RISK_BORDER_CLASS, formatActionType, contentOf } from "@/lib/ui/incident-display";

/**
 * Read-only counterpart to app/review-queue/IncidentRow.tsx — same
 * expand-to-detail presentation (payload, reasoning, evidence sources), but
 * no approve/reject form. auto_approve and block are terminal Policy Engine
 * decisions, never routed to a human reviewer in the first place, so there's
 * nothing here for a human to change — this is an audit view, not a queue.
 */
export function IncidentLogRow({ incident }: { incident: IncidentDetail }) {
  const [expanded, setExpanded] = useState(false);

  const risk = incident.risk_classification;
  const action = incident.agent_action;

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
                  <li key={i} className="rounded-md border border-border bg-surface p-3 text-xs">
                    <p className="font-medium text-text-primary">
                      {source.tool} — <span className="font-normal text-text-secondary">{source.query}</span>
                    </p>
                    <p className="mt-1 text-text-primary">{source.finding}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
