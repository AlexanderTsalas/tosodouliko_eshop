"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { DiscountCode } from "@/types/discount-engine";

const Schema = z.object({
  id: z.string().uuid(),
  code: z.string().min(1).max(64).optional(),
  type: z.enum(["percent", "fixed", "free_shipping"]).optional(),
  value: z.number().nonnegative().optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function updateDiscountCode(
  input: z.input<typeof Schema>
): Promise<Result<DiscountCode>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<DiscountCode>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:discounts"))) {
    return fail<DiscountCode>("Forbidden", "FORBIDDEN");
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.code !== undefined) update.code = parsed.data.code.toUpperCase();
  if (parsed.data.type !== undefined) update.type = parsed.data.type;
  if (parsed.data.value !== undefined) update.value = parsed.data.value;
  if (parsed.data.usageLimit !== undefined) update.usage_limit = parsed.data.usageLimit;
  if (parsed.data.expiresAt !== undefined) update.expires_at = parsed.data.expiresAt;
  if (parsed.data.isActive !== undefined) update.is_active = parsed.data.isActive;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discount_codes")
    .update(update)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<DiscountCode>("Code already exists", "DUPLICATE");
    return fail<DiscountCode>(error?.message ?? "Update failed", error?.code);
  }

  revalidatePath("/admin/discounts");
  return ok(data as unknown as DiscountCode);
}
