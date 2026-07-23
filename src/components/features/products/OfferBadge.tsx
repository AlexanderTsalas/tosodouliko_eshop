import type { OfferRuleSummary } from "@/lib/site-search/searchVariants";

/**
 * Visual badge for an auto-apply offer applied to a variant.
 *
 * Maps the rule's action kind + sub-mode → Greek label + color token.
 * Available-quantity-conditioned rules override to a "ΤΕΛΕΥΤΑΙΑ
 * ΤΕΜΑΧΙΑ" urgency badge regardless of the underlying action.
 *
 * Used on:
 *   - Catalog tile (next to the crossed-out price)
 *   - Product detail page (next to the dynamic price label)
 */
export default function OfferBadge({
  rule,
  size = "md",
}: {
  rule: OfferRuleSummary;
  size?: "sm" | "md";
}) {
  const { label, token } = badgeContent(rule);
  if (label === null) return null;

  const sizeClasses =
    size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1";

  return (
    <span
      className={`inline-flex items-center font-semibold uppercase tracking-wide rounded ${sizeClasses}`}
      style={{
        backgroundColor: `hsl(var(--badge-${token}))`,
        color: `hsl(var(--badge-${token}-text))`,
      }}
    >
      {label}
    </span>
  );
}

interface BadgeContent {
  label: string | null;
  token: "discount" | "bundle" | "shipping" | "cod" | "low-stock";
}

function badgeContent(rule: OfferRuleSummary): BadgeContent {
  if (rule.has_available_quantity_condition) {
    return { label: "ΤΕΛΕΥΤΑΙΑ ΤΕΜΑΧΙΑ", token: "low-stock" };
  }

  switch (rule.kind) {
    case "price_discount":
      if (rule.action_value === null) {
        return { label: null, token: "discount" };
      }
      if (rule.action_mode === "percent") {
        return {
          label: `−${Math.round(rule.action_value * 100)}%`,
          token: "discount",
        };
      }
      return {
        label: `−€${rule.action_value.toFixed(
          rule.action_value % 1 === 0 ? 0 : 2
        )}`,
        token: "discount",
      };
    case "product_bundle":
      return { label: "ΠΡΟΣΦΟΡΑ ΠΑΚΕΤΟΥ", token: "bundle" };
    case "service_cost_exception":
      if (rule.action_fee_kind === "delivery") {
        return { label: "ΔΩΡΕΑΝ ΑΠΟΣΤΟΛΗ", token: "shipping" };
      }
      if (rule.action_fee_kind === "cod") {
        return { label: "ΧΩΡΙΣ ΕΞΟΔΑ ΑΝΤΙΚΑΤ.", token: "cod" };
      }
      return { label: "ΧΩΡΙΣ ΕΞΟΔΑ", token: "shipping" };
  }
}
