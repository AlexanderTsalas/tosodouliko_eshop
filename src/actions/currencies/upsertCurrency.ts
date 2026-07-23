"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import { CACHE_TAGS } from "@/lib/cache-tags";
import type { Currency } from "@/types/multi-currency";

const Schema = z.object({
  code: z.string().length(3),
  name: z.string().min(1).max(100),
  symbol: z.string().min(1).max(10),
  exchangeRate: z.number().positive(),
  decimalDigits: z.number().int().min(0).max(8).default(2),
  active: z.boolean().default(true),
});

/**
 * Upsert by currency code. Used both to add a new currency and to update an
 * existing one's exchange rate / activation. Code is the PK so this is a clean
 * single-row upsert.
 */
export async function upsertCurrency(
  input: z.input<typeof Schema>
): Promise<Result<Currency>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<Currency>("Invalid input: " + parsed.error.issues[0].message, "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:currencies"))) {
    return fail<Currency>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("currencies")
    .upsert(
      {
        code: parsed.data.code.toUpperCase(),
        name: parsed.data.name,
        symbol: parsed.data.symbol,
        exchange_rate: parsed.data.exchangeRate,
        decimal_digits: parsed.data.decimalDigits ?? 2,
        active: parsed.data.active ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "code" }
    )
    .select()
    .single();

  if (error || !data) return fail<Currency>(error?.message ?? "Upsert failed", error?.code);
  revalidatePath("/admin/currencies");
  updateTag(CACHE_TAGS.CURRENCIES);
  return ok(data as unknown as Currency);
}
