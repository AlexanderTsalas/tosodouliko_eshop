import { createClient } from "@/lib/supabase/server";
import { MAX_BULK_OPERATION } from "@/lib/bulk-selection/selectionUrl";
import { resolveProductRestriction } from "@/lib/admin-products-filter/resolveProductRestriction";
import type { AdminProductFilterParams } from "@/lib/admin-products-filter/productFilters";

/**
 * Filter shape mirrors the admin products list page. matchAll mode honours
 * every filter the admin sees (excluding stock-status — see comment below).
 */
export type ProductFilterParams = AdminProductFilterParams;

/**
 * Resolves a bulk-selection input (explicit IDs or matchAll+filter) into
 * a concrete product ID list. Enforces MAX_BULK_OPERATION cap.
 *
 * Stock-status filter is NOT applied during matchAll resolution — the
 * stock rollup requires joining variants+inventory and computing a status
 * per product, which the resolver doesn't replicate. If admin selects "all
 * matching" with a stock filter active, the bulk set is the wider unfiltered
 * set. Documented limitation.
 */
export async function resolveProductIds(input: {
  ids: string[] | null;
  matchAll: boolean;
  filterParams?: ProductFilterParams;
}): Promise<
  | { ok: true; ids: string[]; truncated: boolean }
  | { ok: false; error: string; code: string }
> {
  if (!input.matchAll) {
    if (!input.ids || input.ids.length === 0) {
      return { ok: false, error: "No selection provided", code: "EMPTY_SELECTION" };
    }
    if (input.ids.length > MAX_BULK_OPERATION) {
      return {
        ok: false,
        error: `Selection too large (max ${MAX_BULK_OPERATION}).`,
        code: "OVER_CAP",
      };
    }
    return { ok: true, ids: input.ids, truncated: false };
  }

  const supabase = await createClient();
  const f = input.filterParams ?? {};

  // Join-based filters → product_id restriction set.
  const restriction = await resolveProductRestriction(supabase, f);
  if (restriction !== null && restriction.length === 0) {
    return { ok: true, ids: [], truncated: false };
  }

  // Column-based filters applied directly on the products query.
  let query = supabase
    .from("products")
    .select("id")
    .limit(MAX_BULK_OPERATION + 1);

  if (f.q && f.q.trim()) {
    const term = `%${f.q.trim().replace(/[%_]/g, "\\$&")}%`;
    query = query.or(`name.ilike.${term},base_sku.ilike.${term}`);
  }
  if (f.status === "active") query = query.eq("active", true);
  else if (f.status === "inactive") query = query.eq("active", false);

  const vatOp = f.vatRateIdOp ?? (f.vatRateId ? "is" : undefined);
  if (vatOp === "is" && f.vatRateId) query = query.eq("vat_rate_id", f.vatRateId);
  else if (vatOp === "empty") query = query.is("vat_rate_id", null);
  else if (vatOp === "not_empty") query = query.not("vat_rate_id", "is", null);

  const brandOp = f.brandOp ?? (f.brand ? "contains" : undefined);
  if (brandOp === "contains" && f.brand) {
    const term = `%${f.brand.replace(/[%_]/g, "\\$&")}%`;
    query = query.ilike("brand", term);
  } else if (brandOp === "empty") {
    query = query.or("brand.is.null,brand.eq.");
  } else if (brandOp === "not_empty") {
    query = query.not("brand", "is", null).neq("brand", "");
  }

  // ── Text column filters (name / base_sku). MUST mirror the products page
  // query exactly so a matchAll bulk op never touches rows the admin can't
  // see. contains / not_contains / empty / not_empty.
  const applyText = (op: string | undefined, value: string | undefined, col: string) => {
    const effective = op ?? (value ? "contains" : undefined);
    if (!effective) return;
    const term = value ? `%${value.replace(/[%_]/g, "\\$&")}%` : "";
    if (effective === "contains" && value) {
      query = query.ilike(col, term);
    } else if (effective === "not_contains" && value) {
      query = query.not(col, "ilike", term);
    } else if (effective === "empty") {
      query = query.or(`${col}.is.null,${col}.eq.`);
    } else if (effective === "not_empty") {
      query = query.not(col, "is", null).neq(col, "");
    }
  };
  applyText(f.nameOp, f.name, "name");
  applyText(f.baseSkuOp, f.baseSku, "base_sku");

  // ── Numeric column filter (price). between-range + comparison ops.
  const applyNumeric = (
    op: string | undefined,
    value: string | undefined,
    min: string | undefined,
    max: string | undefined,
    col: string
  ) => {
    const num = (v: string | undefined) =>
      v && Number.isFinite(Number(v)) ? Number(v) : undefined;
    const v = num(value);
    switch (op) {
      case "empty":
        query = query.is(col, null);
        break;
      case "not_empty":
        query = query.not(col, "is", null);
        break;
      case "eq":
        if (v !== undefined) query = query.eq(col, v);
        break;
      case "gt":
        if (v !== undefined) query = query.gt(col, v);
        break;
      case "lt":
        if (v !== undefined) query = query.lt(col, v);
        break;
      case "gte":
        if (v !== undefined) query = query.gte(col, v);
        break;
      case "lte":
        if (v !== undefined) query = query.lte(col, v);
        break;
      default: {
        const lo = num(min);
        const hi = num(max);
        if (lo !== undefined) query = query.gte(col, lo);
        if (hi !== undefined) query = query.lte(col, hi);
      }
    }
  };
  applyNumeric(f.priceOp, f.priceValue, f.minPrice, f.maxPrice, "base_price");

  const applyRange = (op: string | undefined, min: string | undefined, max: string | undefined, col: string) => {
    if (op === "empty") {
      query = query.is(col, null);
    } else if (op === "not_empty") {
      query = query.not(col, "is", null);
    } else {
      if (min && Number.isFinite(Number(min))) query = query.gte(col, Number(min));
      if (max && Number.isFinite(Number(max))) query = query.lte(col, Number(max));
    }
  };
  applyRange(f.ageOp, f.minAge, f.maxAge, "age_min");
  applyRange(f.weightOp, f.minWeight, f.maxWeight, "weight_g");
  applyRange(f.costPriceOp, f.minCostPrice, f.maxCostPrice, "cost_price");

  // ── Volume-prefix set filter (direct products column).
  if (f.volumePrefixIds && f.volumePrefixIds.length > 0) {
    query = query.in("volumetric_prefix_id", f.volumePrefixIds);
  }

  if (restriction !== null) query = query.in("id", restriction);

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message, code: error.code ?? "QUERY_FAILED" };

  const all = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (all.length > MAX_BULK_OPERATION) {
    return {
      ok: false,
      error: `Filter matches more than ${MAX_BULK_OPERATION} products. Narrow your filters and try again.`,
      code: "OVER_CAP",
    };
  }
  return { ok: true, ids: all, truncated: false };
}
