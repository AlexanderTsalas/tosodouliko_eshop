"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

/**
 * Deletes an association. FK cascade tears down:
 *   - filter_groups (and their conditions)
 *   - manual_picks
 *
 * Hard delete — nothing references associations from elsewhere in the
 * system (the storefront resolver reads at request time, no fk-back).
 */
export async function deleteRelatedProductsAssociation(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ id: string }>("Not authenticated", "UNAUTHENTICATED");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("related_products_associations")
    .delete()
    .eq("id", parsed.data.id);

  if (error) {
    return fail<{ id: string }>(
      "Failed to delete association: " + error.message,
      error.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "related_products_association.deleted",
    resource_type: "related_products_association",
    resource_id: parsed.data.id,
    metadata: {},
  });

  revalidatePath("/admin/related-products");
  return ok({ id: parsed.data.id });
}
