"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { ShippingRate } from "@/types/shipping";

const Schema = z.object({
  carrier: z.string().min(1).max(100),
  zone: z.string().min(1).max(50),
  zoneId: z.string().uuid().nullable().optional(),
  minWeightG: z.number().int().nonnegative().default(0),
  maxWeightG: z.number().int().nonnegative().nullable().optional(),
  minOrderAmount: z.number().nonnegative().nullable().optional(),
  rate: z.number().nonnegative(),
  freeAbove: z.number().nonnegative().nullable().optional(),
  active: z.boolean().default(true),
});

export async function createShippingRate(
  input: z.input<typeof Schema>
): Promise<Result<ShippingRate>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<ShippingRate>("Invalid input: " + parsed.error.issues[0].message, "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:shipping"))) {
    return fail<ShippingRate>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipping_rates")
    .insert({
      carrier: parsed.data.carrier,
      zone: parsed.data.zone,
      zone_id: parsed.data.zoneId ?? null,
      min_weight_g: parsed.data.minWeightG ?? 0,
      max_weight_g: parsed.data.maxWeightG ?? null,
      min_order_amount: parsed.data.minOrderAmount ?? null,
      rate: parsed.data.rate,
      free_above: parsed.data.freeAbove ?? null,
      active: parsed.data.active ?? true,
    })
    .select()
    .single();

  if (error || !data) return fail<ShippingRate>(error?.message ?? "Insert failed", error?.code);
  revalidatePath("/admin/shipping");
  return ok(data as unknown as ShippingRate);
}
