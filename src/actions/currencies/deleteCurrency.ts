"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import { CACHE_TAGS } from "@/lib/cache-tags";

const Schema = z.object({ code: z.string().length(3) });

export async function deleteCurrency(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid code", "INVALID_INPUT");
  if (!(await checkPermission("manage:currencies"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("currencies")
    .delete()
    .eq("code", parsed.data.code.toUpperCase());

  if (error) {
    if (error.code === "23503") {
      return fail<null>(
        "Currency in use by products/orders — deactivate instead of deleting.",
        "FK_VIOLATION"
      );
    }
    return fail<null>(error.message, error.code);
  }

  revalidatePath("/admin/currencies");
  updateTag(CACHE_TAGS.CURRENCIES);
  return ok(null);
}
