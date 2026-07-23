"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { MAX_BULK_OPERATION } from "@/lib/bulk-selection/selectionUrl";
import { fail, ok, type Result } from "@/types/result";

/**
 * Bulk-assign a custom field OR group to many products at the product
 * scope. Idempotent "add or override": products that lack the binding
 * get one created; products that already have it get their
 * `override_required` updated. Used by the panel's bulk-edit mode.
 */
export async function bulkAssignCustomField(input: {
  productIds: string[];
  fieldId?: string | null;
  groupId?: string | null;
  /** null = inherit field default, true = required, false = optional. */
  overrideRequired: boolean | null;
}): Promise<Result<{ created: number; updated: number }>> {
  if (!(await checkPermission("manage:products"))) {
    return fail<{ created: number; updated: number }>("Forbidden", "FORBIDDEN");
  }
  const fieldId = input.fieldId ?? null;
  const groupId = input.groupId ?? null;
  if ((!fieldId && !groupId) || (fieldId && groupId)) {
    return fail<{ created: number; updated: number }>(
      "Επιλέξτε ακριβώς ένα πεδίο ή μία ομάδα.",
      "INVALID_INPUT"
    );
  }
  if (
    input.productIds.length === 0 ||
    input.productIds.length > MAX_BULK_OPERATION
  ) {
    return fail<{ created: number; updated: number }>(
      `Η επιλογή πρέπει να είναι 1–${MAX_BULK_OPERATION} προϊόντα.`,
      "OVER_CAP"
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ created: number; updated: number }>(
      "Not authenticated",
      "UNAUTHENTICATED"
    );
  }
  const admin = createAdminClient();

  // Which of the selected products already have this binding at product scope?
  let existingQuery = admin
    .from("custom_field_bindings")
    .select("id, scope_resource_id")
    .eq("scope_kind", "product")
    .in("scope_resource_id", input.productIds);
  existingQuery = fieldId
    ? existingQuery.eq("field_id", fieldId)
    : existingQuery.eq("group_id", groupId as string);
  const { data: existing, error: existingErr } = await existingQuery;
  if (existingErr) {
    return fail<{ created: number; updated: number }>(
      existingErr.message,
      existingErr.code
    );
  }

  const existingByProduct = new Map<string, string>();
  for (const r of (existing ?? []) as Array<{
    id: string;
    scope_resource_id: string;
  }>) {
    existingByProduct.set(r.scope_resource_id, r.id);
  }

  const toInsert = input.productIds.filter((pid) => !existingByProduct.has(pid));
  const toUpdateIds = input.productIds
    .filter((pid) => existingByProduct.has(pid))
    .map((pid) => existingByProduct.get(pid)!);

  if (toInsert.length > 0) {
    const rows = toInsert.map((pid) => ({
      field_id: fieldId,
      group_id: groupId,
      scope_kind: "product",
      scope_resource_id: pid,
      active: true,
      override_required: input.overrideRequired,
      created_by: authData.user!.id,
    }));
    const { error } = await admin.from("custom_field_bindings").insert(rows);
    if (error) {
      return fail<{ created: number; updated: number }>(
        "Η δημιουργία συνδέσεων απέτυχε: " + error.message,
        error.code
      );
    }
  }

  if (toUpdateIds.length > 0) {
    const { error } = await admin
      .from("custom_field_bindings")
      .update({ override_required: input.overrideRequired, active: true })
      .in("id", toUpdateIds);
    if (error) {
      return fail<{ created: number; updated: number }>(
        "Η ενημέρωση συνδέσεων απέτυχε: " + error.message,
        error.code
      );
    }
  }

  revalidatePath("/admin/custom-fields");
  return ok({ created: toInsert.length, updated: toUpdateIds.length });
}
