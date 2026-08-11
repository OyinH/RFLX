---
name: security-foundation
description: Reviews the plan or code for security issues before anything ships — like a safety inspector walking through blueprints before construction begins. Checks that private data can only be accessed by the person it belongs to, that incoming payloads are validated before processing, and that secret keys are stored safely. Use before merging any code touching patient data, the investigator, the Policy Engine, or the audit tables.
---

# rflx.ai — Security Foundation

These are constraints, not suggestions. If a change seems to require violating one of these, stop and flag it rather than working around it.

## When Invoked (audit process)

Three checks, adapted to what rflx actually has (no file uploads — the equivalent surface is the action payload):

1. **Private data access control.** Can anyone other than an authorized reviewer read patient context, action payloads, or reasoning/evidence tied to an incident? Check Supabase Row Level Security policies against `specs/01-database-schema.md` — access should be scoped to the reviewer role, not enforced only in the Next.js app layer (a client-side check alone doesn't count).
2. **Incoming payload validation.** Is every `POST /agent/action-request` body validated against the schema in `specs/03-gateway-api.md` *before* any downstream processing (Prompt Shield, investigator, Policy Engine)? An unvalidated payload must never reach those steps — reject with a 400 first.
3. **Secret key storage.** Are OpenAI, Azure Content Safety, Azure/Foundry, and Supabase service-role keys only ever read from environment variables? Check for any hardcoded key, any key present in a client-bundled file, or any key committed to the repo.

For each: report pass or fail, the specific gap named, and the file/line if it's a violation — not a vague "looks okay." Do not approve for ship if any item fails; recommend the fix, don't route around the check to hit a deadline.

## Broader Non-Negotiables (check alongside the three above)

- **No real PHI, ever, in any environment** — including test fixtures, seed data, and local dev. 100% synthetic, Synthea-derived only, no exceptions.
- **Fail closed, not open.** Any classifier error, timeout, or low-confidence result routes to `escalate`, never `auto_approve` (`specs/02-policy-engine.md`).
- **Read-only investigator tools only**, capped at 5 calls (`specs/04-investigator.md`). No write, messaging, or execution tools, ever.
- **Deterministic decision boundary.** The Policy Engine never calls a model (`specs/02-policy-engine.md`).
- **Append-only audit tables.** `incidents` and `review_decisions` are insert-only — no UPDATE, no DELETE (`specs/01-database-schema.md`).
- **Compliance framing.** Illustrates alignment with HIPAA §164.312 — never describe this as a HIPAA-compliant system, in code, UI copy, or docs.

## Responsible AI: Four Pillars

- **Accountability:** the append-only audit trail.
- **Transparency:** every decision carries `reasoning` and `evidence_sources` — never a bare decision with no explanation.
- **Reliability:** fail-closed above; grounding the investigator's judgment in openFDA rather than trained knowledge alone.
- **Fairness:** the investigator's risk_tier judgment could vary with documentation style (terse vs. verbose) rather than actual clinical risk. Mitigation at MVP scale: the eval suite's benign-action set is drawn across Synthea's demographic variation, with per-subgroup consistency reported alongside aggregate catch rate — a known limitation, not a solved problem.

## Out of Scope — Flag, Don't Build, Even If Asked

- Content-level PHI leak scanning (scanning payload text for embedded PHI patterns) — a deliberately different product.
- Live EHR integration.
- Multi-tenant / multi-hospital support.
- Image or multimodal action payloads.
- A second backend runtime alongside the Next.js API routes.
