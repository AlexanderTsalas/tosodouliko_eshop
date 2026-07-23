import type { RuleActionKind, RuleConditionKind } from "@/types/offers";

/** Greek labels for each action kind — client-safe. */
export const ACTION_KIND_LABELS: Record<RuleActionKind, string> = {
  price_discount: "Έκπτωση τιμής",
  product_bundle: "Δέσμη προϊόντων",
  service_cost_exception: "Εξαίρεση εξόδων υπηρεσίας",
};

/**
 * Greek labels for each condition kind — safe for client-component
 * import (no Zod, no server-only deps).
 *
 * Adding a new kind: also add a label here.
 */
export const CONDITION_KIND_LABELS: Record<RuleConditionKind, string> = {
  timeframe: "Χρονικό πλαίσιο",
  user_type: "Τύπος χρήστη",
  min_subtotal: "Ελάχιστο υποσύνολο",
  min_item_count: "Ελάχιστος αριθμός προϊόντων",
  available_quantity: "Διαθέσιμη ποσότητα",
};

export const ALL_CONDITION_KINDS: RuleConditionKind[] = [
  "timeframe",
  "user_type",
  "min_subtotal",
  "min_item_count",
  "available_quantity",
];
