"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

export async function removeProductSpec(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string; product_id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ id: string; product_id: string }>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<{ id: string; product_id: string }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  const { data: row } = await supabase
    .from("product_specifications")
    .select("product_id")
    .eq("id", parsed.data.id)
    .maybeSingle();
  const productId = (row as { product_id: string } | null)?.product_id;

  const { error } = await supabase
    .from("product_specifications")
    .delete()
    .eq("id", parsed.data.id);
  if (error) {
    return fail<{ id: string; product_id: string }>(error.message, error.code);
  }

  if (authData.user && productId) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "product_spec.removed",
      resource_type: "product",
      resource_id: productId,
    });
  }

  if (productId) {
    revalidatePath("/admin/products");
  }
  revalidatePath("/products");
  return ok({ id: parsed.data.id, product_id: productId ?? "" });
}
