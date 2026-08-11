---
name: frontend-setup
description: Builds the empty shell of the Next.js application with the design system already baked in. Reads docs/design.md first so colors and fonts are built in from day one, creates the folder structure so every future file has a logical home, and sets up the Supabase connection. Use once, at the start of frontend work.
---

# rflx.ai — Frontend Setup

Reads `docs/design.md` (design tokens) and `specs/01-database-schema.md` (what to connect to). Produces the shell that `/design-system` then enforces on every subsequent screen.

## When Invoked

1. Read `docs/design.md` first, in full — colors, typography, spacing tokens get wired into the project's Tailwind config (or equivalent) before a single component is written, not retrofitted later.
2. Create the Next.js App Router folder structure so every future file has an obvious home:
   ```
   app/
     api/agent/action-request/route.ts   # Gateway API (specs/03-gateway-api.md)
     review-queue/                        # specs/05-review-queue-ui.md
     dashboard/                           # specs/06-dashboard-ui.md
   lib/
     supabase/                            # client setup, typed against specs/01-database-schema.md
     policy-engine/                       # specs/02-policy-engine.md — pure logic, no framework dependency
     investigator/                        # specs/04-investigator.md
   prompts/
     investigator_v1.md
   ```
3. Set up the Supabase client connection — typed against `specs/01-database-schema.md`'s schema, read/write helpers scoped to what each planned view actually needs (don't expose a generic client with broader access than a view requires).
4. Confirm the design tokens render correctly on one placeholder screen before handing off to actual feature work — this is the checkpoint that the shell is real, not just scaffolded.

## Non-Negotiable

- Server-only logic (Gateway API, Policy Engine, investigator calls) stays in Route Handlers / Server Components. Never expose OpenAI, Azure, or Supabase service-role keys to the client bundle.
- One Next.js app, one Netlify deploy — don't scaffold a separate frontend project or a second backend runtime (`docs/engineering/architecture.md`).

## Handoff

Once the shell exists, every new screen goes through `/design-system` for enforcement — this skill runs once at setup, not repeatedly per screen.
