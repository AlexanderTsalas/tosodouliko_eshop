import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";
import type { ValidatedDiscount } from "@/types/discount-engine";

/**
 * Verify a discount code: must exist, be active, not expired, and not over its
 * usage limit. Calculates the amount-off for a given subtotal.
 *
 * Pure read; does NOT increment usage_count — that's the caller's job after
 * successful application.
 */
export async function validateDiscount(
  code: string,
  subtotal: number
): Promise<Result<ValidatedDiscount>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discount_codes")
    .select("*")
    .eq("code", code)
    .eq("is_active", true)
    .maybeSingle();

  if (error) return fail<ValidatedDiscount>(error.message, error.code);
  if (!data) return fail<ValidatedDiscount>("Invalid code", "INVALID_CODE");

  const row = data as any;
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return fail<ValidatedDiscount>("Code expired", "EXPIRED");
  }
  if (row.usage_limit !== null && row.usage_count >= row.usage_limit) {
    return fail<ValidatedDiscount>("Code at usage limit", "LIMIT_REACHED");
  }

  const value = Number(row.value);
  let amountOff = 0;
  let freeShipping = false;

  if (row.type === "percent") {
    amountOff = Math.round(subtotal * (value / 100) * 100) / 100;
  } else if (row.type === "fixed") {
    amountOff = Math.min(subtotal, value);
  } else if (row.type === "free_shipping") {
    freeShipping = true;
  }

  return ok({ code: row, amountOff, freeShipping });
}
