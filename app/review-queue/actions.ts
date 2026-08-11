"use server";

import { revalidatePath } from "next/cache";
import { submitReviewDecision } from "@/lib/supabase/queries";
import { getErrorMessage } from "@/lib/errors";
import type { ClassificationAgreement, ReasonCode, ReviewOutcome } from "@/lib/supabase/types";

/**
 * specs/05-review-queue-ui.md — the only write the review queue performs.
 * A Server Action so the service-role Supabase write stays server-only while
 * still being callable directly from the IncidentRow client component.
 */
export interface SubmitReviewResult {
  success: boolean;
  error?: string;
}

// A Server Action is a callable network endpoint, not a client-trusted form —
// its parameter types are compile-time only and don't constrain a direct
// invocation. Validate against the actual closed enums (specs/01-database-schema.md),
// not just presence, before this reaches submitReviewDecision (skills/security-foundation/SKILL.md
// item 2, applied to this write path the same as the Gateway API's request validation).
const REVIEW_OUTCOMES = new Set<ReviewOutcome>(["approved", "rejected"]);
const CLASSIFICATION_AGREEMENTS = new Set<ClassificationAgreement>([
  "agreed",
  "should_be_lower",
  "should_be_higher",
]);
const REASON_CODES = new Set<ReasonCode>([
  "correct_classification",
  "overly_cautious",
  "missed_clinical_context",
  "fabricated_evidence_not_flagged",
  "other",
]);

export async function submitReview(
  incidentId: string,
  reviewerId: string,
  outcome: ReviewOutcome,
  notes: string,
  classificationAgreement: ClassificationAgreement | null,
  reasonCode: ReasonCode | null,
): Promise<SubmitReviewResult> {
  const trimmedReviewerId = reviewerId.trim();
  if (!trimmedReviewerId) {
    return { success: false, error: "Reviewer name is required." };
  }
  if (!REVIEW_OUTCOMES.has(outcome)) {
    return { success: false, error: "Invalid outcome." };
  }
  // specs/05: required at the UI layer even though the schema column is
  // nullable — the client disables submit until both are set, but re-check
  // both presence and enum membership here rather than trust the client.
  if (!classificationAgreement || !reasonCode) {
    return { success: false, error: "Classification agreement and reason code are required." };
  }
  if (!CLASSIFICATION_AGREEMENTS.has(classificationAgreement) || !REASON_CODES.has(reasonCode)) {
    return { success: false, error: "Invalid classification agreement or reason code." };
  }

  try {
    await submitReviewDecision(
      incidentId,
      trimmedReviewerId,
      outcome,
      notes.trim() || undefined,
      classificationAgreement,
      reasonCode,
    );
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }

  // Refreshes the server-rendered queue so this incident (which now has a
  // review_decisions row) drops out of getEscalatedIncidents()'s result on
  // next load — specs/05's Workflow step 7.
  revalidatePath("/review-queue");
  return { success: true };
}
