# rflx.ai — Design System

**Status:** v1 proposed. Nothing in the PRD or engineering docs specified brand colors, fonts, or spacing — these are sensible defaults for the product's audience (health system CISOs, Chief Digital/AI Officers, clinical informatics/pharmacist reviewers), ready to use as-is or override before `/frontend-setup` runs. Once `/frontend-setup` bakes these in, treat this file as the source of truth — `/design-system` reads it at the start of every session, never from memory.

## Principles

- **Enterprise-clean, not playful.** This is a security/compliance product for a CISO-facing audience — prioritize legibility and density over decoration.
- **Color is functional, not decorative.** Risk tier and decision-state colors are the product's core information — a reviewer should be able to scan risk severity at a glance. Don't introduce color for anything else without a reason.
- **The Review Queue is a working tool, used repeatedly** — prioritize scan-ability (tabular, sortable, filterable) over whitespace.

## Color Tokens

### Neutrals
| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#F8F9FB` | Page background |
| `--color-surface` | `#FFFFFF` | Cards, table rows, panels |
| `--color-border` | `#E2E5EA` | Dividers, table borders |
| `--color-text-primary` | `#111827` | Body text, headings |
| `--color-text-secondary` | `#6B7280` | Metadata, timestamps, helper text |

### Brand
| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#312E81` | Primary actions, links, active states |
| `--color-primary-hover` | `#201C55` | Primary action hover state |

**Change note:** the original `#2563EB` was Tailwind's default blue-600 — one of the most common default colors in AI-built products, and specifically flagged as reading "generic" rather than designed. Kept in the same blue family but shifted from bright/saturated to deep/muted, which is what actually separates a considered brand color from a starter-template one. Verified at 11.42:1 (primary) / 15.46:1 (hover) against both white button text and the page background — well past WCAG AAA, not just the AA minimum the risk/decision tokens target.

### Semantic — Risk Tier (`docs/engineering/data-model.md` reference data)
| Token | Value | risk_tier |
|---|---|---|
| `--color-risk-low` | `#15803D` (green) | LOW |
| `--color-risk-medium` | `#B45309` (amber) | MEDIUM |
| `--color-risk-high` | `#C2410C` (orange) | HIGH |
| `--color-risk-critical` | `#DC2626` (red) | CRITICAL |

### Semantic — Decision
| Token | Value | decision |
|---|---|---|
| `--color-decision-approve` | `#15803D` (green) | auto_approve |
| `--color-decision-escalate` | `#B45309` (amber) | escalate |
| `--color-decision-block` | `#DC2626` (red) | block |

**Rule:** any component displaying a `risk_tier` or `decision` value uses these tokens exclusively — never an ad hoc color chosen per component. This is what `/design-system` checks for on every screen.

**Contrast note (Change Process):** the original green/amber/orange values (`#16A34A`/`#D97706`/`#EA580C`) measured 3.19-3.56:1 contrast against the white text every risk/decision badge uses — below WCAG AA's 4.5:1 minimum for normal-size text (computed via the standard relative-luminance formula, not estimated). Darkened to the values above, each verified at 5.02-5.18:1. `--color-risk-critical`/`--color-decision-block` were already compliant (4.83:1) and are unchanged.

## Typography

- **Font stack:** `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` — system-first, no custom font loading required for the MVP.
- **Wordmark exception:** the "rflx.ai" logotype (`app/NavBar.tsx` only) uses Space Grotesk (`next/font/google`, exposed as `--font-logo`/the `font-logo` Tailwind utility) — a logotype set in the same font as surrounding body copy reads as plain text next to an icon, not a designed brand mark. Scoped to the wordmark only; never use `font-logo` for UI/body text.
- **Scale:**

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 12px | Metadata, table cell secondary text |
| `--text-sm` | 14px | Table body, form labels |
| `--text-base` | 16px | Default body text |
| `--text-lg` | 18px | Section headings |
| `--text-xl` | 24px | Page titles |
| `--text-2xl` | 32px | Dashboard summary numbers |

- **Weight:** 400 (body), 500 (labels/emphasis), 600 (headings) — avoid heavier weights, keep the enterprise-clean tone.

## Spacing Scale

4px base unit: `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-6: 24px`, `--space-8: 32px`, `--space-12: 48px`.

- Table row padding: `--space-3` vertical, `--space-4` horizontal.
- Card/panel padding: `--space-6`.
- Section spacing: `--space-8` between major page sections.

## Components (conventions, not a full library)

- **Approach:** plain Tailwind utility classes mapped to the tokens above, or a minimal component set (e.g., shadcn/ui) — proportionate to a 2-week solo build, not a full custom design system.
- **Charting:** Recharts, using the semantic color tokens above for any risk/decision breakdowns.
- **Tables:** sortable, filterable by default for the Review Queue and Dashboard (`specs/05-review-queue-ui.md`, `specs/06-dashboard-ui.md`) — density over whitespace.

## Change Process

If a component needs a token that isn't defined here, don't invent one silently. Add it to this file with a one-line rationale, or flag it back for a real decision if it's a bigger call (e.g., adopting a full component library). See `skills/design-system/SKILL.md` for the enforcement process.
