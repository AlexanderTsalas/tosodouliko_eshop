"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { ShippingZone } from "@/types/shipping";

const Schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(50).optional(),
  countryCodes: z.array(z.string().length(2)).optional(),
  active: z.boolean().optional(),
});

export async function updateShippingZone(
  input: z.input<typeof Schema>
): Promise<Result<ShippingZone>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<ShippingZone>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:shipping"))) {
    return fail<ShippingZone>("Forbidden", "FORBIDDEN");
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.code !== undefined) update.code = parsed.data.code.toUpperCase();
  if (parsed.data.countryCodes !== undefined) update.country_codes = parsed.data.countryCodes.map((c) => c.toUpperCase());
  if (parsed.data.active !== undefined) update.active = parsed.data.active;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipping_zones")
    .update(update)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<ShippingZone>("Zone code already exists", "DUPLICATE");
    return fail<ShippingZone>(error?.message ?? "Update failed", error?.code);
  }
  revalidatePath("/admin/shipping");
  return ok(data as unknown as ShippingZone);
}
