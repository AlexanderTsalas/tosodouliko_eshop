"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { ShippingZone } from "@/types/shipping";

const Schema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50),
  countryCodes: z.array(z.string().length(2)).min(1),
  active: z.boolean().default(true),
});

export async function createShippingZone(
  input: z.input<typeof Schema>
): Promise<Result<ShippingZone>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<ShippingZone>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:shipping"))) {
    return fail<ShippingZone>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipping_zones")
    .insert({
      name: parsed.data.name,
      code: parsed.data.code.toUpperCase(),
      country_codes: parsed.data.countryCodes.map((c) => c.toUpperCase()),
      active: parsed.data.active ?? true,
    })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<ShippingZone>("Zone code already exists", "DUPLICATE");
    return fail<ShippingZone>(error?.message ?? "Insert failed", error?.code);
  }

  revalidatePath("/admin/shipping");
  return ok(data as unknown as ShippingZone);
}
