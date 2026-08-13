import "server-only";

/**
 * Shared by lib/investigator/index.ts (OpenAI calls), app/api/agent/action-
 * request/route.ts (step 1 validation), and lib/supabase/queries.ts (step 5
 * persist) — every external call in the Gateway API request pipeline, not
 * just the investigator's.
 *
 * Originally only the investigator's OpenAI calls were wrapped like this,
 * after two eval runs each had one request stall 11-12 minutes with zero
 * error/retry signal, well past the OpenAI client's own 20s timeout setting
 * — a hang below the SDK's own abort handling (e.g. DNS/connection-
 * establishment) that timeout option didn't reliably cover. A later eval run
 * reproduced the same symptom on a request whose investigator step completed
 * normally (clean, case-specific reasoning, no fail-closed fallback text) —
 * ruling out the investigator loop, which is capped at MAX_TURNS with every
 * call already wrapped, as the hang site. That left the Supabase calls in
 * step 1 (getPatientById) and step 5 (recordDecision) as the only remaining
 * unprotected external calls in the pipeline. This uses a plain JS timer
 * with no dependency on any SDK's network internals, so it fires regardless
 * of where in the stack a given call stalls.
 */
export class HardTimeoutError extends Error {}

export function withHardTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new HardTimeoutError(`${label} exceeded hard timeout of ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}
