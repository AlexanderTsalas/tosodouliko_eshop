"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

/**
 * Deletes a category. The schema sets ON DELETE SET NULL for parent_id, so
 * children become roots; product_categories rows cascade.
 */
export async function deleteCategory(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:categories"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("categories").delete().eq("id", parsed.data.id);
  if (error) return fail<null>(error.message, error.code);

  revalidatePath("/admin/categories");
  updateTag("categories");
  return ok(null);
}
