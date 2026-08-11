import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

/**
 * Browser-safe client — anon key only, never the service-role key.
 * For any reviewer-facing read/write, pair with the Supabase Row Level
 * Security policies described in specs/01-database-schema.md's Access
 * Control section; don't rely on this client's access being pre-scoped.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
