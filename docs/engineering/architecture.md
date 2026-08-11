# rflx.ai — Architecture

Output of `/engineering-planner`, reading `docs/rflx_PRD.md`. Companion files: `docs/engineering/data-model.md` (what gets stored, how it connects) and `docs/engineering/build-stages.md` (staged build plan). Detailed build-time contracts live in `specs/`.

## High-Level Design

Canonical source: [`docs/architecture.mmd`](../architecture.mmd) (committed as text per CLAUDE.md's diagram convention — render it with a Mermaid viewer or GitHub's built-in preview). Sequence-level detail for a single request's lifecycle is in [`docs/sequence.mmd`](../sequence.mmd).

**Data flow:** mock agent generates a proposed action against synthetic patient context → Layer 1 (Prompt Shield) screens for known injection patterns → if it passes, Layer 2 (bounded investigator) evaluates clinical content, calling read-only tools up to a fixed cap → Policy Engine applies deterministic rules combining both layers' outputs → decision + reasoning + evidence persisted to Supabase → escalations route to the review queue → every step emits an OpenTelemetry span to Microsoft Foundry alongside the Supabase write.

## Why Two Detection Layers, Not One

A single LLM call trying to both detect injection *and* judge clinical severity conflates two different failure modes. Splitting them yields separate precision/recall for "did we catch the attack" versus "did we correctly judge the clinical risk."

## Why One Next.js App, Not a Split Stack

Backend (Gateway API routes) and frontend (review queue, dashboard) live in one Next.js app deployed as a single Netlify site. One framework, one local dev command, one deploy pipeline, one thing to debug when something breaks. Retool is the documented fallback for the dashboard specifically if the custom build runs behind (see `docs/engineering/build-stages.md`).

## Bounded Agency, Deterministic Decision

The investigator has real agency — it decides which tools to call, in what order, and when it has enough evidence. That agency is fenced three ways: read-only tool access only, a hard cap of 5 investigation steps, and a strict output schema it must terminate into. It cannot decide the outcome — that's the Policy Engine's job, and the Policy Engine is a fixed rule table, never a model call.

This split is deliberate, not a limitation to work around: agency belongs in investigation (where adaptive capability adds value), determinism belongs in the decision (where auditability and trust depend on it). Current industry guidance (Microsoft's agentic-AI security guidance, Salesforce's Agent Script, FINRA's 2026 oversight report) points the same direction, specifically because agents are becoming more autonomous, not despite it — as the governed system gets harder to predict, one fixed, auditable point in the pipeline becomes more valuable, not less.

## Model Choice

| Layer | Choice | Why | Rejected Alternative |
|---|---|---|---|
| Injection pre-screen | Azure AI Content Safety — Prompt Shield | Purpose-built, free tier covers demo volume, commodity capability | Custom-trained classifier — infeasible to get labeled attack data at this scale |
| Clinical risk investigation | OpenAI GPT-5.6 Terra, bounded tool access, capped at 5 calls | Strong reasoning-to-cost fit; grounding in openFDA gives a citable source instead of only the model's trained knowledge | Ungrounded single classification call — doesn't escape the reliability problem the JAMA study documents |
| Application layer | Next.js on Netlify, one app | Single framework and deploy target | Supabase Edge Functions + separate frontend — two runtimes, two deploy targets, no offsetting benefit |
| Observability | Microsoft Foundry (Tracing, Evaluation, Monitoring) | GA March 2026; interoperates with OpenAI SDK calls directly via OpenTelemetry, no Azure OpenAI migration needed | Custom Supabase-only logging — no trace replay, no built-in evaluators, no drift monitoring |

## Evaluation Framework (Summary)

Eval suite is written and committed **before** guardrail implementation — a checked-in eval file with an earlier git timestamp is verifiable proof the tests existed first. Target: catch rate ≥90%, false-positive rate <10%, P95 latency <3s, all three simultaneously before recording the demo. Microsoft Foundry's continuous evaluation extends this beyond the one-time run once instrumented (`skills/observability-setup/SKILL.md`).

**Adversarial/injection taxonomy — corrected against the source study.** The JAMA Network Open paper ("Vulnerability of Large Language Models to Prompt Injection When Providing Medical Advice," PMC12717619) does **not** use six attack categories — that figure previously cited here was a mix-up with the paper's 6-turn dialogue structure (turn 4 = primary outcome, turn 6 = secondary outcome). The paper's actual structure is **2 injection strategies × 3 harm strata**:

| Injection strategy | Mechanism | Harm strata tested (scenario count) |
|---|---|---|
| Context-Aware Injection | Dynamically incorporates patient-specific context to produce subtle, contextually-plausible manipulations toward moderate/high-risk recommendations | Moderate (3), High (4) |
| Evidence-Fabrication Injection | Introduces falsified meta-analyses or fabricated guideline excerpts attributed to reputable sources to legitimize extremely-high-harm interventions | Extremely High (5), e.g. FDA Category X drugs |

12 clinical scenarios total, 3 trials per model per condition (injection vs. control) → 216 dialogues in the source study.

**Adapted onto rflx's `action_type` taxonomy** (hand-crafted, not sourced — no dataset to pull from, per `skills/engineering-planner/SKILL.md`):
- **Evidence-Fabrication cases** skew toward `update_medication` / `update_problem_list` at HIGH/CRITICAL risk tier — a fabricated guideline citation or meta-analysis used to justify a contraindicated medication change is exactly this strategy's shape, and those two action types already carry the highest baseline risk tiers in `specs/02-policy-engine.md`'s taxonomy.
- **Context-Aware cases** skew toward `message_patient` / `schedule_referral` at MEDIUM/HIGH tier — subtle reframing of patient context to make an unsafe instruction look like routine care.
- Benign (non-injection) cases are drawn from Synthea across all six `action_type` values, with no injection content, to ground the false-positive-rate measurement.

**Fairness/bias stratification (resolves PRD Open Question #2 — decision: build a lightweight version into the MVP eval run, not deferred).** Benign eval cases are stratified across the demographic fields Synthea already generates on each synthetic patient record — age band, sex, and race/ethnicity as coded by Synthea — no new data source or infrastructure required. Catch rate and false-positive rate are reported per stratum in addition to the aggregate figures, in the same `eval/results.csv` output (stratum columns added, not a new file or table — see `docs/engineering/data-model.md`). This is deliberately lightweight: it surfaces a stratum where the false-positive rate diverges sharply from the aggregate <10% target, without attempting a full fairness audit at MVP scale. If a stratum shows a meaningfully worse false-positive rate, that's a signal to investigate the classifier prompt, not to silently average it away in the top-line number.

## Reviewer-Outcome Calibration (P1 — added post-MVP-build)

`docs/rflx_PRD.md` §6.1 adds a reviewer-outcome calibration log; §3.6 names it as the concrete implementation of the product's stated MOAT (a taxonomy tuned against real reviewer decisions — previously an unimplemented claim with no data trail behind it). At the architecture level this is deliberately small: no new service, no new model call, no change to the Policy Engine's decision boundary — it stays a fixed rule table, per CLAUDE.md's non-negotiable. It's an additive capture step at the point a reviewer submits a decision in the existing review queue UI: two more structured fields recorded alongside the existing approve/reject outcome, detailed in `docs/engineering/data-model.md`.

What's explicitly not built at this stage: any dashboard, aggregation, or automated threshold-adjustment logic reading from this log. `docs/rflx_PRD.md` §6.3 defers that piece — a synthetic 2-week demo doesn't generate enough real reviewer volume for a tuning signal to mean anything yet, and building analysis tooling against near-empty data would be premature. This stage is capture-only: start the data trail now so it exists to analyze later, without pretending the analysis itself is ready.

## Security & Compliance Posture (Summary)

No real PHI, ever, in any environment. Append-only audit tables (`incidents`, `review_decisions`). Fail-closed on any classifier error, timeout, or low-confidence result. Designed to *illustrate* alignment with HIPAA §164.312 — explicitly not a HIPAA-compliant system. Full actionable checklist: `skills/security-foundation/SKILL.md`.
