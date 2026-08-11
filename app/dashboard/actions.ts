"use server";

import { getIncidentCountsByDecision, getIncidentVolumeByDay, type IncidentVolumeRow } from "@/lib/supabase/queries";
import { getErrorMessage } from "@/lib/errors";
import type { Decision } from "@/lib/supabase/types";

export type TimeRange = "24h" | "7d" | "30d" | "all";

export interface DashboardData {
  counts: Record<Decision, number>;
  volume: IncidentVolumeRow[];
  error?: string;
}

const EPOCH = new Date(0).toISOString();

function rangeToWindow(timeRange: TimeRange): { startTs: string; endTs: string } {
  const now = new Date();
  const endTs = now.toISOString();
  if (timeRange === "all") return { startTs: EPOCH, endTs };

  const hours = timeRange === "24h" ? 24 : timeRange === "7d" ? 24 * 7 : 24 * 30;
  const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
  return { startTs: start.toISOString(), endTs };
}

/**
 * specs/06-dashboard-ui.md's Workflow step 4: stat tiles and the time-series
 * chart must share the same time window — this is the single fetch both the
 * initial server render and every filter change go through.
 */
export async function getDashboardData(timeRange: TimeRange): Promise<DashboardData> {
  const { startTs, endTs } = rangeToWindow(timeRange);

  try {
    const [counts, volume] = await Promise.all([
      getIncidentCountsByDecision(startTs, endTs),
      getIncidentVolumeByDay(startTs, endTs),
    ]);
    return { counts, volume };
  } catch (err) {
    return {
      counts: { auto_approve: 0, escalate: 0, block: 0 },
      volume: [],
      error: getErrorMessage(err),
    };
  }
}
