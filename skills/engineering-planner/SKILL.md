---
name: engineering-planner
description: Reads docs/rflx_PRD.md and turns it into an organized build plan — which features are essential for launch, all the data the product needs to store and how it connects, and a staged build so something working ships early. Saves everything to docs/engineering/ for /implementation-specs to read next.
---

# rflx.ai — Engineering Planner

First skill in the pipeline: PRD → **engineering plan** → implementation specs → build.

## When Invoked

1. Read `docs/rflx_PRD.md` in full.
2. Triage features into essential-for-launch (P0) vs. strengthens-the-demo (P1) — don't just copy the PRD's priority column, re-derive it against what's actually load-bearing for the product's hypothesis.
3. Map out all the data the product needs to store and how it connects — entities, relationships, and any reference data (taxonomies, rule tables) decisions depend on.
4. Break the build into stages ordered so something working ships early, not all at once at the end.
5. Write the result to `docs/engineering/`:
   - `docs/engineering/architecture.md` — system design, model choice, why key decisions were made
   - `docs/engineering/data-model.md` — entities, relationships, reference data
   - `docs/engineering/build-stages.md` — P0/P1 triage, staged plan, explicit trigger points for what to cut if behind
6. Don't silently overwrite existing decisions in `docs/engineering/` on a re-run — diff against what's there and flag what changed and why.
7. Hand off to `/implementation-specs` once the plan is stable — that skill turns this into file-by-file build instructions in `specs/`.

## Test Data & Synthetic "Health System" Setup

Not part of the PRD → engineering-plan transformation itself, but the practical setup needed before Stage 1 can run — kept here since it's planning-adjacent.

**Patient volume — Synthea** (github.com/synthetichealth/synthea, free, Java CLI):
```
git clone https://github.com/synthetichealth/synthea.git
cd synthea
./run_synthea -p 5000                # 5,000 synthetic patients
```
Scale is a flag, not a constraint.

**Health system stand-in — ranked by effort:**
1. **Default:** load Synthea output directly into Supabase tables (`specs/01-database-schema.md`). No FHIR server needed.
2. **Stronger artifact:** self-hosted HAPI FHIR (`docker run -p 8080:8080 hapiproject/hapi:latest`), load Synthea's FHIR bundles into it. Worth it only with schedule slack in Stage 1.
3. **Zero setup:** SMART Health IT's public FHIR launcher (launch.smarthealthit.org) or the public HAPI test server (hapi.fhir.org) — free, preloaded, but a third-party dependency; don't rely on it for the actual recorded demo.

**Adversarial/injection cases:** constructed, not sourced — hand-craft with Claude Code across the categories in `docs/engineering/architecture.md`'s evaluation framework section. No live agent needed — the Mock Clinical Agent Simulator generates action proposals against the Synthea/Supabase data.
