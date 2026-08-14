import type { Config } from "tailwindcss";

// Colors and font sizes are wired to the CSS custom properties defined in
// app/globals.css, which mirror docs/design.md's tokens exactly. Components
// should always use these utilities (e.g. `bg-risk-high`) rather than inline
// hex values, per CLAUDE.md's naming conventions.
//
// Spacing is intentionally left at Tailwind's default scale: 1/2/3/4/6/8/12
// already equal docs/design.md's --space-* values (4/8/12/16/24/32/48px) exactly.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        border: "var(--color-border)",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        primary: {
          DEFAULT: "var(--color-primary)",
          hover: "var(--color-primary-hover)",
        },
        "risk-low": "var(--color-risk-low)",
        "risk-medium": "var(--color-risk-medium)",
        "risk-high": "var(--color-risk-high)",
        "risk-critical": "var(--color-risk-critical)",
        "decision-approve": "var(--color-decision-approve)",
        "decision-escalate": "var(--color-decision-escalate)",
        "decision-block": "var(--color-decision-block)",
      },
      fontSize: {
        xs: "var(--text-xs)",
        sm: "var(--text-sm)",
        base: "var(--text-base)",
        lg: "var(--text-lg)",
        xl: "var(--text-xl)",
        "2xl": "var(--text-2xl)",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "sans-serif"],
        // Wordmark only (app/NavBar.tsx) — never used for body/UI text. See
        // app/layout.tsx's Space_Grotesk setup for why this exists.
        logo: ["var(--font-logo)", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
