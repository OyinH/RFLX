# rflx.ai — Data Model

Output of `/engineering-planner`: what the product needs to store and how it connects. Exact column-level contract for implementation lives in `specs/01-database-schema.md`.

## Entities and Relationships

Four tables, one linear chain — every agent action produces exactly one classification, exactly one incident, and (if escalated) exactly one review decision:

```
agent_actions (1) ──< risk_classifications (1)
agent_actions (1) ──< incidents (1) ──< review_decisions (0 or 1)
```

- **`agent_actions`** — the source record. One row per action a mock agent submits: who submitted it, what type of action, the payload, where it came from.
- **`risk_classifications`** — Layer 2's output for that action: risk tier, injection flag, reasoning, token cost. One-to-one with `agent_actions`.
- **`incidents`** — the Policy Engine's decision for that action: auto_approve, escalate, or block, plus latency. One-to-one with `agent_actions`.
- **`review_decisions`** — only exists for incidents where `decision = 'escalate'`: the reviewer's outcome (approved/rejected) and notes. Zero or one per incident.

`incidents` and `review_decisions` are append-only — never updated or deleted, only inserted. They're the compliance-grade audit record (`docs/engineering/architecture.md` Security & Compliance section).

**Addition (P1, `docs/rflx_PRD.md` §6.1 — reviewer-outcome calibration log):** `review_decisions` gains two more structured fields, captured at the same time as the existing approve/reject outcome, no new entity or relationship: a `classification_agreement` value (did the reviewer agree with the system's `risk_tier`, or think it should have been lower/higher) and a `reason_code` (a closed enum, not free text — why). Still append-only, still zero-or-one per incident. This is capture only — no table or process reads these back yet; that's the deferred calibration loop (`docs/rflx_PRD.md` §6.3).

## Reference Data the Decision Depends On

Two structures aren't stored in the database — they're fixed, versioned logic the Policy Engine and investigator reason against:

- **Risk taxonomy** — maps `action_type` to a baseline risk tier and escalation trigger. Determines what `risk_tier` value the investigator should land on for a given action type.
- **Policy rule table** — maps `(risk_tier, injection_flag)` to a decision. Purely deterministic; this is what actually populates `incidents.decision`.

Both are specified exactly in `specs/02-policy-engine.md` — treat that file, not this one, as the source of truth for the literal values.

- **Injection eval taxonomy + fairness stratification dimensions** — a third structure in this category, alongside the two above. Not stored in the database: it's the fixed, versioned design the eval harness (P0, spec'd in `specs/08-eval-harness.md`) hand-crafts adversarial and benign test cases against. Two parts:
  - **Injection taxonomy** — 2 strategies (Context-Aware, Evidence-Fabrication) × 3 harm strata, adapted from the JAMA study onto rflx's `action_type` enum. Full detail: `docs/engineering/architecture.md`'s Evaluation Framework section.
  - **Fairness stratification dimensions** — age band, sex, race/ethnicity, as coded on Synthea-generated patient records. Benign eval cases are tagged with these so catch-rate/false-positive-rate can be reported per stratum, not just in aggregate.

  Eval *results* (`eval/results.csv`, per CLAUDE.md's build commands) are a versioned file artifact, not a Supabase table — explicitly outside this data model. Don't add an eval-results table to the schema; the file is the record.

- **Reviewer reason-code taxonomy** — a fourth reference structure, same "fixed, versioned logic" framing as the three above: the closed enum values a reviewer picks from for `review_decisions.reason_code` (e.g., correct classification / overly cautious / missed clinical context / fabricated evidence not flagged / other). Exact values are `/implementation-specs`' job to pin down against `specs/02-policy-engine.md`'s existing risk taxonomy — flagged here as a structure that needs to exist, not yet fully enumerated.

## External Data, Not Owned by rflx

- **openFDA drug label API** — read-only lookup the investigator calls; not stored locally beyond what's logged in `risk_classifications.reasoning` / `evidence_sources`.
- **Synthea-derived synthetic patient records** — the source for `patient_context_id` and medication history; loaded into Supabase as the default "health system" stand-in (`skills/engineering-planner/SKILL.md` has the generation/loading steps).

## What's Explicitly Not in the Data Model

Per `docs/rflx_PRD.md` §6.2: no real PHI, no live EHR data, no multi-tenant/hospital scoping (single implicit tenant for the MVP), no content-level PHI scanning of payload text.
