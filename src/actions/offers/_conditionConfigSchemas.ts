import { z } from "zod";
import type { RuleConditionKind } from "@/types/offers";

/**
 * Per-kind Zod schemas for rule_conditions.config. Shared between
 * createRuleCondition + updateRuleCondition.
 *
 * Adding a new condition kind:
 *   1. Add a Zod schema here
 *   2. Add a variant to RuleCondition in src/types/offers.ts
 *   3. Add the kind to the enum in createRuleCondition's Schema
 *   4. Add an evaluator in src/lib/offers/conditionEvaluators.ts
 *   5. Update the DB CHECK constraint in a migration
 *   6. Add a UI form section in OffersWorkspace
 */
export const CONFIG_SCHEMAS: Record<RuleConditionKind, z.ZodTypeAny> = {
  timeframe: z
    .object({
      starts_at: z.string().datetime().nullable().optional(),
      ends_at: z.string().datetime().nullable().optional(),
    })
    .refine(
      (v) =>
        !v.starts_at ||
        !v.ends_at ||
        new Date(v.ends_at) > new Date(v.starts_at),
      { message: "ends_at must be after starts_at" }
    ),

  user_type: z.discriminatedUnion("value", [
    z.object({ value: z.literal("guest") }),
    z.object({ value: z.literal("authenticated") }),
    z.object({
      value: z.literal("individual"),
      customer_id: z.string().uuid().nullable(),
    }),
  ]),

  min_subtotal: z.object({
    threshold: z.number().nonnegative(),
  }),

  min_item_count: z.object({
    threshold: z.number().int().positive(),
  }),

  available_quantity: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("range"),
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative().nullable(),
      scope_kind: z.enum(["variant", "product"]),
      scope_id: z.string().uuid().nullable(),
    }),
    z.object({
      mode: z.literal("until_oos"),
      scope_kind: z.enum(["variant", "product"]),
      scope_id: z.string().uuid().nullable(),
    }),
  ]),
};

/**
 * Human-readable Greek labels for each kind — used in the admin UI
 * picker + condition card headers. Keeping the labels alongside the
 * schemas means adding a kind touches one file.
 */
export const CONDITION_KIND_LABELS: Record<RuleConditionKind, string> = {
  timeframe: "Χρονικό πλαίσιο",
  user_type: "Τύπος χρήστη",
  min_subtotal: "Ελάχιστο υποσύνολο",
  min_item_count: "Ελάχιστος αριθμός προϊόντων",
  available_quantity: "Διαθέσιμη ποσότητα",
};
