"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

export async function unlinkSupplierFromVariant(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // purchase_lots historically tied to this (variant, supplier) survive — the
  // FK there only references supplier_id directly, not supplier_products.id.
  // We just drop the relationship row; the cost history remains intact.
  const { error } = await supabase
    .from("supplier_products")
    .delete()
    .eq("id", parsed.data.id);

  if (error) return fail<{ id: string }>(error.message, error.code);

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supplier_product.unlinked",
      resource_type: "supplier_product",
      resource_id: parsed.data.id,
    });
  }

  revalidatePath(`/admin/products`);
  return ok({ id: parsed.data.id });
}
