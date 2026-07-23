"use server";

import { z } from "zod";
import { evaluateOffersForCart } from "@/lib/offers";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { EvalResult } from "@/types/offers";

const Schema = z.object({
  lines: z
    .array(
      z.object({
        variant_id: z.string().uuid(),
        product_id: z.string().uuid(),
        category_ids: z.array(z.string().uuid()),
        quantity: z.number().int().positive(),
        unit_price: z.number().nonnegative(),
      })
    )
    .min(1),
  subtotal: z.number().nonnegative(),
  itemCount: z.number().int().positive(),
  customerId: z.string().uuid().nullable(),
  isAuthenticated: z.boolean(),
  codes: z.array(z.string()),
  evaluationTime: z.string().datetime(),
});

/**
 * Runs the offers engine against a mock cart and returns the full
 * EvalResult. Used by the live-preview drawer in the rule editor so
 * admins can verify "does this rule actually fire?" without leaving
 * the page or making a real order.
 *
 * IMPORTANT: this is a READ-ONLY operation — it never writes to the
 * database. Usage counters and audit rows are NOT bumped.
 *
 * Inventory: the engine accepts an inventoryByVariant map; in preview
 * mode we pass an empty map (no real stock data), so
 * available_quantity conditions will fail unless explicitly tested
 * against a real variant. Phase 3b can lift this restriction by
 * accepting per-variant stock overrides.
 */
export async function previewEvaluation(
  input: z.input<typeof Schema>
): Promise<Result<EvalResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<EvalResult>(
      "Invalid input: " + parsed.error.message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:discounts"))) {
    return fail<EvalResult>("Forbidden", "FORBIDDEN");
  }

  try {
    const result = await evaluateOffersForCart({
      lines: parsed.data.lines,
      subtotal: parsed.data.subtotal,
      itemCount: parsed.data.itemCount,
      customerId: parsed.data.customerId,
      isAuthenticated: parsed.data.isAuthenticated,
      codes: parsed.data.codes,
      evaluationTime: new Date(parsed.data.evaluationTime),
      currency: "EUR",
      inventoryByVariant: new Map(),
    });
    return ok(result);
  } catch (e) {
    return fail<EvalResult>(
      "Engine error: " + (e instanceof Error ? e.message : String(e)),
      "ENGINE_ERROR"
    );
  }
}
