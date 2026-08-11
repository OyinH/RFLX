---
name: observability-setup
description: Sets up and wires Microsoft Foundry tracing, evaluation, and monitoring for rflx.ai via OpenTelemetry. Use when instrumenting the Gateway API routes during core-engine build (Days 4-9), when configuring the Foundry project or Rubric evaluator, or when setting up the post-launch monitoring dashboard.
---

# rflx.ai — Observability Setup

Companion to `docs/design.md` §5 (rationale — what Foundry adds, what it doesn't replace) and `skills/implementation-specs/SKILL.md` (which spans to emit and where).

## Status: Scaffolded, Details Filled In During Build (Days 4–9)

This is P1 (`skills/engineering-planner/SKILL.md`) — the guardrail engine and eval suite fully prove the hypothesis without it, so this file is a checklist and process for now, not a finished spec. Fill in the exact OTel SDK config and Rubric evaluator definition once they're actually written, the same way `skills/design-system/SKILL.md` gets filled in as visual decisions get made.

## When Invoked

1. Confirm the Microsoft Foundry project exists (Azure subscription already confirmed in hand — see `docs/rflx_PRD.md` Assumptions).
2. Install and configure the OpenTelemetry SDK in the Next.js API route(s), pointed at the Foundry project's exporter endpoint.
3. Instrument spans at exactly the points listed in `skills/implementation-specs/SKILL.md`'s Observability Wiring section: the Prompt Shield call, each investigator tool call, the investigator's final output, and the Policy Engine decision.
4. Verify one full manual walkthrough produces an end-to-end trace visible in the Foundry portal.
5. Build the custom Rubric evaluator from the risk taxonomy (`skills/implementation-specs/SKILL.md`), and configure continuous evaluation sampling.
6. Configure the Agent Monitoring Dashboard alert threshold — false-positive rate exceeding 15% over a rolling 7-day window.
7. If any step here runs behind schedule, stop. This is P1 — ship the demo on the Supabase audit trail alone (per `skills/engineering-planner/SKILL.md`'s risk checkpoints) and note Foundry as the documented next step, not a blocker.

## Setup Checklist

Check these off as they're actually done — don't mark complete ahead of the real work:

- [ ] Microsoft Foundry project created, separate from the Azure AI Content Safety resource
- [ ] OpenTelemetry exporter configured and pointed at the Foundry project
- [ ] Spans emitting for: Prompt Shield call, investigator tool calls, investigator output, Policy Engine decision
- [ ] End-to-end trace verified in the Foundry portal
- [ ] Custom Rubric evaluator built from the risk taxonomy
- [ ] Continuous evaluation sampling configured
- [ ] Agent Monitoring Dashboard alert threshold configured (FP rate > 15% over rolling 7 days)
