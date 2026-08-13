"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/review-queue", label: "Review Queue" },
  { href: "/dashboard", label: "Dashboard" },
];

/**
 * Shared across every page via app/layout.tsx — the only way to move between
 * the landing page, review queue, and dashboard was a manually-typed URL
 * before this existed. Client component (usePathname for the active-link
 * state) but stays a thin leaf — doesn't force the rest of the tree client-side.
 */
export function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <Link href="/" className="text-sm font-semibold text-text-primary">
          rflx.ai
        </Link>
        <div className="flex gap-4">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  active
                    ? "text-sm font-medium text-primary"
                    : "text-sm font-medium text-text-secondary hover:text-text-primary"
                }
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
