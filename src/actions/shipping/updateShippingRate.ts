"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { ShippingRate } from "@/types/shipping";

const Schema = z.object({
  id: z.string().uuid(),
  carrier: z.string().min(1).max(100).optional(),
  zone: z.string().min(1).max(50).optional(),
  zoneId: z.string().uuid().nullable().optional(),
  minWeightG: z.number().int().nonnegative().optional(),
  maxWeightG: z.number().int().nonnegative().nullable().optional(),
  minOrderAmount: z.number().nonnegative().nullable().optional(),
  rate: z.number().nonnegative().optional(),
  freeAbove: z.number().nonnegative().nullable().optional(),
  active: z.boolean().optional(),
});

export async function updateShippingRate(
  input: z.input<typeof Schema>
): Promise<Result<ShippingRate>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<ShippingRate>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:shipping"))) {
    return fail<ShippingRate>("Forbidden", "FORBIDDEN");
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.carrier !== undefined) update.carrier = parsed.data.carrier;
  if (parsed.data.zone !== undefined) update.zone = parsed.data.zone;
  if (parsed.data.zoneId !== undefined) update.zone_id = parsed.data.zoneId;
  if (parsed.data.minWeightG !== undefined) update.min_weight_g = parsed.data.minWeightG;
  if (parsed.data.maxWeightG !== undefined) update.max_weight_g = parsed.data.maxWeightG;
  if (parsed.data.minOrderAmount !== undefined) update.min_order_amount = parsed.data.minOrderAmount;
  if (parsed.data.rate !== undefined) update.rate = parsed.data.rate;
  if (parsed.data.freeAbove !== undefined) update.free_above = parsed.data.freeAbove;
  if (parsed.data.active !== undefined) update.active = parsed.data.active;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipping_rates")
    .update(update)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !data) return fail<ShippingRate>(error?.message ?? "Update failed", error?.code);
  revalidatePath("/admin/shipping");
  return ok(data as unknown as ShippingRate);
}
