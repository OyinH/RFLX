import "server-only";
import { createServiceRoleClient } from "./server";
import type {
  ActionType,
  AgentAction,
  ClassificationAgreement,
  Decision,
  EvidenceSource,
  Incident,
  ReasonCode,
  ReviewDecision,
  RiskClassification,
  RiskTier,
  SourceChannel,
  SyntheaMedication,
  SyntheaPatient,
} from "./types";

export type EscalatedIncident = Incident & {
  risk_classification: RiskClassification;
  agent_action: AgentAction;
};

/**
 * Review queue read — specs/05-review-queue-ui.md. Incidents awaiting a
 * decision, joined with exactly the evidence a reviewer needs (payload,
 * risk classification, reasoning). Scoped on purpose: this view never needs
 * a generic client with broader table access.
 *
 * Queries FROM agent_actions, not incidents — PostgREST embeds via foreign
 * keys, and `incidents`/`risk_classifications` have no FK to each other
 * (both reference agent_actions independently), so embedding one under the
 * other the way an earlier version of this function did fails with
 * "Could not find a relationship between 'incidents' and
 * 'risk_classifications'" (verified against a live query). Both are
 * genuinely 1:1 with agent_actions, but without a unique constraint on
 * their action_id columns PostgREST can't prove that and may return the
 * reverse-relationship embed as a single-element array rather than an
 * object — normalizeOne() below handles either shape defensively so this
 * works before and after that constraint is added (database.sql's
 * ux_risk_classifications_action_id / ux_incidents_action_id).
 *
 * Excludes incidents that already have a review_decisions row — otherwise a
 * reviewed incident stays visible in the queue forever (specs/05's Edge Cases).
 */
export async function getEscalatedIncidents(): Promise<EscalatedIncident[]> {
  const supabase = createServiceRoleClient();

  const { data: decided, error: decidedError } = await supabase
    .from("review_decisions")
    .select("incident_id");
  if (decidedError) throw decidedError;
  const decidedIncidentIds = (decided ?? []).map((row) => row.incident_id);

  let query = supabase
    .from("agent_actions")
    .select("*, incident:incidents!inner(*), risk_classification:risk_classifications(*)")
    .eq("incident.decision", "escalate")
    .order("created_at", { ascending: true });

  if (decidedIncidentIds.length > 0) {
    query = query.not("incident.id", "in", `(${decidedIncidentIds.join(",")})`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const agentAction: AgentAction = {
      id: row.id,
      agent_id: row.agent_id,
      action_type: row.action_type,
      payload: row.payload,
      source_channel: row.source_channel,
      created_at: row.created_at,
    };
    const incident = normalizeOne<Incident>(row.incident);
    const riskClassification = normalizeOne<RiskClassification>(row.risk_classification);
    if (!incident || !riskClassification) {
      throw new Error(`agent_action ${row.id} is missing its incident or risk_classification row — data integrity issue.`);
    }
    return { ...incident, risk_classification: riskClassification, agent_action: agentAction };
  });
}

/** PostgREST returns a to-one embed as an object when it can prove the
 * relationship is unique, otherwise as a single-element array — normalize both. */
function normalizeOne<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/**
 * Review queue write — specs/05-review-queue-ui.md. The only write that view
 * performs; never updates an existing incidents or risk_classifications row.
 *
 * classificationAgreement/reasonCode are the reviewer-outcome calibration log
 * (docs/rflx_PRD.md §6.1) — required by the UI (specs/05), not by the
 * review_decisions schema (nullable, specs/01), so this function still takes
 * them as required params to keep that UI-layer guarantee at the call site.
 * Capture-only: nothing reads these two fields back yet (§6.3 defers that).
 */
export async function submitReviewDecision(
  incidentId: string,
  reviewerId: string,
  outcome: NonNullable<ReviewDecision["outcome"]>,
  notes: string | undefined,
  classificationAgreement: ClassificationAgreement,
  reasonCode: ReasonCode,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("review_decisions").insert({
    incident_id: incidentId,
    reviewer_id: reviewerId,
    outcome,
    notes: notes ?? null,
    classification_agreement: classificationAgreement,
    reason_code: reasonCode,
  });

  if (error) throw error;
}

/**
 * Dashboard read — specs/06-dashboard-ui.md. Read-only aggregate, no writes.
 * `startTs`/`endTs` (ISO8601, both optional) scope the count to a time window —
 * both stat tiles and the time-series chart must share the same window
 * (specs/06's Workflow step 4), so this and getIncidentVolumeByDay below take
 * the same two parameters.
 */
export async function getIncidentCountsByDecision(
  startTs?: string,
  endTs?: string,
): Promise<Record<Decision, number>> {
  const supabase = createServiceRoleClient();
  let query = supabase.from("incidents").select("decision");
  if (startTs) query = query.gte("created_at", startTs);
  if (endTs) query = query.lt("created_at", endTs);

  const { data, error } = await query;
  if (error) throw error;

  const counts: Record<Decision, number> = { auto_approve: 0, escalate: 0, block: 0 };
  for (const row of data ?? []) {
    counts[row.decision as Decision] += 1;
  }
  return counts;
}

export type IncidentVolumeRow = { day: string; decision: Decision; count: number };

/**
 * Dashboard time-series read — specs/06-dashboard-ui.md. Buckets and aggregates
 * in SQL via the get_incident_volume_by_day() function (supabase/migrations/0001_init.sql)
 * rather than fetching every row and bucketing client-side, per that spec's
 * explicit large-volume edge case.
 */
export async function getIncidentVolumeByDay(startTs: string, endTs: string): Promise<IncidentVolumeRow[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("get_incident_volume_by_day", {
    start_ts: startTs,
    end_ts: endTs,
  });

  if (error) throw error;
  return (data ?? []) as IncidentVolumeRow[];
}

/**
 * Gateway write — specs/03-gateway-api.md step 5. Writes agent_actions,
 * risk_classifications, and incidents as three sequential inserts. Throws on
 * any failure (including a partial write) — the caller (the Gateway API route)
 * treats any throw here as a `persistence_failed` 500, per specs/03's Edge
 * Cases: a decision that isn't durably logged must never be reported as if it were.
 */
export type RecordDecisionInput = {
  agent_id: string;
  action_type: ActionType;
  payload: Record<string, unknown>;
  source_channel: SourceChannel;
  risk_tier: RiskTier;
  injection_flag: boolean;
  confidence: number;
  reasoning: string;
  evidence_sources: EvidenceSource[];
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  decision: Decision;
  latency_ms: number;
};

export type RecordDecisionResult = { action_id: string; incident_id: string };

export async function recordDecision(input: RecordDecisionInput): Promise<RecordDecisionResult> {
  const supabase = createServiceRoleClient();

  const { data: action, error: actionError } = await supabase
    .from("agent_actions")
    .insert({
      agent_id: input.agent_id,
      action_type: input.action_type,
      payload: input.payload,
      source_channel: input.source_channel,
    })
    .select("id")
    .single();
  if (actionError || !action) throw actionError ?? new Error("agent_actions insert returned no row");

  const { error: riskError } = await supabase.from("risk_classifications").insert({
    action_id: action.id,
    risk_tier: input.risk_tier,
    injection_flag: input.injection_flag,
    confidence: input.confidence,
    reasoning: input.reasoning,
    evidence_sources: input.evidence_sources,
    input_tokens: input.input_tokens,
    output_tokens: input.output_tokens,
    estimated_cost_usd: input.estimated_cost_usd,
  });
  if (riskError) throw riskError;

  const { data: incident, error: incidentError } = await supabase
    .from("incidents")
    .insert({ action_id: action.id, decision: input.decision, latency_ms: input.latency_ms })
    .select("id")
    .single();
  if (incidentError || !incident) throw incidentError ?? new Error("incidents insert returned no row");

  return { action_id: action.id, incident_id: incident.id };
}

/**
 * Gateway read — specs/03-gateway-api.md step 1 validation ("patient_context_id
 * ... must exist in synthea_patients"). Scoped to exactly the check needed.
 */
export async function getPatientById(patientContextId: string): Promise<SyntheaPatient | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("synthea_patients")
    .select("*")
    .eq("patient_context_id", patientContextId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Investigator read — specs/04-investigator.md's get_patient_current_medications
 * tool. Filters to active medications (stop_date is null) at the query level.
 * Returns [] for a patient with none — a valid result, not an error.
 */
export async function getActiveMedicationsForPatient(patientContextId: string): Promise<SyntheaMedication[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("synthea_medications")
    .select("*")
    .eq("patient_context_id", patientContextId)
    .is("stop_date", null);

  if (error) throw error;
  return data ?? [];
}
