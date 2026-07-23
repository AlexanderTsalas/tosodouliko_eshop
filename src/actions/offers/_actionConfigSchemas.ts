import { z } from "zod";
import type { RuleActionKind } from "@/types/offers";

/**
 * Per-kind Zod schemas for rule_actions.config. Mirror of
 * _conditionConfigSchemas.ts.
 *
 * Adding a new action kind:
 *   1. Add a Zod schema here
 *   2. Add a variant to RuleAction in src/types/offers.ts
 *   3. Add the kind to the enum in createRuleAction/updateRuleAction
 *   4. Add a dispatch case in the engine's evaluateAction()
 *   5. Update the DB CHECK constraint in a migration
 *   6. Add a UI form section
 */
export const ACTION_CONFIG_SCHEMAS: Record<RuleActionKind, z.ZodTypeAny> = {
  price_discount: z.object({
    mode: z.enum(["percent", "flat"]),
    value: z.number().nonnegative(),
  }),

  product_bundle: z.object({
    trigger_scope_kind: z.enum(["product", "variant", "category"]),
    trigger_scope_id: z.string().uuid().nullable(),
    trigger_quantity: z.number().int().positive(),
    reward_scope_kind: z.enum(["product", "variant", "category"]),
    reward_scope_id: z.string().uuid().nullable(),
    reward_quantity: z.number().int().positive(),
    reward_discount: z.number().min(0).max(1),
    max_applications_per_cart: z.number().int().positive().nullable(),
  }),

  service_cost_exception: z.object({
    fee_kind: z.enum(["delivery", "cod", "all"]),
    threshold: z
      .union([
        z.null(),
        z.object({
          kind: z.enum(["cart_total", "products_total"]),
          value: z.number().nonnegative(),
        }),
      ])
      .default(null),
    waive_customer_charge: z.boolean().default(true),
  }),
};
