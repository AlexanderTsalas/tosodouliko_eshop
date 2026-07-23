"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/rbac";
import { resolveProductImageUrls } from "@/lib/media/resolveProductImageUrl";
import { getProductSpecifications } from "@/lib/product-specifications/getProductSpecifications";
import { resolveAutoCategories } from "@/lib/categories/resolveAutoCategories";
import {
  resolveEffectiveVatRate,
  normaliseJoinedCategories,
  computeMargin,
} from "@/lib/vat-helpers";
import type { ProductPanelData } from "@/components/admin/products/ProductDetailPanel";
import type { Product, ProductImage } from "@/types/products";
import type { ProductVariant } from "@/types/product-variants";
import type { VolumetricPrefix } from "@/types/volumetric";
import type { ProductSupplierSummary } from "@/lib/suppliers/getProductSupplierSummary";
import type { Category } from "@/types/category-navigation";
import type { Supplier } from "@/types/suppliers";
import type { VatRate } from "@/types/vat-rates";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";
import type {
  ProductPanelBundle,
  ProductPanelOverviewData,
  ProductPanelImagesData,
} from "@/types/product-panel";

/**
 * Serialise a combo to the key format used by ImageGroupList /
 * ProductImagesComboTab. Mirrors `comboToKey` in
 * src/components/admin/products/images/ImageGroupList.tsx — that file is
 * marked "use client", so the pure logic is inlined here to keep the
 * server side free of client-only imports.
 */
function comboToImageGroupKey(
  combo: Record<string, string> | null
): string {
  if (!combo || Object.keys(combo).length === 0) return "";
  const sorted = Object.keys(combo).sort();
  return JSON.stringify(sorted.map((k) => [k, combo[k]]));
}

/**
 * Assemble all data the product side panel needs for `productId`.
 *
 * Returns serializable DATA only (no JSX) — the client panel renders the
 * existing tab components from these props. This is the single source of
 * truth for panel content; it replaces the old per-`?focus=` fetch that
 * lived inside the products list page and forced the whole table to
 * re-run on every panel open.
 *
 * Returns null when the product doesn't exist (panel shows a not-found
 * state / closes).
 */
export async function getProductPanelData(
  productId: string,
  options: { variantFocus?: string | null } = {}
): Promise<ProductPanelBundle | null> {
  await requirePermission("manage:products");
  const variantFocus = options.variantFocus ?? null;
  const supabase = await createClient();

  // Full product row — the overview tab needs every field.
  const { data: productRow } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();
  if (!productRow) return null;

  const product = productRow as Product;

  // Variant inventory snapshot (pre-computed stock_status per variant).
  const { data: invRows } = await supabase
    .from("inventory_with_product_status")
    .select(
      "variant_id, sku, attribute_combo, low_stock_threshold, quantity_available, quantity_reserved, quantity_soft_held, quantity_priority_held, variant_active, stock_status"
    )
    .eq("product_id", productId);
  const variantInv = (invRows ?? []) as Array<{
    variant_id: string;
    sku: string | null;
    attribute_combo: Record<string, string> | null;
    low_stock_threshold: number;
    quantity_available: number;
    quantity_reserved: number;
    quantity_soft_held: number;
    quantity_priority_held: number;
    variant_active: boolean;
    stock_status: "ok" | "low" | "out" | "untracked";
  }>;

  // Per-variant prices live on product_variants.
  const variantIds = variantInv.map((v) => v.variant_id);
  const { data: priceRows } = variantIds.length
    ? await supabase
        .from("product_variants")
        .select("id, price")
        .in("id", variantIds)
    : { data: [] as Array<{ id: string; price: number | string }> };
  const priceById = new Map<string, number>(
    ((priceRows ?? []) as Array<{ id: string; price: number | string }>).map(
      (r) => [r.id, Number(r.price)]
    )
  );

  // Resolve attribute slugs + value IDs used by any variant on this product.
  const slugsInUse = new Set<string>();
  const valueIdsInUse = new Set<string>();
  for (const v of variantInv) {
    if (!v.attribute_combo) continue;
    for (const [slug, valueId] of Object.entries(v.attribute_combo)) {
      slugsInUse.add(slug);
      valueIdsInUse.add(valueId);
    }
  }

  const [
    attrRowsRes,
    valueRowsRes,
    imageRowsRes,
    variantStockRes,
    productCatsRes,
    vatRatesRes,
    allSuppliersRes,
    volumetricPrefixesRes,
    allCategoriesRes,
    storefrontSettingsRes,
    supplierProductsRes,
    allAttributesRes,
    allAttributeValuesRes,
  ] = await Promise.all([
    slugsInUse.size > 0
      ? supabase
          .from("attributes")
          .select("slug, name")
          .in("slug", Array.from(slugsInUse))
      : Promise.resolve({ data: [] as Array<{ slug: string; name: string }> }),
    valueIdsInUse.size > 0
      ? supabase
          .from("attribute_values")
          .select("id, value, display_order, attribute_id")
          .in("id", Array.from(valueIdsInUse))
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            value: string;
            display_order: number;
            attribute_id: string;
          }>,
        }),
    supabase
      .from("product_images")
      .select("*")
      .eq("product_id", productId)
      .order("is_cover", { ascending: false })
      .order("display_order"),
    supabase
      .from("product_variants")
      .select("*, inventory_items(quantity_available)")
      .eq("product_id", productId),
    supabase
      .from("product_categories")
      .select("category_id, categories(id, name, vat_rate_id)")
      .eq("product_id", productId),
    supabase.from("vat_rates").select("*").order("rate"),
    supabase.from("suppliers").select("*").order("name"),
    supabase
      .from("volumetric_prefixes")
      .select("*")
      .eq("active", true)
      .order("display_order", { ascending: true })
      .order("display_name", { ascending: true }),
    supabase
      .from("categories")
      .select("*")
      .eq("active", true)
      .order("display_order"),
    supabase
      .from("storefront_settings")
      .select("show_when_oos_default")
      .eq("id", 1)
      .maybeSingle(),
    variantIds.length > 0
      ? supabase
          .from("supplier_products")
          .select(
            "variant_id, supplier_id, supplier_sku, is_preferred, unit_cost, unit_cost_currency, suppliers!inner(id, name, default_currency)"
          )
          .in("variant_id", variantIds)
      : Promise.resolve({ data: [] }),
    supabase.from("attributes").select("*").order("name"),
    supabase.from("attribute_values").select("*").order("display_order"),
  ]);

  const attributeNames: Record<string, string> = {};
  for (const r of (attrRowsRes.data ?? []) as Array<{
    slug: string;
    name: string;
  }>) {
    attributeNames[r.slug] = r.name;
  }

  // attribute_id → slug map, sourced from the FULL attribute catalog.
  const slugByAttrId = new Map<string, string>();
  for (const r of (allAttributesRes.data ?? []) as Array<{
    id: string;
    slug: string;
  }>) {
    slugByAttrId.set(r.id, r.slug);
  }

  const valuesById: Record<
    string,
    { value: string; display_order: number; attribute_slug: string }
  > = {};
  for (const r of (valueRowsRes.data ?? []) as Array<{
    id: string;
    value: string;
    display_order: number;
    attribute_id: string;
  }>) {
    valuesById[r.id] = {
      value: r.value,
      display_order: r.display_order,
      attribute_slug: slugByAttrId.get(r.attribute_id) ?? "",
    };
  }

  const images = await resolveProductImageUrls(
    (imageRowsRes.data ?? []) as ProductImage[]
  );

  const variants = variantInv.map((v) => ({
    variant_id: v.variant_id,
    sku: v.sku,
    attribute_combo: v.attribute_combo,
    price: priceById.get(v.variant_id) ?? 0,
    active: v.variant_active,
    quantity_available: v.quantity_available,
    quantity_reserved: v.quantity_reserved,
    quantity_soft_held: v.quantity_soft_held,
    quantity_priority_held: v.quantity_priority_held,
    low_stock_threshold: v.low_stock_threshold,
    stock_status: v.stock_status,
  }));

  const panelData: ProductPanelData = {
    product: {
      id: product.id,
      name: product.name,
      base_sku: product.base_sku,
      slug: product.slug,
      currency: product.currency,
      base_price: Number(product.base_price),
      active: product.active,
      is_draft: product.is_draft,
      split_overrides: product.split_overrides,
      image_axes: product.image_axes ?? [],
    },
    variants,
    attributeNames,
    valuesById,
    images,
    allAttributes: (allAttributesRes.data ?? []) as Attribute[],
    allAttributeValues: (allAttributeValuesRes.data ?? []) as AttributeValue[],
  };

  // ─── Overview-tab data ────────────────────────────────────────────
  type VariantStockRow = {
    id: string;
    inventory_items:
      | { quantity_available: number }
      | { quantity_available: number }[]
      | null;
  };
  const variantStockRows = (variantStockRes.data ?? []) as VariantStockRow[];
  const variantCount = variantStockRows.length;
  let totalStock = 0;
  for (const r of variantStockRows) {
    const inv = Array.isArray(r.inventory_items)
      ? r.inventory_items[0]
      : r.inventory_items;
    totalStock += inv?.quantity_available ?? 0;
  }

  const vatRates = (vatRatesRes.data ?? []) as VatRate[];
  const productCategoryRates = normaliseJoinedCategories(productCatsRes.data);
  const resolvedVat = resolveEffectiveVatRate(
    { vat_rate_id: product.vat_rate_id },
    productCategoryRates,
    vatRates
  );

  const initialCategoryIds: string[] = [];
  for (const row of (productCatsRes.data ?? []) as Array<{
    category_id: string;
  }>) {
    initialCategoryIds.push(row.category_id);
  }

  type SpRow = {
    variant_id: string;
    supplier_id: string;
    supplier_sku: string | null;
    is_preferred: boolean;
    unit_cost: number | string | null;
    unit_cost_currency: string | null;
    suppliers:
      | { id: string; name: string; default_currency: string }
      | Array<{ id: string; name: string; default_currency: string }>
      | null;
  };
  const spRows = (supplierProductsRes.data ?? []) as SpRow[];
  const bySupplier = new Map<string, SpRow[]>();
  for (const sp of spRows) {
    const arr = bySupplier.get(sp.supplier_id) ?? [];
    arr.push(sp);
    bySupplier.set(sp.supplier_id, arr);
  }
  const supplierSummary: ProductSupplierSummary[] = [];
  for (const [supplierId, group] of bySupplier) {
    const first = group[0];
    const supplierObj = Array.isArray(first.suppliers)
      ? first.suppliers[0]
      : first.suppliers;
    if (!supplierObj) continue;
    const skuSet = new Set(group.map((g) => g.supplier_sku ?? ""));
    const skuIsMixed = skuSet.size > 1;
    const defaultSku = !skuIsMixed ? group[0].supplier_sku : null;
    const costKey = (g: SpRow) =>
      `${g.unit_cost === null ? "" : Number(g.unit_cost).toFixed(2)}|${
        g.unit_cost_currency ?? ""
      }`;
    const costSet = new Set(group.map(costKey));
    const costIsMixed = costSet.size > 1;
    const defaultCost = !costIsMixed
      ? group[0].unit_cost === null
        ? null
        : Number(group[0].unit_cost)
      : null;
    const defaultCcy = !costIsMixed ? group[0].unit_cost_currency : null;
    supplierSummary.push({
      supplier_id: supplierId,
      supplier_name: supplierObj.name,
      supplier_default_currency: supplierObj.default_currency,
      is_preferred: group.every((g) => g.is_preferred),
      variant_count: group.length,
      total_variant_count: variantStockRows.length,
      default_supplier_sku: defaultSku,
      sku_is_mixed: skuIsMixed,
      default_unit_cost: defaultCost,
      default_unit_cost_currency: defaultCcy,
      cost_is_mixed: costIsMixed,
    });
  }
  supplierSummary.sort((a, b) =>
    a.supplier_name.localeCompare(b.supplier_name)
  );

  // Margin resolution chain (preferred supplier → product fallback → null).
  const marginPreferred = supplierSummary.find(
    (s) =>
      s.is_preferred &&
      s.default_unit_cost !== null &&
      !s.cost_is_mixed &&
      s.default_unit_cost_currency === product.currency
  );
  let marginCost: number | null = null;
  let marginCostSource: "supplier" | "product_fallback" | null = null;
  const marginMissing: string[] = [];
  if (marginPreferred) {
    marginCost = marginPreferred.default_unit_cost;
    marginCostSource = "supplier";
  } else if (
    product.cost_price !== null &&
    product.cost_price !== undefined &&
    (!product.cost_currency || product.cost_currency === product.currency)
  ) {
    marginCost = Number(product.cost_price);
    marginCostSource = "product_fallback";
  } else {
    if (supplierSummary.length === 0) {
      marginMissing.push("κανένας προμηθευτής δεν είναι ορισμένος");
    } else if (!supplierSummary.some((s) => s.is_preferred)) {
      marginMissing.push("δεν έχει οριστεί προτιμώμενος προμηθευτής");
    } else if (
      !supplierSummary.some((s) => s.is_preferred && s.default_unit_cost !== null)
    ) {
      marginMissing.push("ο προτιμώμενος προμηθευτής δεν έχει κόστος μονάδας");
    } else {
      marginMissing.push(
        "διαφορετικό κόστος ανά παραλλαγή — ορίστε ενιαίο για το προϊόν"
      );
    }
  }
  if (!resolvedVat) marginMissing.push("μη επιλυμένος ΦΠΑ");
  const margin: ProductPanelOverviewData["margin"] =
    marginCost !== null && resolvedVat
      ? {
          metrics: computeMargin(
            Number(product.base_price),
            marginCost,
            resolvedVat.rate.rate
          ),
          missing: [],
          costSource: marginCostSource,
        }
      : { metrics: null, missing: marginMissing, costSource: null };

  // Avg supplier cost (uniform same-currency).
  let avgSupplierCost: { amount: number; supplier_count: number } | null = null;
  const validCosts = supplierSummary
    .filter(
      (s) =>
        s.default_unit_cost !== null &&
        !s.cost_is_mixed &&
        s.default_unit_cost_currency === product.currency
    )
    .map((s) => Number(s.default_unit_cost));
  if (validCosts.length > 0) {
    const sum = validCosts.reduce((a, b) => a + b, 0);
    avgSupplierCost = {
      amount: Math.round((sum / validCosts.length) * 100) / 100,
      supplier_count: validCosts.length,
    };
  }

  const globalShowWhenOosDefault = Boolean(
    (storefrontSettingsRes.data as { show_when_oos_default: boolean } | null)
      ?.show_when_oos_default
  );

  const overview: ProductPanelOverviewData = {
    product,
    variantCount,
    totalStock,
    vatRates,
    resolvedVat,
    allSuppliers: (allSuppliersRes.data ?? []) as Supplier[],
    supplierSummary,
    volumetricPrefixes: (volumetricPrefixesRes.data ?? []) as VolumetricPrefix[],
    allCategories: (allCategoriesRes.data ?? []) as Category[],
    initialCategoryIds,
    autoCategories:
      (await resolveAutoCategories(supabase, [productId])).get(productId) ?? [],
    margin,
    avgSupplierCost,
    globalShowWhenOosDefault,
  };

  // ─── Images-tab data ──────────────────────────────────────────────
  const variantsForImages = (variantStockRes.data ??
    []) as unknown as ProductVariant[];
  let initialSelectedKey: string | undefined;
  if (variantFocus) {
    const focusedVariant = variantsForImages.find((v) => v.id === variantFocus);
    if (focusedVariant) {
      const imageAxes = new Set(product.image_axes ?? []);
      const restricted: Record<string, string> = {};
      for (const [slug, valueId] of Object.entries(
        focusedVariant.attribute_combo ?? {}
      )) {
        if (imageAxes.has(slug)) restricted[slug] = valueId;
      }
      initialSelectedKey = comboToImageGroupKey(restricted);
    }
  }

  const imagesData: ProductPanelImagesData = {
    productId: product.id,
    productName: product.name,
    initialImageAxes: product.image_axes ?? [],
    initialImages: images,
    variants: variantsForImages,
    attributes: (allAttributesRes.data ?? []) as Attribute[],
    attributeValues: (allAttributeValuesRes.data ?? []) as AttributeValue[],
    initialSelectedKey,
  };

  const specs = await getProductSpecifications(productId);

  return { panelData, overview, images: imagesData, specs };
}
