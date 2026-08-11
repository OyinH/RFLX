# rflx.ai — Build Stages

Output of `/engineering-planner`: what's essential for launch, and the order that ships something working early rather than everything at once.

## Essential for Launch (P0) vs. Strengthens the Demo (P1)

**P0 — never cut, ship regardless of schedule pressure:**
Mock agent simulator, injection pre-screen (Prompt Shield), clinical risk classifier (investigator), policy engine, human-in-the-loop review queue, audit log, eval harness. Full rationale for why each is load-bearing: `docs/rflx_PRD.md` §6.1.

**P1 — strengthens the story, cut first if behind:**
Incident dashboard, Microsoft Foundry observability instrumentation. The review queue alone already proves the core loop (submit → screen → investigate → decide → escalate-or-approve → audit trail) without either of these.

## Staged Build Plan (2 weeks)

| Days | Stage | Ships | Why this order |
|---|---|---|---|
| 1–3 | Spec | Eval test cases (written *before* any implementation), `docs/architecture.mmd` + `docs/sequence.mmd` (committed as their own text files per CLAUDE.md's naming convention, not just inline in `architecture.md`), Supabase schema | Proves the guardrail logic before it exists — the eval suite's git timestamp is the evidence |
| 4–9 | Core engine | Mock agent → Prompt Shield → investigator → policy engine → Supabase read/write, OpenTelemetry spans added as each step is built | This is the whole hypothesis — everything else is presentation of what this stage proves |
| 8–12 | UI (overlaps core build's tail) | Review queue first, dashboard second, same Next.js app/deploy as the API routes | Review queue is what makes "escalate" a real, demonstrable outcome, not just a database row |
| 12–14 | Evaluation & demo | Full eval suite run, thresholds tuned, demo recorded | Nothing ships to the recorded demo until go/no-go criteria pass simultaneously |

**Ship-something-early checkpoint:** by end of Day 9, the core engine should be callable end-to-end via a script even with no UI — that's the earliest point the actual hypothesis (does the guardrail catch injections and correctly gate risk) can be tested, days before the UI exists.

## Spec Coverage

`specs/00`–`08` now cover all nine P0/P1 components — mock agent simulator, database schema (audit trail + Synthea reference data), policy engine, gateway API, investigator, review queue UI, dashboard UI, observability, and the eval harness. Stage 1 (Days 1–3) is spec-complete; nothing left to flag here. Each file's own Acceptance Criteria section is the bar the Build stage codes against.

## Days 12–14 Status

Full eval suite run against the live, fully-built system (`specs/08-eval-harness.md`, `docs/rflx_PRD.md`'s Success Metrics table). Catch rate and false-positive rate — the two metrics that actually validate the hypothesis — both clear their targets cleanly (100% / 0%). P95 latency does not (8.7s vs. <3s), root-caused to reasoning-model round-trip count, not infra overhead; closing it further needs an architectural change, not a tuning pass. This line's own "nothing ships until go/no-go criteria pass simultaneously" is being knowingly not followed on the latency criterion specifically — a deliberate, documented call given where the effort-to-value tradeoff sits right now, not a silent miss.

## Explicit Trigger Points (decide now, not mid-crisis)

- **Day 10 checkpoint:** if the Next.js review queue isn't functional by end of Day 10, switch to Retool for the dashboard specifically (keep Next.js for the review queue if it's further along) — same Supabase schema underneath, no backend rework either way.
- **Foundry instrumentation:** P1, wired alongside Days 4–9. If it runs behind, ship the demo on the Supabase audit trail alone and note Foundry as the documented next step, not a missing core feature (`skills/observability-setup/SKILL.md`).

## Post-MVP Addition: Reviewer-Outcome Calibration Log (P1)

Added to `docs/rflx_PRD.md` §6.1 after the Days 12–14 build above was already complete and demo-ready — this is new scope on top of a finished MVP, not part of the original 2-week plan. Two structured fields on `review_decisions` (`docs/engineering/data-model.md`), captured in the existing review queue UI at decision time. No change to the investigator, Policy Engine, or decision boundary, so it does **not** require a full eval-suite re-run (`skills/security-foundation/SKILL.md`'s re-run trigger is for prompt/policy changes, neither of which this touches).

Touches, once `/implementation-specs` picks this up: `specs/01-database-schema.md` (two new `review_decisions` columns + the reason-code enum) and `specs/05-review-queue-ui.md` (review queue UI — reviewers need a control to set `classification_agreement`/`reason_code` alongside the existing approve/reject action). The deferred analysis/tuning loop over this log (`docs/rflx_PRD.md` §6.3) is not spec'd here or anywhere yet — correctly so, per that section's own rationale.

## Git Discipline

Commit eval suite and diagrams first, implementation second, results third — this ordering is itself verifiable evidence of spec-first discipline (a checked-in eval file with an earlier git timestamp proves the tests existed before the implementation, not after).
