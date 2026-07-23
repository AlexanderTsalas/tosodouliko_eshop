"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

/**
 * Marks the given collapse_notifications rows as acknowledged for the
 * calling customer. RLS ensures the customer can only flip their own
 * rows. Idempotent — re-acknowledging an already-acknowledged row is a
 * no-op (the UPDATE simply matches zero rows under the RLS filter).
 */
export async function acknowledgeCollapseNotifications(
  input: z.input<typeof Schema>
): Promise<Result<{ acknowledged: number }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ acknowledged: number }>("Invalid input", "INVALID_INPUT");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ acknowledged: number }>("Not authenticated", "UNAUTHENTICATED");
  }

  const { data, error } = await supabase
    .from("collapse_notifications")
    .update({ acknowledged_at: new Date().toISOString() })
    .in("id", parsed.data.ids)
    .is("acknowledged_at", null)
    .select("id");
  if (error) {
    return fail<{ acknowledged: number }>(error.message, error.code);
  }
  return ok({ acknowledged: (data ?? []).length });
}
