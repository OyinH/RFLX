import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Minimal HTTP Basic Auth gate for the reviewer-facing surfaces
 * (/review-queue, /dashboard) — skills/security-foundation/SKILL.md's
 * private-data-access-control check found these pages readable/writable by
 * anyone with the deployed URL: Supabase RLS is bypassed entirely by the
 * service-role client both routes use (lib/supabase/server.ts), and there
 * was no app-layer check at all. Deliberately NOT a full auth system — that's
 * out of docs/rflx_PRD.md's MVP scope, per specs/05-review-queue-ui.md's own
 * note — just one shared credential from env vars, matching CLAUDE.md's
 * fail-closed-not-open principle: an unconfigured gate blocks access rather
 * than silently letting every request through.
 *
 * /api/agent/action-request is deliberately NOT behind this gate — it's
 * meant to be called by any AI agent per the PRD's agent-agnostic design,
 * not a reviewer-only surface.
 */
export function middleware(request: NextRequest): NextResponse {
  const user = process.env.REVIEWER_BASIC_AUTH_USER;
  const password = process.env.REVIEWER_BASIC_AUTH_PASSWORD;

  if (!user || !password) {
    return new NextResponse(
      "Reviewer auth is not configured (REVIEWER_BASIC_AUTH_USER / REVIEWER_BASIC_AUTH_PASSWORD unset).",
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    // Edge runtime — no Buffer, atob is the Web-standard equivalent.
    const decoded = atob(authHeader.slice("Basic ".length));
    const separatorIndex = decoded.indexOf(":");
    const suppliedUser = separatorIndex === -1 ? decoded : decoded.slice(0, separatorIndex);
    const suppliedPassword = separatorIndex === -1 ? "" : decoded.slice(separatorIndex + 1);
    if (suppliedUser === user && suppliedPassword === password) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="rflx reviewer access"' },
  });
}

export const config = {
  matcher: ["/review-queue/:path*", "/dashboard/:path*"],
};
