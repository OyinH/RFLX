import { createServiceRoleClient } from "../lib/supabase-client";
import { generateBenignAction, type GeneratedAction, type MockPatient } from "./generate-action";
import type { ActionType } from "@/lib/supabase/types";
import { getErrorMessage } from "@/lib/errors";

/**
 * specs/00-mock-agent-simulator.md — CLI entry point.
 *
 *   npm run mock-agent -- --count 10 [--action-type <type>] [--patient-id <id>] [--base-url http://localhost:3000]
 */

const ACTION_TYPES: ActionType[] = [
  "draft_note",
  "update_medication",
  "schedule_referral",
  "message_patient",
  "export_record",
  "update_problem_list",
];

class ConnectionError extends Error {}

interface CliArgs {
  count: number;
  actionType?: ActionType;
  patientId?: string;
  baseUrl: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { count: 1, baseUrl: "http://localhost:3000" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--count":
        args.count = Number(argv[++i]);
        break;
      case "--action-type": {
        const value = argv[++i];
        if (!ACTION_TYPES.includes(value as ActionType)) {
          console.error(`--action-type must be one of: ${ACTION_TYPES.join(", ")}`);
          process.exit(1);
        }
        args.actionType = value as ActionType;
        break;
      }
      case "--patient-id":
        args.patientId = argv[++i];
        break;
      case "--base-url":
        args.baseUrl = argv[++i];
        break;
      default:
        console.error(`Unrecognized argument: ${flag}`);
        process.exit(1);
    }
  }
  return args;
}

type Supabase = ReturnType<typeof createServiceRoleClient>;

async function fetchPatient(supabase: Supabase, patientId: string): Promise<MockPatient> {
  const { data: patient, error } = await supabase
    .from("synthea_patients")
    .select("*")
    .eq("patient_context_id", patientId)
    .maybeSingle();
  if (error) throw error;
  if (!patient) throw new Error(`No patient found with patient_context_id=${patientId}`);

  const { data: meds, error: medsError } = await supabase
    .from("synthea_medications")
    .select("name")
    .eq("patient_context_id", patientId)
    .is("stop_date", null);
  if (medsError) throw medsError;

  return {
    patient_context_id: patient.patient_context_id,
    age_band: patient.age_band,
    sex: patient.sex,
    medications: (meds ?? []).map((m) => m.name),
  };
}

async function fetchRandomPatient(supabase: Supabase): Promise<MockPatient> {
  const { data: patients, error } = await supabase.from("synthea_patients").select("patient_context_id").limit(200);
  if (error) throw error;
  if (!patients || patients.length === 0) {
    throw new Error(
      "No rows in synthea_patients — load Synthea data first (skills/engineering-planner/SKILL.md's Test Data Setup).",
    );
  }
  const chosen = patients[Math.floor(Math.random() * patients.length)];
  return fetchPatient(supabase, chosen.patient_context_id);
}

async function postAction(baseUrl: string, action: GeneratedAction): Promise<Response> {
  try {
    return await fetch(`${baseUrl}/api/agent/action-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
  } catch (err) {
    throw new ConnectionError(
      `Could not reach Gateway API at ${baseUrl}/api/agent/action-request: ${getErrorMessage(err)}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(args.count) || args.count < 1) {
    console.error("--count must be a positive integer");
    process.exit(1);
  }

  const supabase = createServiceRoleClient();

  let fixedPatient: MockPatient | undefined;
  if (args.patientId) {
    try {
      fixedPatient = await fetchPatient(supabase, args.patientId);
    } catch (err) {
      console.error(`Failed to load --patient-id ${args.patientId}: ${getErrorMessage(err)}`);
      process.exit(1);
    }
  }

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < args.count; i++) {
    const actionType = args.actionType ?? ACTION_TYPES[Math.floor(Math.random() * ACTION_TYPES.length)];
    const label = `[${i + 1}/${args.count}]`;

    try {
      const patient = fixedPatient ?? (await fetchRandomPatient(supabase));
      const action = await generateBenignAction(actionType, patient);
      const response = await postAction(args.baseUrl, action);

      if (!response.ok) {
        const bodyText = await response.text();
        console.error(`${label} Gateway returned ${response.status}: ${bodyText}`);
        failed++;
        continue;
      }

      const result = (await response.json()) as { decision: string; risk_tier: string; latency_ms: number };
      console.log(
        `${label} ${actionType} (patient ${patient.patient_context_id}) -> decision=${result.decision} risk_tier=${result.risk_tier} latency_ms=${result.latency_ms}`,
      );
      succeeded++;
    } catch (err) {
      if (err instanceof ConnectionError) {
        // Fail fast on the first unreachable-server error rather than
        // retrying the connection failure across every remaining iteration
        // (specs/00's Edge Cases).
        console.error(`${label} ${err.message}`);
        console.error("Aborting run — Gateway API is unreachable.");
        process.exit(1);
      }
      console.error(`${label} Failed: ${getErrorMessage(err)}`);
      failed++;
    }
  }

  console.log(`\nDone: ${succeeded} succeeded, ${failed} failed.`);
  if (failed > 0 && succeeded === 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
