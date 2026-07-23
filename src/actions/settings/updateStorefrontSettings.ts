"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  showWhenOosDefault: z.boolean().optional(),
});

/**
 * Update the singleton storefront_settings row. The row is created by the
 * 20260531000005 migration with id = 1, so an upsert is functionally an
 * update — we still upsert to be resilient.
 */
export async function updateStorefrontSettings(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");

  if (!(await checkPermission("manage:settings"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.showWhenOosDefault !== undefined) {
    updates.show_when_oos_default = parsed.data.showWhenOosDefault;
  }

  if (Object.keys(updates).length === 1) {
    // Only updated_at — nothing actually changed.
    return ok(null);
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("storefront_settings")
    .upsert({ id: 1, ...updates });

  if (error) return fail<null>(error.message, error.code);

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "storefront_settings.updated",
      resource_type: "storefront_settings",
      resource_id: "1",
      metadata: updates,
    });
  }

  revalidatePath("/admin/settings/storefront");
  // Storefront pages depend on this setting — invalidate broadly.
  revalidatePath("/products");
  revalidatePath("/sitemap.xml");
  return ok(null);
}
