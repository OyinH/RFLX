---
name: implementation-specs
description: Takes the engineering plan in docs/engineering/ and turns it into a detailed, room-by-room blueprint — clear build sections, exactly what to build in each and in what order, with every place two features have to integrate flagged explicitly. Saves everything to specs/ for the build stage to code against.
---

# rflx.ai — Implementation Specs

Second skill in the pipeline: engineering plan → **detailed blueprint** → build. Reads `docs/engineering/` (output of `/engineering-planner`), writes `specs/`.

## When Invoked

1. Read `docs/engineering/architecture.md`, `docs/engineering/data-model.md`, and `docs/engineering/build-stages.md` in full.
2. Break the build into clear sections, matching the staged order in `build-stages.md` — one file per section, numbered so build order is unambiguous just from the file listing.
3. For each section: describe exactly what needs to be built, the exact contract (types, shapes, schema) — not a description, a spec Claude Code can implement directly against.
4. Explicitly flag every place two sections integrate — what it builds on, what reads/writes it, so nothing gets discovered by accident mid-build.
5. Write each section to its own file in `specs/`.
6. Don't duplicate specs here in this SKILL.md — `specs/` is the single source of truth once generated, so it can't drift from what this file says.
7. Flag anything in `docs/engineering/` too vague to turn into a concrete spec yet, rather than guessing a shape.

## Current Spec Index

`specs/` is organized in build order, matching `docs/engineering/build-stages.md`:

| File | Section | Builds On |
|---|---|---|
| `specs/00-mock-agent-simulator.md` | Mock Clinical Agent Simulator | `01`, `03` (numbered `00` as the pipeline's entry point, not a build-first dependency) |
| `specs/01-database-schema.md` | Supabase schema (audit trail + Synthea reference data) | Nothing — foundation |
| `specs/02-policy-engine.md` | Risk taxonomy + policy rule table | `01` |
| `specs/03-gateway-api.md` | Gateway API route | `01`, `02`, `04` |
| `specs/04-investigator.md` | Bounded agentic investigator | `01` |
| `specs/05-review-queue-ui.md` | Review Queue UI | `01` |
| `specs/06-dashboard-ui.md` | Dashboard UI | `01` |
| `specs/07-observability.md` | OpenTelemetry → Microsoft Foundry | `03`, `04`, `02` (cross-cutting) |
| `specs/08-eval-harness.md` | Eval harness (injection + benign cases, thresholds) | `00`, `01`, `03` |

Read the individual spec file for the exact contract before implementing that section — this index is a map, not a substitute for the file itself.
