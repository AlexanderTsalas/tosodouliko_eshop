"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";
import { resolveProductIds } from "@/lib/bulk-selection/resolveProductIds";
import { FilterParamsSchema } from "@/lib/admin-products-filter/schema";

const Schema = z.object({
  ids: z.array(z.string().uuid()).nullable(),
  matchAll: z.boolean(),
  filterParams: FilterParamsSchema,
  active: z.boolean(),
});

export async function bulkSetActive(
  input: z.input<typeof Schema>
): Promise<Result<{ affected: number }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ affected: number }>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:products"))) {
    return fail<{ affected: number }>("Forbidden", "FORBIDDEN");
  }

  const resolved = await resolveProductIds({
    ids: parsed.data.ids,
    matchAll: parsed.data.matchAll,
    filterParams: parsed.data.filterParams,
  });
  if (!resolved.ok) return fail<{ affected: number }>(resolved.error, resolved.code);
  if (resolved.ids.length === 0) return ok({ affected: 0 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("products")
    .update({ active: parsed.data.active, updated_at: new Date().toISOString() })
    .in("id", resolved.ids);
  if (error) return fail<{ affected: number }>(error.message, error.code);

  // Audit log — one event with the full id list.
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "product.bulk_set_active",
      resource_type: "product",
      metadata: { active: parsed.data.active, ids: resolved.ids },
    });
  }

  revalidatePath("/admin/products");
  revalidatePath("/sitemap.xml");
  revalidatePath("/products");
  return ok({ affected: resolved.ids.length });
}
