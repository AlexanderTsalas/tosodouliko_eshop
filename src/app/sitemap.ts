import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildVariantSlugSuffix,
  buildValuesById,
  resolveEffectiveSplitters,
  type ValueLookup,
} from "@/lib/variants-helpers";
import { resolveShowWhenOosForVariants } from "@/lib/storefront/resolveOosVisibility";
import type { Product } from "@/types/products";
import type { ProductVariant } from "@/types/product-variants";

export const revalidate = 3600; // re-generate at most once per hour

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/products`, changeFrequency: "daily", priority: 0.9 },
    { url: `${siteUrl}/auth/signin`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${siteUrl}/auth/signup`, changeFrequency: "monthly", priority: 0.3 },
  ];

  // Skip dynamic entries during build if credentials aren't configured
  // (avoids "supabaseUrl is required" during Vercel pre-render).
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes("placeholder")
  ) {
    return staticEntries;
  }

  const admin = createAdminClient();

  // 1. Fetch every attribute with its splits_listing flag (small table). The
  //    effective splitter set is resolved per-product below.
  const { data: attrRows } = await admin
    .from("attributes")
    .select("slug, splits_listing");
  const allAttributes = ((attrRows ?? []) as Array<{
    slug: string;
    splits_listing: boolean;
  }>);

  // 2. Active products (also pull split_overrides to resolve splitters per product).
  const { data: products } = await admin
    .from("products")
    .select("id, slug, updated_at, split_overrides")
    .eq("active", true);
  const productList = (products ?? []) as Pick<
    Product,
    "id" | "slug" | "updated_at" | "split_overrides"
  >[];

  // 3. Active variants for those products, joined with inventory so we can
  //    drop hidden+OOS variants from the sitemap (their URLs return 404 on
  //    the storefront — listing them would just send crawlers to dead pages).
  const { data: variants } = await admin
    .from("product_variants")
    .select(
      "id, product_id, attribute_combo, inventory_items(quantity_available, quantity_soft_held, quantity_priority_held)"
    )
    .eq("is_active", true)
    .in("product_id", productList.map((p) => p.id));
  type InvSnap = {
    quantity_available: number;
    quantity_soft_held: number;
    quantity_priority_held: number;
  };
  type VariantRow = {
    id: string;
    product_id: string;
    attribute_combo: Record<string, string> | null;
    inventory_items: InvSnap | InvSnap[] | null;
  };
  const allVariantRows = (variants ?? []) as VariantRow[];

  // Resolve show_when_oos in one batch; drop variants whose URL would 404
  // (contestable=0 AND not configured to remain visible).
  const visibilityById = await resolveShowWhenOosForVariants(
    admin,
    allVariantRows.map((v) => v.id)
  );
  const variantList = allVariantRows.filter((v) => {
    const inv = Array.isArray(v.inventory_items)
      ? v.inventory_items[0]
      : v.inventory_items;
    const contestable =
      Number(inv?.quantity_available ?? 0) +
      Number(inv?.quantity_soft_held ?? 0) +
      Number(inv?.quantity_priority_held ?? 0);
    if (contestable > 0) return true;
    return visibilityById.get(v.id) === true;
  }) as Array<Pick<ProductVariant, "product_id" | "attribute_combo">>;

  // 3b. Resolve every attribute_value uuid referenced — needed for URL slugs.
  const valueIdsInUse = new Set<string>();
  for (const v of variantList) {
    if (!v.attribute_combo) continue;
    for (const id of Object.values(v.attribute_combo)) valueIdsInUse.add(id);
  }
  let valuesById: ReturnType<typeof buildValuesById> = new Map();
  if (valueIdsInUse.size > 0) {
    const { data: vRows } = await admin
      .from("attribute_values")
      .select("id, attribute_id, value, slug")
      .in("id", Array.from(valueIdsInUse));
    valuesById = buildValuesById((vRows ?? []) as ValueLookup[]);
  }

  // 4. For each product, emit one URL per unique splitter combination
  //    (or just the bare product URL if no splitter applies).
  const productEntries: MetadataRoute.Sitemap = [];
  for (const product of productList) {
    const productSplitters = resolveEffectiveSplitters(allAttributes, product.split_overrides);
    const seenSuffixes = new Set<string>();
    const productVariants = variantList.filter((v) => v.product_id === product.id);
    for (const v of productVariants) {
      const suffix = buildVariantSlugSuffix(v.attribute_combo, productSplitters, valuesById);
      if (seenSuffixes.has(suffix)) continue;
      seenSuffixes.add(suffix);
      const url = suffix
        ? `${siteUrl}/products/${product.slug}-${suffix}`
        : `${siteUrl}/products/${product.slug}`;
      productEntries.push({
        url,
        lastModified: product.updated_at,
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
    // Always include the bare product URL too (canonical fallback for variant URLs).
    if (!seenSuffixes.has("")) {
      productEntries.push({
        url: `${siteUrl}/products/${product.slug}`,
        lastModified: product.updated_at,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  }

  return [...staticEntries, ...productEntries];
}
