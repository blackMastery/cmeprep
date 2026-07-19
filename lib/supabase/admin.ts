import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Service-role client. BYPASSES ROW LEVEL SECURITY.
 *
 * Only ever import this inside Route Handlers, and only after you have
 * independently verified the caller's identity/role via the request-scoped
 * server client. Never import it from a shared lib that a Client Component
 * could pull in — `server-only` makes that a build error.
 *
 * This is the only place allowed to read `question_options.is_correct`.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) {
    throw new Error("SUPABASE_SECRET_KEY is not set");
  }

  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
