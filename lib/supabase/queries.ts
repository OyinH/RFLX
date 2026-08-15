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

/** Maps a list_incidents_by_decision() RPC row (supabase/migrations/0005) to IncidentDetail. */
function mapRpcRowToIncidentDetail(row: {
  agent_action: Record<string, unknown>;
  incident: Record<string, unknown>;
  risk_classification: Record<string, unknown>;
}): IncidentDetail {
  const agentAction = row.agent_action as unknown as AgentAction;
  const incident = row.incident as unknown as Incident;
  const riskClassification = row.risk_classification as unknown as RiskClassification;
  return { ...incident, risk_classification: riskClassification, agent_action: agentAction };
}

/**
 * Shared by getEscalatedIncidents (specs/05-review-queue-ui.md) and
 * getIncidentsByDecision (the read-only incident log, app/incidents) — same
 * count-then-fetch shape, different decision filter and (for escalate only)
 * the reviewed-incident exclusion.
 *
 * The count query below still queries FROM agent_actions via PostgREST
 * embedding (`incident:incidents!inner(*)`, `risk_classification:
 * risk_classifications!inner(*)`) — `incidents`/`risk_classifications` have
 * no FK to each other (both reference agent_actions independently), so
 * embedding one under the other fails with "Could not find a relationship
 * between 'incidents' and 'risk_classifications'" (verified against a live
 * query); querying from agent_actions and embedding both avoids that. The
 * actual page fetch goes through the list_incidents_by_decision() RPC
 * instead (see that function's doc comment above) — PostgREST embedding
 * only remains for counting, where filtering (not ordering) on the embedded
 * resource is all that's needed, and that works fine.
 *
 * `page` is 1-indexed. `totalCount` reflects the full filtered set (via
 * PostgREST's exact count), not just the returned page, so callers can
 * render "N pending"/"N total" and compute total pages.
 *
 * `filters.dateRange` filters on `agent_actions.created_at` — added so a
 * caller with a large oldest-first backlog (verified live: 693 unreviewed
 * incidents from a single day) can jump straight to a date instead of
 * paging through hundreds of older rows to reach it. `startTs`/`endTs` are
 * exclusive/inclusive ISO8601 bounds already resolved to day boundaries by
 * the caller (see app/review-queue/page.tsx) — this function just applies
 * them, it doesn't interpret date-only strings itself. `filters.riskTier`/
 * `filters.injectionFlag` narrow to one risk tier / injection-flag state.
 *
 * `sort` picks the actual page-fetch ordering. The count query below stays
 * plain PostgREST (filtering on the embedded risk_classifications resource
 * works fine there), but the page fetch goes through the
 * list_incidents_by_decision() RPC (supabase/migrations/0005) instead of
 * PostgREST's own `.order()` — verified live that ordering agent_actions by
 * an embedded risk_classifications column fails with PGRST118 ("do not form
 * a many-to-one or one-to-one relationship"), even with `!inner` and even
 * though action_id is UNIQUE. `risk_tier` sort orders on risk_rank (the
 * generated column from supabase/migrations/0004), not risk_tier itself —
 * that's plain text ('LOW'/'MEDIUM'/'HIGH'/'CRITICAL'), so a naive order
 * would sort alphabetically instead of by clinical severity.
 */
export type IncidentSort = { field: "created_at" | "risk_tier"; ascending: boolean };
export type IncidentFilters = {
  dateRange?: { startTs?: string; endTs?: string };
  riskTier?: RiskTier;
  injectionFlag?: boolean;
};

async function fetchIncidentsByDecision(
  decision: Decision,
  options: { excludeReviewed: boolean },
  page: number,
  pageSize: number,
  sort: IncidentSort,
  filters?: IncidentFilters,
): Promise<IncidentDetailPage> {
  const supabase = createServiceRoleClient();

  let notDecidedFilter: string | null = null;
  if (options.excludeReviewed) {
    const { data: decided, error: decidedError } = await supabase.from("review_decisions").select("incident_id");
    if (decidedError) throw decidedError;
    const decidedIncidentIds = (decided ?? []).map((row) => row.incident_id);
    notDecidedFilter = decidedIncidentIds.length > 0 ? `(${decidedIncidentIds.join(",")})` : null;
  }

  // Count first, head-only (no rows returned) — needed both to detect a
  // stale/out-of-range ?page= link before attempting the ranged RPC fetch
  // below, and because the RPC's own `count(*) over()` would only be
  // reachable from a returned row, which an out-of-range page has none of.
  let countQuery = supabase
    .from("agent_actions")
    .select("*, incident:incidents!inner(*), risk_classification:risk_classifications!inner(*)", {
      count: "exact",
      head: true,
    })
    .eq("incident.decision", decision);
  if (notDecidedFilter) countQuery = countQuery.not("incident.id", "in", notDecidedFilter);
  if (filters?.dateRange?.startTs) countQuery = countQuery.gte("created_at", filters.dateRange.startTs);
  if (filters?.dateRange?.endTs) countQuery = countQuery.lt("created_at", filters.dateRange.endTs);
  if (filters?.riskTier) countQuery = countQuery.eq("risk_classification.risk_tier", filters.riskTier);
  if (filters?.injectionFlag !== undefined) {
    countQuery = countQuery.eq("risk_classification.injection_flag", filters.injectionFlag);
  }
  const { count, error: countError } = await countQuery;
  if (countError) throw countError;
  const totalCount = count ?? 0;

  const from = (page - 1) * pageSize;
  if (totalCount === 0 || from >= totalCount) {
    return { incidents: [], totalCount };
  }

  const { data, error } = await supabase.rpc("list_incidents_by_decision", {
    p_decision: decision,
    p_exclude_reviewed: options.excludeReviewed,
    p_start_ts: filters?.dateRange?.startTs ?? null,
    p_end_ts: filters?.dateRange?.endTs ?? null,
    p_risk_tier: filters?.riskTier ?? null,
    p_injection_flag: filters?.injectionFlag ?? null,
    p_sort_field: sort.field,
    p_sort_ascending: sort.ascending,
    p_limit: pageSize,
    p_offset: from,
  });
  if (error) throw error;

  return { incidents: (data ?? []).map(mapRpcRowToIncidentDetail), totalCount };
}

/**
 * Review queue read — specs/05-review-queue-ui.md. Incidents awaiting a
 * decision, excluding ones that already have a review_decisions row —
 * otherwise a reviewed incident stays visible in the queue forever
 * (specs/05's Edge Cases). Defaults to oldest-first ("process the
 * longest-waiting escalations first") when the caller doesn't specify a sort.
 */
export async function getEscalatedIncidents(
  page = 1,
  pageSize: number = INCIDENT_LIST_PAGE_SIZE,
  filters?: IncidentFilters,
  sort: IncidentSort = { field: "created_at", ascending: true },
): Promise<IncidentDetailPage> {
  return fetchIncidentsByDecision("escalate", { excludeReviewed: true }, page, pageSize, sort, filters);
}

/**
 * Read-only incident log (app/incidents) — already-terminal decisions
 * (auto_approve, block) that were never routed to a human reviewer in the
 * first place, so there's no review_decisions concept to exclude here.
 * Defaults to newest-first (a history view) when the caller doesn't specify
 * a sort.
 */
export async function getIncidentsByDecision(
  decision: "auto_approve" | "block",
  page = 1,
  pageSize: number = INCIDENT_LIST_PAGE_SIZE,
  filters?: IncidentFilters,
  sort: IncidentSort = { field: "created_at", ascending: false },
): Promise<IncidentDetailPage> {
  return fetchIncidentsByDecision(decision, { excludeReviewed: false }, page, pageSize, sort, filters);
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
