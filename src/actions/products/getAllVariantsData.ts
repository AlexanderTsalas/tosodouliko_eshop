"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/rbac";
import { resolveProductImageUrls } from "@/lib/media/resolveProductImageUrl";
import { resolveProductRestriction } from "@/lib/admin-products-filter/resolveProductRestriction";
import type { AdminProductFilterParams } from "@/lib/admin-products-filter/productFilters";
import type { ProductPanelData } from "@/components/admin/products/ProductDetailPanel";
import type { Product, ProductImage } from "@/types/products";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";

/**
 * Data for the "all variants" panel mode — every variant of every product
 * in the current scope, batched and paginated.
 *
 * Scope (decided by the caller, mirrors the products table):
 *   - explicitIds present (not matchAll) → exactly those products.
 *   - otherwise → all products matching `filterParams`, paginated.
 *
 * Unlike getProductPanelData (one product, ~15 queries), this batches the
 * per-product queries with `.in(...)` so a whole page costs a fixed handful
 * of round-trips regardless of how many products it contains.
 *
 * NOTE: the stock-status filter is intentionally NOT applied here (same
 * documented limitation as resolveProductIds) — it requires the rollup
 * join. Every other products-table filter is honoured so the panel shows
 * the same set the table would.
 */

export interface AllVariantsInput {
  explicitIds: string[] | null;
  matchAll: boolean;
  filterParams: AdminProductFilterParams;
  page: number;
  pageSize: number;
}

export interface AllVariantsResult {
  products: ProductPanelData[];
  total: number;
  page: number;
  pageSize: number;
}

const MAX_PAGE_SIZE = 15;

export async function getAllVariantsData(
  input: AllVariantsInput
): Promise<AllVariantsResult> {
  await requirePermission("manage:products");
  const supabase = await createClient();

  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize || 8));
  const page = Math.max(1, input.page || 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // ── 1. Resolve this page's ordered product ids + total count. ──────
  let pageIds: string[];
  let total: number;

  const hasExplicit =
    !input.matchAll && !!input.explicitIds && input.explicitIds.length > 0;

  if (hasExplicit) {
    const ids = input.explicitIds as string[];
    total = ids.length;
    pageIds = ids.slice(from, from + pageSize);
  } else {
    const f = input.filterParams ?? {};
    const restriction = await resolveProductRestriction(supabase, f);
    if (restriction !== null && restriction.length === 0) {
      return { products: [], total: 0, page, pageSize };
    }

    let query = supabase
      .from("products")
      .select("id", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (f.q) {
      const term = `%${f.q.replace(/[%_]/g, "\\$&")}%`;
      query = query.or(`name.ilike.${term},base_sku.ilike.${term}`);
    }
    if (f.status === "active") query = query.eq("active", true);
    else if (f.status === "inactive") query = query.eq("active", false);

    const vatOp = f.vatRateIdOp ?? (f.vatRateId ? "is" : undefined);
    if (vatOp === "is" && f.vatRateId) query = query.eq("vat_rate_id", f.vatRateId);
    else if (vatOp === "empty") query = query.is("vat_rate_id", null);
    else if (vatOp === "not_empty") query = query.not("vat_rate_id", "is", null);

    const applyText = (op: string | undefined, value: string | undefined, col: string) => {
      const effective = op ?? (value ? "contains" : undefined);
      if (!effective) return;
      const term = value ? `%${value.replace(/[%_]/g, "\\$&")}%` : "";
      if (effective === "contains" && value) query = query.ilike(col, term);
      else if (effective === "not_contains" && value) query = query.not(col, "ilike", term);
      else if (effective === "empty") query = query.or(`${col}.is.null,${col}.eq.`);
      else if (effective === "not_empty") query = query.not(col, "is", null).neq(col, "");
    };
    applyText(f.nameOp, f.name, "name");
    applyText(f.baseSkuOp, f.baseSku, "base_sku");

    const brandOp = f.brandOp ?? (f.brand ? "contains" : undefined);
    if (brandOp === "contains" && f.brand) {
      query = query.ilike("brand", `%${f.brand.replace(/[%_]/g, "\\$&")}%`);
    } else if (brandOp === "empty") {
      query = query.or("brand.is.null,brand.eq.");
    } else if (brandOp === "not_empty") {
      query = query.not("brand", "is", null).neq("brand", "");
    }

    const num = (v: string | undefined) =>
      v && Number.isFinite(Number(v)) ? Number(v) : undefined;
    const pv = num(f.priceValue);
    switch (f.priceOp) {
      case "empty": query = query.is("base_price", null); break;
      case "not_empty": query = query.not("base_price", "is", null); break;
      case "eq": if (pv !== undefined) query = query.eq("base_price", pv); break;
      case "gt": if (pv !== undefined) query = query.gt("base_price", pv); break;
      case "lt": if (pv !== undefined) query = query.lt("base_price", pv); break;
      case "gte": if (pv !== undefined) query = query.gte("base_price", pv); break;
      case "lte": if (pv !== undefined) query = query.lte("base_price", pv); break;
      default: {
        const lo = num(f.minPrice);
        const hi = num(f.maxPrice);
        if (lo !== undefined) query = query.gte("base_price", lo);
        if (hi !== undefined) query = query.lte("base_price", hi);
      }
    }

    if (f.volumePrefixIds && f.volumePrefixIds.length > 0) {
      query = query.in("volumetric_prefix_id", f.volumePrefixIds);
    }
    if (restriction !== null) query = query.in("id", restriction);

    const { data, count } = await query;
    pageIds = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    total = count ?? 0;
  }

  if (pageIds.length === 0) {
    return { products: [], total, page, pageSize };
  }

  // ── 2. Batch-fetch variant data for this page's products. ──────────
  const [
    productsRes,
    invRes,
    imageRowsRes,
    allAttributesRes,
    allAttributeValuesRes,
  ] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, base_sku, slug, currency, base_price, active, is_draft, split_overrides, image_axes"
      )
      .in("id", pageIds),
    supabase
      .from("inventory_with_product_status")
      .select(
        "product_id, variant_id, sku, attribute_combo, low_stock_threshold, quantity_available, quantity_reserved, quantity_soft_held, quantity_priority_held, variant_active, stock_status"
      )
      .in("product_id", pageIds),
    supabase
      .from("product_images")
      .select("*")
      .in("product_id", pageIds)
      .order("is_cover", { ascending: false })
      .order("display_order"),
    supabase.from("attributes").select("*").order("name"),
    supabase.from("attribute_values").select("*").order("display_order"),
  ]);

  const productRows = (productsRes.data ?? []) as Array<
    Pick<
      Product,
      | "id"
      | "name"
      | "base_sku"
      | "slug"
      | "currency"
      | "base_price"
      | "active"
      | "is_draft"
      | "split_overrides"
      | "image_axes"
    >
  >;

  type InvRow = {
    product_id: string;
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
  };
  const invRows = (invRes.data ?? []) as InvRow[];

  // Per-variant prices (not on the inventory view).
  const allVariantIds = invRows.map((v) => v.variant_id);
  const { data: priceRows } = allVariantIds.length
    ? await supabase.from("product_variants").select("id, price").in("id", allVariantIds)
    : { data: [] as Array<{ id: string; price: number | string }> };
  const priceById = new Map<string, number>(
    ((priceRows ?? []) as Array<{ id: string; price: number | string }>).map((r) => [
      r.id,
      Number(r.price),
    ])
  );

  // Global attribute catalog → name map + value map (shared by all products;
  // each variant card only reads the slugs/values it actually uses).
  const allAttributes = (allAttributesRes.data ?? []) as Attribute[];
  const allAttributeValues = (allAttributeValuesRes.data ?? []) as AttributeValue[];
  const attributeNames: Record<string, string> = {};
  const slugByAttrId = new Map<string, string>();
  for (const a of allAttributes) {
    attributeNames[a.slug] = a.name;
    slugByAttrId.set(a.id, a.slug);
  }
  const valuesById: ProductPanelData["valuesById"] = {};
  for (const v of allAttributeValues) {
    valuesById[v.id] = {
      value: v.value,
      display_order: v.display_order,
      attribute_slug: slugByAttrId.get(v.attribute_id) ?? "",
    };
  }

  // Images grouped per product (URL-resolved).
  const resolvedImages = await resolveProductImageUrls(
    (imageRowsRes.data ?? []) as ProductImage[]
  );
  const imagesByProduct = new Map<string, ProductImage[]>();
  for (const img of resolvedImages) {
    const arr = imagesByProduct.get(img.product_id) ?? [];
    arr.push(img);
    imagesByProduct.set(img.product_id, arr);
  }

  // Variants grouped per product.
  const invByProduct = new Map<string, InvRow[]>();
  for (const r of invRows) {
    const arr = invByProduct.get(r.product_id) ?? [];
    arr.push(r);
    invByProduct.set(r.product_id, arr);
  }

  const productById = new Map(productRows.map((p) => [p.id, p]));

  // Assemble ProductPanelData per product, preserving page order.
  const products: ProductPanelData[] = [];
  for (const id of pageIds) {
    const p = productById.get(id);
    if (!p) continue;
    const variants = (invByProduct.get(id) ?? []).map((v) => ({
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
    products.push({
      product: {
        id: p.id,
        name: p.name,
        base_sku: p.base_sku,
        slug: p.slug,
        currency: p.currency,
        base_price: Number(p.base_price),
        active: p.active,
        is_draft: p.is_draft,
        split_overrides: p.split_overrides,
        image_axes: p.image_axes ?? [],
      },
      variants,
      attributeNames,
      valuesById,
      images: imagesByProduct.get(id) ?? [],
      allAttributes,
      allAttributeValues,
    });
  }

  return { products, total, page, pageSize };
}
