"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

export async function removeManualPick(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("related_products_manual_picks")
    .delete()
    .eq("id", parsed.data.id);

  if (error) {
    return fail<{ id: string }>(
      "Failed to remove pick: " + error.message,
      error.code
    );
  }

  revalidatePath("/admin/related-products");
  return ok({ id: parsed.data.id });
}
