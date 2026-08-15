import type { RiskTier } from "@/lib/supabase/types";

// Shared by app/review-queue/page.tsx and app/incidents/page.tsx (plus their
// DateRangeFilter/FilterSortBar/PaginationControls/decision-tab controls) — every
// control that changes one query param (date range, risk tier, injection flag,
// sort) needs to preserve every other active param, or switching one filter
// silently drops the others. This is the single source of truth for that query
// string, so no individual control has to hand-assemble it.
//
// risk_tier/injection_flag/sort are validated here (not just typed) because they
// come from user-editable URL query params, same reasoning as
// lib/ui/date-range.ts's isValidDateOnly — an invalid/typo'd value is silently
// ignored (falls back to "no filter"/the caller's default sort), not a 500.

const RISK_TIERS: RiskTier[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const INJECTION_FILTERS = ["flagged", "clear"] as const;
const SORT_FIELDS = ["created_at", "risk_tier"] as const;
const SORT_DIRS = ["asc", "desc"] as const;

export type InjectionFilter = (typeof INJECTION_FILTERS)[number];
export type SortField = (typeof SORT_FIELDS)[number];
export type SortDir = (typeof SORT_DIRS)[number];

export function parseRiskTier(value: string | undefined): RiskTier | undefined {
  return RISK_TIERS.includes(value as RiskTier) ? (value as RiskTier) : undefined;
}

export function parseInjectionFilter(value: string | undefined): InjectionFilter | undefined {
  return INJECTION_FILTERS.includes(value as InjectionFilter) ? (value as InjectionFilter) : undefined;
}

export function parseSortField(value: string | undefined): SortField | undefined {
  return SORT_FIELDS.includes(value as SortField) ? (value as SortField) : undefined;
}

export function parseSortDir(value: string | undefined): SortDir | undefined {
  return SORT_DIRS.includes(value as SortDir) ? (value as SortDir) : undefined;
}

export type IncidentListParams = {
  decision?: string;
  from?: string;
  to?: string;
  risk?: RiskTier;
  injection?: InjectionFilter;
  sort?: SortField;
  dir?: SortDir;
  page?: number;
};

/** Query string (no leading `?`), only the params actually present/valid — page omitted when 1. */
export function buildIncidentQuery(params: IncidentListParams): string {
  const sp = new URLSearchParams();
  if (params.decision) sp.set("decision", params.decision);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.risk) sp.set("risk", params.risk);
  if (params.injection) sp.set("injection", params.injection);
  if (params.sort) sp.set("sort", params.sort);
  if (params.dir) sp.set("dir", params.dir);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  return sp.toString();
}
