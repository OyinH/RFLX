// Shared by app/review-queue/page.tsx and app/incidents/page.tsx — both paginate
// a decision-filtered incident list oldest/newest-first with a large enough
// backlog (verified live: 693+ unreviewed incidents from a single day) that a
// reviewer needs to jump straight to a date rather than page through hundreds
// of rows to reach it. `from`/`to` are date-only (native <input type="date">
// values, no time component); resolved here to UTC day boundaries so the query
// layer (lib/supabase/queries.ts) only ever deals in already-resolved
// timestamps. `to` is inclusive of the whole day, hence the +1-day exclusive
// upper bound.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateOnly(value: string | undefined): value is string {
  if (!value || !DATE_ONLY.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
}

export type ResolvedDateRange = { startTs?: string; endTs?: string };

export function resolveDateRange(from?: string, to?: string): ResolvedDateRange {
  const startTs = isValidDateOnly(from) ? new Date(`${from}T00:00:00.000Z`).toISOString() : undefined;
  const endTs = isValidDateOnly(to)
    ? new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000).toISOString()
    : undefined;
  return { startTs, endTs };
}

/** Query string (no leading `?`) carrying only the validated from/to params, for building hrefs. */
export function buildDateQuery(from?: string, to?: string): string {
  const params = new URLSearchParams();
  if (isValidDateOnly(from)) params.set("from", from);
  if (isValidDateOnly(to)) params.set("to", to);
  return params.toString();
}
