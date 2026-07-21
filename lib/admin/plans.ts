import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Plan } from "@/lib/supabase/types";

/** Every plan, inactive included — the /admin/plans manager's view. */
export async function listAllPlans(): Promise<Plan[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("plans")
    .select("*")
    .order("position")
    .order("name");
  return (data ?? []) as Plan[];
}
