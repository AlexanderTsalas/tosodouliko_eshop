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
 * Delete a fee category. Refuses on `is_system=true` rows (shipping,
 * cod_handling) — those are referenced by integration code through their
 * slugs and the schema integrity depends on them existing.
 *
 * All rules under the category cascade-delete via the FK.
 */
export async function deleteFeeCategory(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:fees"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<{ id: string }>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("fee_categories")
    .select("id, slug, is_system, label")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!row) return fail<{ id: string }>("Category not found", "NOT_FOUND");
  const cat = row as { id: string; slug: string; is_system: boolean; label: string };
  if (cat.is_system) {
    return fail<{ id: string }>(
      "Δεν διαγράφεται η κατηγορία συστήματος. Μπορείτε να την απενεργοποιήσετε αντί για διαγραφή.",
      "IS_SYSTEM"
    );
  }

  const { error } = await admin.from("fee_categories").delete().eq("id", parsed.data.id);
  if (error) return fail<{ id: string }>(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "fee_category.deleted",
    resource_type: "fee_category",
    resource_id: parsed.data.id,
    metadata: { slug: cat.slug, label: cat.label },
  });
  revalidatePath("/admin/settings/fees");
  return ok({ id: parsed.data.id });
}
