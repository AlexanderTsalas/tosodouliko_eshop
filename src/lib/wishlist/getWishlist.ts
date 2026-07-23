import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import { getEffectiveAvailableForVariants } from "@/lib/inventory/getEffectiveAvailable";
import { fail, ok, type Result } from "@/types/result";
import type {
  WishlistWithItems,
  WishlistWithProductItems,
  WishlistItemWithProduct,
} from "@/types/wishlist";

/**
 * Returns the current user's default wishlist with raw items (no product
 * joins). Used by the simple "is this in my wishlist?" callers.
 */
export async function getWishlist(): Promise<Result<WishlistWithItems | null>> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return ok(null);

  // Resolve the customer row — wishlists are keyed off customer_id since
  // 20260601000006. RLS would scope the wishlists query anyway, but we
  // need the id for the .eq filter so it doesn't return any public
  // wishlists belonging to others.
  const { data: custRow } = await supabase
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) return ok(null);

  const { data: wishlist, error: wErr } = await supabase
    .from("wishlists")
    .select("*")
    .eq("customer_id", customerId)
    .eq("is_default", true)
    .maybeSingle();
  if (wErr) return fail<WishlistWithItems | null>(wErr.message, wErr.code);
  if (!wishlist) return ok(null);

  const { data: items, error: iErr } = await supabase
    .from("wishlist_items")
    .select(
      "id, wishlist_id, customer_id, product_id, variant_id, quantity, " +
        "notify_on_restock, notify_on_sale, source, last_notified_at, " +
        "last_notification_kind, created_at"
    )
    .eq("wishlist_id", (wishlist as any).id)
    .order("created_at", { ascending: false });
  if (iErr) return fail<WishlistWithItems | null>(iErr.message, iErr.code);

  return ok({
    ...(wishlist as any),
    items: (items ?? []) as any,
  } as WishlistWithItems);
}

/**
 * Phase 5: returns the wishlist enriched with product info, variant labels,
 * formatted prices, and a current effective_available snapshot. Used by the
 * /wishlist account page so it can render badges + per-item actions without
 * client-side joins.
 *
 * The price label respects the customer's preferred_currency.
 */
export async function getWishlistWithProducts(): Promise<
  Result<WishlistWithProductItems | null>
> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return ok(null);
  const userId = authData.user.id;

  const baseResult = await getWishlist();
  if (!baseResult.success) {
    return fail<WishlistWithProductItems | null>(baseResult.error, baseResult.code);
  }
  const base = baseResult.data;
  if (!base || base.items.length === 0) {
    return ok(
      base
        ? ({ ...base, items: [] } as WishlistWithProductItems)
        : null
    );
  }

  const admin = createAdminClient();
  const productIds = Array.from(new Set(base.items.map((i) => i.product_id)));
  const variantIds = Array.from(
    new Set(
      base.items
        .map((i) => i.variant_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  const [
    { data: productRows },
    { data: variantRows },
    { data: custRow },
  ] = await Promise.all([
    admin.from("products").select("id, name, slug, base_price").in("id", productIds),
    variantIds.length > 0
      ? admin
          .from("product_variants")
          .select("id, attribute_combo, price")
          .in("id", variantIds)
      : Promise.resolve({ data: [] as Array<unknown> }),
    admin
      .from("customers")
      .select("preferred_currency")
      .eq("auth_user_id", userId)
      .maybeSingle(),
  ]);

  const products = (productRows ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
    base_price: number | string | null;
  }>;
  const variants = (variantRows ?? []) as Array<{
    id: string;
    attribute_combo: Record<string, string> | null;
    price: number | string | null;
  }>;
  const currency =
    (custRow as { preferred_currency: string } | null)?.preferred_currency ?? "EUR";

  const productById = new Map(products.map((p) => [p.id, p]));
  const variantById = new Map(variants.map((v) => [v.id, v]));

  // Resolve all combo value UUIDs to display strings in one batch.
  const valueIdsInUse = new Set<string>();
  for (const v of variants) {
    if (!v.attribute_combo) continue;
    for (const id of Object.values(v.attribute_combo)) valueIdsInUse.add(id);
  }
  const valueLabelById = new Map<string, string>();
  if (valueIdsInUse.size > 0) {
    const { data: vRows } = await admin
      .from("attribute_values")
      .select("id, value")
      .in("id", Array.from(valueIdsInUse));
    for (const r of (vRows ?? []) as Array<{ id: string; value: string }>) {
      valueLabelById.set(r.id, r.value);
    }
  }

  // Fetch availability for variant-scoped items in ONE round-trip via
  // the batch helper. Phase 2 of the data-layer remediation — replaces
  // a per-variant RPC loop that scaled linearly with wishlist size.
  const availabilityByVariant = await getEffectiveAvailableForVariants(
    variantIds,
    { viewerId: null }
  );

  const enriched: WishlistItemWithProduct[] = base.items.map((item) => {
    const product = productById.get(item.product_id);
    const variant = item.variant_id ? variantById.get(item.variant_id) : null;
    const price = variant
      ? Number(variant.price ?? 0)
      : Number(product?.base_price ?? 0);
    let variantLabel: string | null = null;
    if (variant?.attribute_combo) {
      const labels = Object.values(variant.attribute_combo)
        .map((id) => valueLabelById.get(id))
        .filter((s): s is string => typeof s === "string");
      if (labels.length > 0) variantLabel = labels.join(" · ");
    }
    return {
      ...item,
      product_name: product?.name ?? "(αγνωστο)",
      product_slug: product?.slug ?? "",
      variant_label: variantLabel,
      price_label: formatCurrency(price, currency),
      effective_available: item.variant_id
        ? availabilityByVariant.get(item.variant_id) ?? 0
        : 0,
    };
  });

  return ok({ ...base, items: enriched });
}
