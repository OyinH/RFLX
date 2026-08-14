---
name: observability-setup
description: Sets up and wires Microsoft Foundry tracing, evaluation, and monitoring for rflx.ai via OpenTelemetry. Use when instrumenting the Gateway API routes during core-engine build (Days 4-9), when configuring the Foundry project or Rubric evaluator, or when setting up the post-launch monitoring dashboard.
---

# rflx.ai — Observability Setup

Companion to `docs/design.md` §5 (rationale — what Foundry adds, what it doesn't replace) and `skills/implementation-specs/SKILL.md` (which spans to emit and where).

## Status: Tracing Live, Evaluator/Monitoring Still Open

This is P1 (`skills/engineering-planner/SKILL.md`) — the guardrail engine and eval suite fully prove the hypothesis without it. Tracing (Setup Checklist items 1–5 below) is done and verified end-to-end in both local dev and production (Netlify serverless). The Rubric evaluator, continuous evaluation sampling, and Agent Monitoring Dashboard alert threshold (items 6–8) are not started.

## When Invoked

1. Confirm the Microsoft Foundry project exists (Azure subscription already confirmed in hand — see `docs/rflx_PRD.md` Assumptions).
2. Install and configure the OpenTelemetry SDK in the Next.js API route(s), exporting via the Azure Monitor exporter (`@azure/monitor-opentelemetry-exporter`) using the Application Insights connection string linked to the Foundry project — not a generic OTLP/HTTP endpoint, which isn't how Foundry ingests traces (verified against current Microsoft Learn docs).
3. Instrument spans at exactly the points listed in `skills/implementation-specs/SKILL.md`'s Observability Wiring section: the Prompt Shield call, each investigator tool call, the investigator's final output, and the Policy Engine decision.
4. Verify one full manual walkthrough produces an end-to-end trace visible in the Foundry portal.
5. Build the custom Rubric evaluator from the risk taxonomy (`skills/implementation-specs/SKILL.md`), and configure continuous evaluation sampling.
6. Configure the Agent Monitoring Dashboard alert threshold — false-positive rate exceeding 15% over a rolling 7-day window.
7. If any step here runs behind schedule, stop. This is P1 — ship the demo on the Supabase audit trail alone (per `skills/engineering-planner/SKILL.md`'s risk checkpoints) and note Foundry as the documented next step, not a blocker.

## Setup Checklist

Check these off as they're actually done — don't mark complete ahead of the real work:

- [x] Microsoft Foundry project created, separate from the Azure AI Content Safety resource
- [x] Application Insights resource linked to the Foundry project (not provisioned automatically — associate or create one)
- [x] OpenTelemetry exporter (`@azure/monitor-opentelemetry-exporter`) configured with the Application Insights connection string
- [x] Spans emitting for: Prompt Shield call, investigator tool calls, investigator output, Policy Engine decision
- [x] End-to-end trace verified — confirmed in Application Insights' `dependencies` table (not `traces`, which is a different Application Insights concept for log/diagnostic messages), from both local dev and production
- [ ] Custom Rubric evaluator built from the risk taxonomy
- [ ] Continuous evaluation sampling configured
- [ ] Agent Monitoring Dashboard alert threshold configured (FP rate > 15% over rolling 7 days)
