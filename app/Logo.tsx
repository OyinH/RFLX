/**
 * Brand mark — a contained pulse/signal line, reusing the same EKG-style
 * path motif as the landing page's "Clinical Risk Classification" feature
 * icon (app/page.tsx) for visual cohesion rather than introducing an
 * unrelated icon. Reads as "a signal being watched/contained" — fitting
 * for guardrail middleware — without resorting to a literal shield glyph.
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--color-primary)" />
      <path
        d="M7 17h4l2-7 4 14 2-7h6"
        stroke="#ffffff"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
