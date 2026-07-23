"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

export async function deleteAttributeValue(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:attributes"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();

  // Refuse if any product variant still references this attribute_value.
  // Phase 9: the check pushes into Postgres via attribute_value_in_use
  // (jsonb_each_text + EXISTS) — short-circuits on the first match,
  // and avoids transferring every variant's attribute_combo to Node
  // for an in-JS scan. At scale (~5k+ variants) this drops the check
  // from ~500ms to ~20ms.
  const { data: inUse, error: checkErr } = await admin.rpc(
    "attribute_value_in_use" as never,
    { p_value_id: parsed.data.id } as never
  );
  if (checkErr) {
    return fail<null>(`In-use check failed: ${checkErr.message}`, checkErr.code);
  }
  if (inUse === true) {
    return fail<null>(
      "Cannot delete: at least one product variant uses this value. Remove it from variants first.",
      "VALUE_IN_USE"
    );
  }

  const { error } = await admin
    .from("attribute_values")
    .delete()
    .eq("id", parsed.data.id);
  if (error) return fail<null>(error.message, error.code);

  revalidatePath("/admin/attributes");
  updateTag("catalog-facets");
  return ok(null);
}
