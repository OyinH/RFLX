---
name: design-system
description: The skill used most often. Every time a new screen or component is built, this makes sure it matches everything else — reads docs/design.md at the start of every session, never from memory, and uses named colors and spacing values from the design system rather than inventing new ones.
---

# rflx.ai — Design System Enforcement

This skill has one job: nothing gets built or reviewed without checking `docs/design.md` first, every single time, even if it was just read in a previous session.

## When Invoked

1. Read `docs/design.md` in full, fresh, at the start of this session — don't rely on what a token's value "usually is" from memory. Values can change; the file is the source of truth.
2. Before writing a new component: use only the named tokens defined there (`--color-risk-*`, `--color-decision-*`, `--text-*`, `--space-*`) — never a raw hex code or an arbitrary pixel value typed inline.
3. Cross-check any data-bound field (risk_tier, decision, etc.) against the exact values in `docs/engineering/data-model.md` / `specs/02-policy-engine.md` — a component must render exactly the four risk tiers and three decisions that exist, not an approximation.
4. If a screen needs a token that isn't in `docs/design.md` yet: don't invent one inline. Either add it to `docs/design.md` with a one-line rationale (minor call — e.g., a new spacing value), or flag it back for a real decision (bigger call — e.g., a new semantic color category).
5. When reviewing existing UI code: check for drift specifically — a component using an ad hoc color for risk severity instead of `--color-risk-*`, a spacing value that isn't on the 4px scale, a font size outside the defined type scale.

## Why This Runs Every Time, Not Once

Frontend setup (`/frontend-setup`) bakes the tokens in once. This skill is what keeps every *subsequent* screen — built across many separate sessions — from drifting away from that baseline one small inline override at a time. That drift is invisible in any single component and only becomes obvious once the product has ten screens that don't quite match; checking `docs/design.md` fresh every time is what prevents it.
