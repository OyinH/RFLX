"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";

const LINKS = [
  { href: "/review-queue", label: "Review Queue" },
  { href: "/incidents", label: "Incidents" },
  { href: "/dashboard", label: "Dashboard" },
];

/**
 * Shared across every page via app/layout.tsx — the only way to move between
 * the landing page, review queue, and dashboard was a manually-typed URL
 * before this existed, and there was no visible way back from an internal
 * page either. Tab-style active state (bottom border, not just a color
 * swap) so the current page and the way back to "/" are both unmistakable
 * at a glance, not just technically present. Client component (usePathname
 * for the active-link state) but stays a thin leaf — doesn't force the rest
 * of the tree client-side.
 */
export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface shadow-sm">
      <nav aria-label="Primary" className="mx-auto flex max-w-6xl items-center gap-8 px-6">
        <Link href="/" className="flex items-center gap-2.5 py-4 transition-opacity hover:opacity-80">
          <Logo size={30} />
          <span className="font-logo text-xl font-bold tracking-tight">
            <span className="text-text-primary">rflx</span>
            <span className="text-primary">.ai</span>
          </span>
        </Link>
        <div className="flex gap-6">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "border-b-2 border-primary py-4 text-sm font-semibold text-primary"
                    : "border-b-2 border-transparent py-4 text-sm font-medium text-text-secondary transition-colors hover:border-border hover:text-text-primary"
                }
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
