"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

export async function deleteSupplier(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // The supply_orders FK uses ON DELETE RESTRICT, so the DB will refuse if
  // any orders reference this supplier. Surface that as a friendly message
  // instead of leaking the FK violation.
  const { count: orderCount } = await supabase
    .from("supply_orders")
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", parsed.data.id);
  if ((orderCount ?? 0) > 0) {
    return fail<{ id: string }>(
      `Cannot delete: supplier has ${orderCount} supply order(s) in history. Deactivate instead.`,
      "HAS_ORDERS"
    );
  }

  const { error } = await supabase.from("suppliers").delete().eq("id", parsed.data.id);
  if (error) return fail<{ id: string }>(error.message, error.code);

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supplier.deleted",
      resource_type: "supplier",
      resource_id: parsed.data.id,
    });
  }

  revalidatePath("/admin/suppliers");
  return ok({ id: parsed.data.id });
}
