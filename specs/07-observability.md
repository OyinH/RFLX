# Spec 07 — Observability Wiring

**Builds on:** `specs/03-gateway-api.md` (wraps its steps), `specs/04-investigator.md`, `specs/02-policy-engine.md`.
**Integrates with:** cross-cutting — doesn't change the response contract of any other spec, only adds telemetry alongside it. Full setup process: `skills/observability-setup/SKILL.md`.

## Priority

P1 — scaffolded now, filled in during Days 4–9 alongside the core engine (`docs/engineering/build-stages.md`). Never let this block P0 work.

## What Gets Instrumented

OpenTelemetry spans emitted from within `specs/03-gateway-api.md`'s request handler, at:
1. The Prompt Shield call
2. Each investigator tool call (`specs/04-investigator.md`)
3. The investigator's final structured output
4. The Policy Engine's decision (`specs/02-policy-engine.md`)

Exported to a Microsoft Foundry project. Additive only — never blocks or slows the response if the exporter is unavailable.

## Span Shape

Each span carries enough context to reconstruct the decision trail without duplicating the audit log:
- **Prompt Shield span:** `injection_flag` result, latency, whether the call errored/timed out.
- **Investigator tool-call spans (one per call, up to 5):** tool name, query, latency, success/failure. Never the full `finding` text if it could echo adversarial payload content verbatim into a third-party trace — log a truncated/hashed reference instead if this becomes a real concern; not a blocker for MVP given Foundry is Microsoft-operated and still synthetic data only, but worth stating explicitly rather than assuming.
- **Investigator final-output span:** `risk_tier`, `confidence`, `token_usage`, total tool calls made.
- **Policy Engine span:** the two inputs (`risk_tier`, `injection_flag`) and the resulting `decision` — this one is trivial to add given `specs/02-policy-engine.md`'s function is pure and synchronous.

All four spans for one request share a single trace ID so Foundry can render them as one request's timeline, not four disconnected events.

## What This Is Not

Not a replacement for the Supabase audit trail (`specs/01-database-schema.md`). `incidents` and `review_decisions` remain the compliance-grade record; Foundry is an operational/debugging layer on top.

## Edge Cases

- **Foundry exporter is down or slow:** spans fail to export silently from the request's perspective — the Gateway API response (`specs/03`) must never wait on export confirmation or fail the request because telemetry failed. Use a fire-and-forget/batched exporter, not a synchronous one in the request path.
- **A request fails at Gateway API step 1 (validation, `400`)** before any of steps 2–5 run (`specs/03`): no spans are emitted at all for that request, since none of the instrumented steps executed — an all-or-nothing bundle per request, not a partial trace for a rejected request.
- **A request hits the Fail-Closed Rule** (`specs/02`/`specs/03`): still emits all four spans normally — the Policy Engine span records whatever `risk_tier`/`injection_flag` were available (including a placeholder if the investigator itself failed) and the resulting forced `escalate` decision. Fail-closed is a normal, expected trace shape, not a broken one.
- **High request volume from the eval harness (`specs/08-eval-harness.md`) running dozens of cases in quick succession:** span export must not become a bottleneck that skews the P95 latency measurement the eval run is supposed to produce — batch/async export exists precisely to keep telemetry off the latency-critical path.

## Acceptance Criteria

- [ ] All four spans for a single successful request share one trace ID, visible as one connected timeline in the Foundry project.
- [ ] Killing or misconfiguring the Foundry exporter does not change the Gateway API's response time or success rate — verified by running the eval suite once with the exporter live and once with it deliberately broken, comparing P95 latency and pass/fail counts.
- [ ] A fail-closed request (simulated investigator timeout) produces a complete four-span trace showing the failure and the resulting forced `escalate`, not a partial or missing trace.
- [ ] No span for any request contains real PHI — trivially true given synthetic-only data end to end, but confirmed as part of `skills/security-foundation/SKILL.md`'s pre-ship audit rather than assumed.
