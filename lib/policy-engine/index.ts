import type { Decision, RiskTier } from "@/lib/supabase/types";

/**
 * Deterministic rule table — specs/02-policy-engine.md. Pure logic, no
 * framework or model dependency. Given the same two inputs, always produces
 * the same output — never add a model call here.
 */
const RULE_TABLE: Record<RiskTier, { whenNoInjection: Decision; whenInjection: Decision }> = {
  LOW: { whenNoInjection: "auto_approve", whenInjection: "escalate" },
  MEDIUM: { whenNoInjection: "auto_approve", whenInjection: "escalate" },
  HIGH: { whenNoInjection: "escalate", whenInjection: "block" },
  CRITICAL: { whenNoInjection: "block", whenInjection: "block" },
};

/**
 * decide() never second-guesses risk_tier against the action_type taxonomy
 * (specs/02's Edge Cases) — it trusts its two inputs and applies the table
 * mechanically. The caller (specs/03-gateway-api.md) is responsible for
 * validating the investigator's structured output before calling this, so an
 * out-of-enum risk_tier here is a caller bug, not a case to paper over.
 */
export function decide(riskTier: RiskTier, injectionFlag: boolean): Decision {
  const rule = RULE_TABLE[riskTier];
  if (!rule) {
    throw new Error(
      `decide() received an out-of-taxonomy risk_tier: ${JSON.stringify(riskTier)}. ` +
        `Callers must validate against LOW | MEDIUM | HIGH | CRITICAL before calling decide().`,
    );
  }
  return injectionFlag ? rule.whenInjection : rule.whenNoInjection;
}
