import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Service-role client — full read/write access, server-only. The `server-only`
 * import makes this a build error if ever pulled into a client bundle, which
 * is the concrete enforcement of CLAUDE.md's "never expose ... Supabase
 * service-role keys to the client bundle" rule.
 *
 * Don't reach for this directly from a view — use the scoped helpers in
 * ./queries.ts, which only expose what each planned view actually needs.
 */
export function createServiceRoleClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
