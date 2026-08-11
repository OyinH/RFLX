/**
 * Extracts a readable message from an unknown thrown value. Exists because
 * Supabase's query-time errors are plain objects shaped like `{ message,
 * code, details, hint }` — typed as `PostgrestError` (which does extend
 * `Error` in its class declaration) but never actually constructed via `new
 * PostgrestError(...)` for a normal failed query, so `err instanceof Error`
 * is false for them at runtime (verified directly against a live query).
 * `err instanceof Error ? err.message : String(err)` silently produces
 * "[object Object]" for exactly this common case — this is the fix, used
 * everywhere a caught error gets logged or put in a response body.
 *
 * No "server-only" import and no dependency on anything that has one — safe
 * to use from both the Next.js app and the standalone scripts/eval scripts.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
