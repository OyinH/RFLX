import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Service-role Supabase client for standalone scripts (scripts/mock-agent,
 * eval/) — plain Node execution via tsx, outside Next.js's bundler.
 * Deliberately does NOT import "server-only" (see scripts/lib/openai-client.ts
 * for why); this file must never be imported from anything under app/ or
 * lib/ that a Client Component could reach — lib/supabase/server.ts is the
 * guarded Next.js-app equivalent used there.
 */
export function createServiceRoleClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
