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

export type IncidentDetail = Incident & {
  risk_classification: RiskClassification;
  agent_action: AgentAction;
};

export type IncidentDetailPage = {
  incidents: IncidentDetail[];
  totalCount: number;
};

// Shared by the review queue and the read-only incident log (app/incidents) —
// unpaginated, either view would render every matching incident's full
// reasoning text on one page (verified live: 500+ pending incidents produced
// a multi-megabyte page).
export const INCIDENT_LIST_PAGE_SIZE = 25;

function mapRowToIncidentDetail(row: {
  id: string;
  agent_id: string;
  action_type: ActionType;
  payload: Record<string, unknown>;
  source_channel: SourceChannel;
  created_at: string;
  incident: Incident | Incident[] | null;
  risk_classification: RiskClassification | RiskClassification[] | null;
}): IncidentDetail {
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
}

/**
 * Shared by getEscalatedIncidents (specs/05-review-queue-ui.md) and
 * getIncidentsByDecision (the read-only incident log, app/incidents) — same
 * join, same pagination-before-range-error handling, different decision
 * filter and (for escalate only) the reviewed-incident exclusion.
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
 * object — normalizeOne() handles either shape defensively so this works
 * before and after that constraint is added (database.sql's
 * ux_risk_classifications_action_id / ux_incidents_action_id).
 *
 * `page` is 1-indexed. `totalCount` reflects the full filtered set (via
 * PostgREST's exact count), not just the returned page, so callers can
 * render "N pending"/"N total" and compute total pages.
 *
 * `dateRange` (optional) filters on `agent_actions.created_at` — added so a
 * caller with a large oldest-first backlog (verified live: 693 unreviewed
 * incidents from a single day) can jump straight to a date instead of
 * paging through hundreds of older rows to reach it. `startTs`/`endTs` are
 * exclusive/inclusive ISO8601 bounds already resolved to day boundaries by
 * the caller (see app/review-queue/page.tsx) — this function just applies
 * them, it doesn't interpret date-only strings itself.
 */
async function fetchIncidentsByDecision(
  decision: Decision,
  options: { excludeReviewed: boolean; ascending: boolean },
  page: number,
  pageSize: number,
  dateRange?: { startTs?: string; endTs?: string },
): Promise<IncidentDetailPage> {
  const supabase = createServiceRoleClient();

  let notDecidedFilter: string | null = null;
  if (options.excludeReviewed) {
    const { data: decided, error: decidedError } = await supabase.from("review_decisions").select("incident_id");
    if (decidedError) throw decidedError;
    const decidedIncidentIds = (decided ?? []).map((row) => row.incident_id);
    notDecidedFilter = decidedIncidentIds.length > 0 ? `(${decidedIncidentIds.join(",")})` : null;
  }

  // Count first, head-only (no rows returned) — .range() below throws
  // "Requested range not satisfiable" if its start offset is past the last
  // matching row (verified live against a stale/out-of-range ?page= link),
  // so that has to be checked before attempting the ranged query, not
  // caught after the fact.
  let countQuery = supabase
    .from("agent_actions")
    .select("*, incident:incidents!inner(*)", { count: "exact", head: true })
    .eq("incident.decision", decision);
  if (notDecidedFilter) countQuery = countQuery.not("incident.id", "in", notDecidedFilter);
  if (dateRange?.startTs) countQuery = countQuery.gte("created_at", dateRange.startTs);
  if (dateRange?.endTs) countQuery = countQuery.lt("created_at", dateRange.endTs);
  const { count, error: countError } = await countQuery;
  if (countError) throw countError;
  const totalCount = count ?? 0;

  const from = (page - 1) * pageSize;
  if (totalCount === 0 || from >= totalCount) {
    return { incidents: [], totalCount };
  }

  let query = supabase
    .from("agent_actions")
    .select("*, incident:incidents!inner(*), risk_classification:risk_classifications(*)")
    .eq("incident.decision", decision)
    .order("created_at", { ascending: options.ascending });
  if (notDecidedFilter) query = query.not("incident.id", "in", notDecidedFilter);
  if (dateRange?.startTs) query = query.gte("created_at", dateRange.startTs);
  if (dateRange?.endTs) query = query.lt("created_at", dateRange.endTs);

  const { data, error } = await query.range(from, from + pageSize - 1);
  if (error) throw error;

  return { incidents: (data ?? []).map(mapRowToIncidentDetail), totalCount };
}

/**
 * Review queue read — specs/05-review-queue-ui.md. Incidents awaiting a
 * decision, oldest first, excluding ones that already have a review_decisions
 * row — otherwise a reviewed incident stays visible in the queue forever
 * (specs/05's Edge Cases).
 */
export async function getEscalatedIncidents(
  page = 1,
  pageSize: number = INCIDENT_LIST_PAGE_SIZE,
  dateRange?: { startTs?: string; endTs?: string },
): Promise<IncidentDetailPage> {
  return fetchIncidentsByDecision("escalate", { excludeReviewed: true, ascending: true }, page, pageSize, dateRange);
}

/**
 * Read-only incident log (app/incidents) — already-terminal decisions
 * (auto_approve, block) that were never routed to a human reviewer in the
 * first place, so there's no review_decisions concept to exclude here.
 * Newest first — this is a history log, not a work queue.
 */
export async function getIncidentsByDecision(
  decision: "auto_approve" | "block",
  page = 1,
  pageSize: number = INCIDENT_LIST_PAGE_SIZE,
): Promise<IncidentDetailPage> {
  return fetchIncidentsByDecision(decision, { excludeReviewed: false, ascending: false }, page, pageSize);
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
 * `startTs`/`endTs` (ISO8601) scope the count to a time window — both stat
 * tiles and the time-series chart must share the same window (specs/06's
 * Workflow step 4), so this and getIncidentVolumeByDay below take the same
 * two parameters. Aggregates via the get_incident_counts_by_decision RPC
 * (supabase/migrations/0003_incident_counts_by_decision.sql) rather than
 * fetching every matching row and counting client-side — that had no row
 * limit, and PostgREST's default max_rows (1000 on this project) silently
 * truncates an unbounded select instead of erroring, so the previous version
 * would have quietly undercounted past that many incidents.
 */
export async function getIncidentCountsByDecision(startTs: string, endTs: string): Promise<Record<Decision, number>> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("get_incident_counts_by_decision", {
    start_ts: startTs,
    end_ts: endTs,
  });
  if (error) throw error;

  const counts: Record<Decision, number> = { auto_approve: 0, escalate: 0, block: 0 };
  for (const row of data ?? []) {
    counts[row.decision as Decision] = row.count;
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

  // risk_classifications and incidents both only depend on agent_actions.id,
  // not on each other — run concurrently rather than as a third sequential
  // round-trip.
  const [riskResult, incidentResult] = await Promise.all([
    supabase.from("risk_classifications").insert({
      action_id: action.id,
      risk_tier: input.risk_tier,
      injection_flag: input.injection_flag,
      confidence: input.confidence,
      reasoning: input.reasoning,
      evidence_sources: input.evidence_sources,
      input_tokens: input.input_tokens,
      output_tokens: input.output_tokens,
      estimated_cost_usd: input.estimated_cost_usd,
    }),
    supabase
      .from("incidents")
      .insert({ action_id: action.id, decision: input.decision, latency_ms: input.latency_ms })
      .select("id")
      .single(),
  ]);
  if (riskResult.error) throw riskResult.error;
  if (incidentResult.error || !incidentResult.data) {
    throw incidentResult.error ?? new Error("incidents insert returned no row");
  }

  return { action_id: action.id, incident_id: incidentResult.data.id };
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
