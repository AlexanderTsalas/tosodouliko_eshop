"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

export async function deleteShippingZone(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:shipping"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("shipping_zones").delete().eq("id", parsed.data.id);
  if (error) return fail<null>(error.message, error.code);
  revalidatePath("/admin/shipping");
  return ok(null);
}
