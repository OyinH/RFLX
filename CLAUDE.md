# CLAUDE.md — rflx.ai

Loads automatically at the start of every session in this repo. Follows the Idea → Research → PRD → Engineering Document → Implementation Specs → Build → Memory Layer → Deployment → Iteration pipeline:

- `docs/rflx_PRD.md` — problem, scope, requirements (PRD stage)
- `docs/engineering/` — architecture, data model, staged build plan (Engineering Document stage — output of `/engineering-planner`)
- `specs/` — exact API contracts, DB schema, tool specs, room-by-room build instructions (Implementation Specs stage — output of `/implementation-specs`)
- `docs/design.md` — the visual design system (colors, type, spacing) — read fresh every session by `/design-system`, baked in once by `/frontend-setup`
- `skills/engineering-planner/SKILL.md` — PRD → engineering plan, plus test-data setup
- `skills/implementation-specs/SKILL.md` — engineering plan → room-by-room specs
- `skills/frontend-setup/SKILL.md` — scaffolds the Next.js shell with the design system baked in, once
- `skills/design-system/SKILL.md` — enforces `docs/design.md` on every screen, every session
- `skills/security-foundation/SKILL.md` — audits plans/code for security gaps before anything ships
- `skills/observability-setup/SKILL.md` — Microsoft Foundry tracing/eval/monitoring wiring (P1, scaffolded — filled in during Days 4–9)

Read the relevant doc before making product or architecture decisions; don't infer scope from code alone. (Older root-level files — `rflx-ai-PRD.md`, `rflx_Project_Blueprint_v2.6.md`, `rflx_Project_Blueprint.md` — are superseded by the structure above and kept only as historical reference.)

rflx.ai is clinical AI agent guardrail middleware: it screens a proposed agent action for manipulation, classifies clinical risk, and returns one governed decision (`auto_approve` / `escalate` / `block`) with a full audit trail. Single Next.js app (API routes + UI) on Netlify, Supabase for data, Microsoft Foundry for observability.

## Build and Test Commands

Project scaffolded by `/frontend-setup` (Next.js 15 App Router, React 19, Tailwind 3, TypeScript). Verified working as of scaffolding: `npm install`, `npm run build`, and `npm run lint` all run clean.

- Install: `npm install`
- Local dev (full app — UI + API routes, on localhost): `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- DB migrations: `supabase db push` — not yet applicable, no Supabase project linked yet (copy `.env.local.example` to `.env.local` once one exists)
- Run eval suite: `npm run eval` → writes `eval/results.csv` — not yet wired (script and case files don't exist yet); fully spec'd in `specs/08-eval-harness.md`
- Run unit tests: `npm test` — not yet wired; no test framework chosen yet
- Deploy: automatic via Netlify on push to `main` (no manual deploy step) — not yet configured; no `netlify.toml` or Netlify site linked yet

## Architectural Decisions

Non-negotiable — do not silently work around these for convenience:

- **Single Next.js app, single deploy.** The Gateway API (`app/api/agent/action-request/route.ts`) and the UI live in the same Next.js app, deployed as one Netlify site. Don't introduce a second backend runtime (Edge Functions, a standalone API server) — see `docs/engineering/architecture.md`.
- **Deterministic decision boundary, agentic investigation.** The Policy Engine (`specs/02-policy-engine.md`) is a fixed rule table — `(risk_tier, injection_flag) → decision`. It never calls a model. If a change to decision logic seems to need an LLM call, stop and flag it instead of adding one.
- **Fail closed, not open.** Any classifier error, timeout, or low-confidence result routes to `escalate`, never to `auto_approve`.
- **Read-only investigator tools only.** Layer 2 (openFDA lookup, patient medication history) never gets write, messaging, or execution tools. Capped at 5 tool calls per investigation.
- **No real PHI, ever, in any environment** — including test fixtures, seed data, and example payloads. All patient data is Synthea-derived synthetic data only.
- **Append-only audit tables.** `incidents` and `review_decisions` are never updated or deleted, only inserted. Supabase is the compliance-grade record; Microsoft Foundry (below) is a complementary observability layer, not a substitute.
- **Observability via OpenTelemetry → Microsoft Foundry.** Every Gateway API call emits OTel spans (Prompt Shield call, each investigator tool call, final decision) to a Foundry project. This is P1 — wire it up alongside the core engine build, but never let it block the P0 guardrail logic.

Full detail on all of the above: `skills/security-foundation/SKILL.md`.

## Coding Standards

- TypeScript throughout, Next.js App Router conventions — no untyped `any` in the Gateway API route or Policy Engine code.
- Every Gateway API response must validate against the schema in `specs/03-gateway-api.md` before returning — reject/500 rather than return a malformed payload.
- The investigator's LLM call must always request the structured output schema (`risk_tier`, `reasoning`, `evidence_sources`) — never free-form text parsing.
- No secrets in code. API keys (OpenAI, Azure Content Safety, Azure/Foundry, Supabase) come from environment variables only.
- Server-only logic (Gateway API, Policy Engine, investigator calls) stays in Route Handlers / Server Components — never expose OpenAI, Azure, or Supabase service-role keys to the client bundle.

## Naming Conventions

- `action_type` values are a closed enum — `draft_note | update_medication | schedule_referral | message_patient | export_record | update_problem_list` (`specs/02-policy-engine.md`). Don't introduce a new action type without updating the risk taxonomy and policy table in the same change.
- Prompt files: `prompts/investigator_vN.md`, incrementing N on every content change. Never edit a prompt in place — see Prompt Changes below.
- Supabase tables follow the schema in `specs/01-database-schema.md` exactly: `agent_actions`, `risk_classifications`, `incidents`, `review_decisions`.
- API routes follow Next.js App Router file conventions: `app/api/agent/action-request/route.ts` for the Gateway endpoint.
- Design tokens follow `docs/design.md` exactly — named tokens only (`--color-risk-*`, `--color-decision-*`, `--text-*`, `--space-*`), never inline hex/pixel values.
- Mermaid diagrams live in `docs/architecture.mmd` (HLD) and `docs/sequence.mmd` (sequence), committed as text.

## Common Workflows

**Pipeline order** (don't reorder): `/engineering-planner` → `/implementation-specs` → `/frontend-setup` (once) → build each `specs/` section, with `/design-system` checked on every screen and `/security-foundation` checked before anything ships.

**Build order** (`docs/engineering/build-stages.md`):
1. Eval suite + Mermaid diagrams + Supabase schema, committed first
2. Core engine: mock agent → Prompt Shield → investigator → policy engine → Supabase read/write, with OpenTelemetry spans wired to Foundry as each step is built
3. UI: review queue before dashboard (dashboard and Foundry instrumentation are both P1 — either can slip first)
4. Run the full eval suite, tune thresholds, only then record/ship

**Prompt changes:** save as a new `prompts/investigator_vN.md`, re-run the full eval suite, only then swap it into the deployed route. Never ship a prompt change without a full eval re-run.

**Adding an eval case:** add to `eval/` following the categories in `docs/engineering/architecture.md`'s evaluation framework section, re-run the full suite, commit the updated `eval/results.csv` alongside the new case.

**Local testing:** run `next dev`, exercise the full loop (submit action → investigate → decide → appears in queue or auto-approves → dashboard updates) against a Supabase project before every push.

**Test data setup** (`skills/engineering-planner/SKILL.md`): generate synthetic patients with Synthea (`./run_synthea -p N`), load the output into Supabase — the default path, no FHIR server required for MVP. Adversarial/injection test cases are hand-crafted, not sourced from any dataset. Never substitute real patient data, even for local testing.

## Out of Scope — Do Not Build

Per `docs/rflx_PRD.md` §6.2 and `skills/security-foundation/SKILL.md`, deliberately excluded, not deferred:
- Content-level PHI leak scanning (scanning payload text for embedded PHI patterns)
- Live EHR integration
- Multi-tenant / multi-hospital support
- Image or multimodal action payloads
- A second backend runtime alongside the Next.js API routes (no Edge Functions, no standalone FastAPI/Express server)
