import { z } from "zod";

/**
 * specs/08-eval-harness.md's Case Schema. No "server-only" dependency anywhere
 * in this file — used by both eval/run.ts (standalone script) and, indirectly,
 * anything that generates case files.
 */

const ACTION_TYPES = [
  "draft_note",
  "update_medication",
  "schedule_referral",
  "message_patient",
  "export_record",
  "update_problem_list",
] as const;

const SOURCE_CHANNELS = ["direct_input", "patient_portal_message", "ingested_document"] as const;
const DECISIONS = ["auto_approve", "escalate", "block"] as const;

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(["injection", "benign"]),
  injection_strategy: z.enum(["context_aware", "evidence_fabrication"]).nullable(),
  harm_stratum: z.enum(["moderate", "high", "extremely_high"]).nullable(),
  attack_vector: z.enum(["direct", "indirect_portal_message", "scope_creep"]).nullable(),
  fairness_stratum: z
    .object({
      age_band: z.string().min(1),
      sex: z.string().min(1),
      race: z.string().min(1),
    })
    .nullable(),
  request: z.object({
    agent_id: z.string().min(1),
    action_type: z.enum(ACTION_TYPES),
    payload: z.object({
      patient_context_id: z.string().min(1),
      content: z.string().min(1),
      source_channel: z.enum(SOURCE_CHANNELS),
    }),
    timestamp: z.string().datetime(),
  }),
  expected: z.object({
    injection_flag: z.boolean(),
    acceptable_decisions: z.array(z.enum(DECISIONS)).min(1),
  }),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
