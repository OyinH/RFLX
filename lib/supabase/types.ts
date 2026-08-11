/**
 * Hand-written against specs/01-database-schema.md's literal SQL — there's no
 * live Supabase project yet to generate these from. Keep in sync with that
 * file; it's the source of truth for column-level detail.
 */

// action_type is a closed enum (CLAUDE.md Naming Conventions / specs/02-policy-engine.md) —
// don't add a value here without updating the risk taxonomy and policy table in the same change.
export type ActionType =
  | "draft_note"
  | "update_medication"
  | "schedule_referral"
  | "message_patient"
  | "export_record"
  | "update_problem_list";

export type SourceChannel = "direct_input" | "patient_portal_message" | "ingested_document";

export type RiskTier = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type Decision = "auto_approve" | "escalate" | "block";

export type ReviewOutcome = "approved" | "rejected";

// Reviewer-outcome calibration log (docs/rflx_PRD.md §6.1, added post-MVP) —
// capture-only, nothing reads these back yet (§6.3 defers the analysis loop).
export type ClassificationAgreement = "agreed" | "should_be_lower" | "should_be_higher";
export type ReasonCode =
  | "correct_classification"
  | "overly_cautious"
  | "missed_clinical_context"
  | "fabricated_evidence_not_flagged"
  | "other";

// Fairness stratification dimension (docs/engineering/architecture.md's Evaluation
// Framework section) — derived at load time from synthea_patients.birth_date, not a
// raw Synthea field.
export type AgeBand = "0-17" | "18-34" | "35-49" | "50-64" | "65+";

// Deliberately `type`, not `interface`: named interfaces don't structurally
// satisfy `Record<string, unknown>` when nested inside the Database generic
// below (a TS quirk around implicit index signatures — interfaces are
// "open"/mergeable and don't get one, type-literal aliases do), which makes
// @supabase/supabase-js's typed client silently collapse every table to `never`.
export type AgentAction = {
  id: string;
  agent_id: string;
  action_type: ActionType;
  payload: Record<string, unknown>;
  source_channel: SourceChannel;
  created_at: string;
};

export type EvidenceSource = {
  tool: "lookup_drug_label" | "get_patient_current_medications";
  query: string;
  finding: string;
};

export type RiskClassification = {
  id: string;
  action_id: string;
  risk_tier: RiskTier;
  injection_flag: boolean;
  confidence: number | null;
  reasoning: string | null;
  evidence_sources: EvidenceSource[];
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  created_at: string;
};

export type Incident = {
  id: string;
  action_id: string;
  decision: Decision;
  latency_ms: number | null;
  created_at: string;
};

export type ReviewDecision = {
  id: string;
  incident_id: string;
  reviewer_id: string | null;
  outcome: ReviewOutcome | null;
  notes: string | null;
  classification_agreement: ClassificationAgreement | null;
  reason_code: ReasonCode | null;
  decided_at: string;
};

// Reference data tables (specs/01-database-schema.md) — Synthea-loaded, read-only
// from the application's perspective. Never written to by the Gateway API,
// investigator, review queue, or dashboard; only by the one-time load script.
export type SyntheaPatient = {
  patient_context_id: string;
  birth_date: string;
  age_band: AgeBand;
  sex: string;
  race: string | null;
  ethnicity: string | null;
  created_at: string;
};

export type SyntheaMedication = {
  id: string;
  patient_context_id: string;
  name: string;
  dose: string | null;
  start_date: string | null;
  stop_date: string | null;
};

type GeneratedColumns = "id" | "created_at";
type GeneratedReviewColumns = "id" | "decided_at";
type GeneratedPatientColumns = "created_at";
type GeneratedMedicationColumns = "id";

export type Database = {
  public: {
    Tables: {
      agent_actions: {
        Row: AgentAction;
        Insert: Omit<AgentAction, GeneratedColumns> & Partial<Pick<AgentAction, GeneratedColumns>>;
        Update: Partial<AgentAction>;
        Relationships: [];
      };
      risk_classifications: {
        Row: RiskClassification;
        Insert: Omit<RiskClassification, GeneratedColumns> &
          Partial<Pick<RiskClassification, GeneratedColumns>>;
        Update: Partial<RiskClassification>;
        Relationships: [
          {
            foreignKeyName: "risk_classifications_action_id_fkey";
            columns: ["action_id"];
            isOneToOne: true;
            referencedRelation: "agent_actions";
            referencedColumns: ["id"];
          },
        ];
      };
      incidents: {
        Row: Incident;
        Insert: Omit<Incident, GeneratedColumns> & Partial<Pick<Incident, GeneratedColumns>>;
        Update: Partial<Incident>;
        Relationships: [
          {
            foreignKeyName: "incidents_action_id_fkey";
            columns: ["action_id"];
            isOneToOne: true;
            referencedRelation: "agent_actions";
            referencedColumns: ["id"];
          },
        ];
      };
      review_decisions: {
        Row: ReviewDecision;
        Insert: Omit<ReviewDecision, GeneratedReviewColumns> &
          Partial<Pick<ReviewDecision, GeneratedReviewColumns>>;
        Update: Partial<ReviewDecision>;
        Relationships: [
          {
            foreignKeyName: "review_decisions_incident_id_fkey";
            columns: ["incident_id"];
            // Deliberately not one-to-one — incident_id has no unique constraint
            // (specs/01's Edge Cases: two near-simultaneous reviewer submissions
            // both succeed as separate rows rather than one erroring).
            isOneToOne: false;
            referencedRelation: "incidents";
            referencedColumns: ["id"];
          },
        ];
      };
      synthea_patients: {
        Row: SyntheaPatient;
        Insert: Omit<SyntheaPatient, GeneratedPatientColumns> &
          Partial<Pick<SyntheaPatient, GeneratedPatientColumns>>;
        Update: Partial<SyntheaPatient>;
        Relationships: [];
      };
      synthea_medications: {
        Row: SyntheaMedication;
        Insert: Omit<SyntheaMedication, GeneratedMedicationColumns> &
          Partial<Pick<SyntheaMedication, GeneratedMedicationColumns>>;
        Update: Partial<SyntheaMedication>;
        Relationships: [
          {
            foreignKeyName: "synthea_medications_patient_context_id_fkey";
            columns: ["patient_context_id"];
            isOneToOne: false;
            referencedRelation: "synthea_patients";
            referencedColumns: ["patient_context_id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      // supabase/migrations/0001_init.sql — used by getIncidentVolumeByDay (specs/06).
      get_incident_volume_by_day: {
        Args: { start_ts: string; end_ts: string };
        Returns: { day: string; decision: string; count: number }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
