/**
 * Shared filter shape for the admin products list + bulk-edit + chips.
 *
 * For every nullable-or-relational field, an "Op" param sits alongside the
 * value field. Possible operators per type:
 *
 *   FK fields    (categoryId, supplierId, vatRateId):
 *     "is"        — value required, equals match (default)
 *     "empty"     — no value; the relation is unset / no rows
 *     "not_empty" — no value; the relation has any value
 *
 *   Text fields  (brand):
 *     "contains"  — case-insensitive substring (default)
 *     "empty"     — column is NULL or ''
 *     "not_empty" — column has any non-empty value
 *
 *   Numeric range fields (price, age, weight, costPrice):
 *     "between"   — min/max range (default; either side can be blank)
 *     "empty"     — column IS NULL
 *     "not_empty" — column IS NOT NULL
 *
 * The absence of an "Op" param means the default operator for that type.
 * The presence of "empty" / "not_empty" ignores any value param.
 */

export type FkOp = "is" | "empty" | "not_empty";
export type TextOp = "contains" | "not_contains" | "empty" | "not_empty";
export type NumOp =
  | "between"
  | "eq"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "empty"
  | "not_empty";

export interface AdminProductFilterParams {
  q?: string;
  status?: string;
  stock?: string;

  // ── Per-column text filters (products.name / products.base_sku).
  // TextOp incl. "not_contains".
  name?: string;
  nameOp?: TextOp;
  baseSku?: string;
  baseSkuOp?: TextOp;

  // ── Per-column dropdown set filters (multi-value, "any of").
  // Encoded as comma-joined UUID lists in the URL.
  //   categoryIds      → product belongs to ANY of these categories
  //   supplierIds      → product's PREFERRED supplier is ANY of these
  //   volumePrefixIds  → products.volumetric_prefix_id is ANY of these
  categoryIds?: string[];
  supplierIds?: string[];
  volumePrefixIds?: string[];

  categoryId?: string;
  categoryIdOp?: FkOp;
  supplierId?: string;
  supplierIdOp?: FkOp;
  vatRateId?: string;
  vatRateIdOp?: FkOp;

  brand?: string;
  brandOp?: TextOp;

  // Single-operand value for the comparison numeric ops
  // (eq/gt/lt/gte/lte). "between" still uses minPrice/maxPrice.
  priceValue?: string;
  minPrice?: string;
  maxPrice?: string;
  priceOp?: NumOp;

  minAge?: string;
  maxAge?: string;
  ageOp?: NumOp;

  minWeight?: string;
  maxWeight?: string;
  weightOp?: NumOp;

  minCostPrice?: string;
  maxCostPrice?: string;
  costPriceOp?: NumOp;

  attributeFilters?: Record<string, string[]>;
}

const FK_OPS = new Set<FkOp>(["is", "empty", "not_empty"]);
const TEXT_OPS = new Set<TextOp>([
  "contains",
  "not_contains",
  "empty",
  "not_empty",
]);
const NUM_OPS = new Set<NumOp>([
  "between",
  "eq",
  "gt",
  "lt",
  "gte",
  "lte",
  "empty",
  "not_empty",
]);

/** Split a comma-joined id list param into a clean string[] (empties dropped). */
function idList(v: string | undefined): string[] | undefined {
  if (!v) return undefined;
  const ids = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

/** Numeric ops that take a single operand (priceValue) rather than a range. */
export const SINGLE_OPERAND_NUM_OPS: ReadonlySet<NumOp> = new Set<NumOp>([
  "eq",
  "gt",
  "lt",
  "gte",
  "lte",
]);

function fkOp(v: string | undefined): FkOp | undefined {
  return v && FK_OPS.has(v as FkOp) ? (v as FkOp) : undefined;
}
function textOp(v: string | undefined): TextOp | undefined {
  return v && TEXT_OPS.has(v as TextOp) ? (v as TextOp) : undefined;
}
function numOp(v: string | undefined): NumOp | undefined {
  return v && NUM_OPS.has(v as NumOp) ? (v as NumOp) : undefined;
}

export function parseAdminProductFilters(
  searchParams: Record<string, string | string[] | undefined>
): AdminProductFilterParams {
  const get = (k: string): string | undefined => {
    const v = searchParams[k];
    return typeof v === "string" ? v : undefined;
  };

  const attributeFilters: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (!key.startsWith("attr_")) continue;
    const slug = key.slice("attr_".length);
    const vals = Array.isArray(value) ? value : value ? [value] : [];
    if (vals.length > 0) attributeFilters[slug] = vals;
  }

  return {
    q: get("q")?.trim() || undefined,
    status: get("status") || undefined,
    stock: get("stock") || undefined,

    name: get("name")?.trim() || undefined,
    nameOp: textOp(get("nameOp")),
    baseSku: get("baseSku")?.trim() || undefined,
    baseSkuOp: textOp(get("baseSkuOp")),

    categoryIds: idList(get("categoryIds")),
    supplierIds: idList(get("supplierIds")),
    volumePrefixIds: idList(get("volumePrefixIds")),

    categoryId: get("categoryId") || undefined,
    categoryIdOp: fkOp(get("categoryIdOp")),
    supplierId: get("supplierId") || undefined,
    supplierIdOp: fkOp(get("supplierIdOp")),
    vatRateId: get("vatRateId") || undefined,
    vatRateIdOp: fkOp(get("vatRateIdOp")),

    brand: get("brand")?.trim() || undefined,
    brandOp: textOp(get("brandOp")),

    priceValue: get("priceValue"),
    minPrice: get("minPrice"),
    maxPrice: get("maxPrice"),
    priceOp: numOp(get("priceOp")),

    minAge: get("minAge"),
    maxAge: get("maxAge"),
    ageOp: numOp(get("ageOp")),

    minWeight: get("minWeight"),
    maxWeight: get("maxWeight"),
    weightOp: numOp(get("weightOp")),

    minCostPrice: get("minCostPrice"),
    maxCostPrice: get("maxCostPrice"),
    costPriceOp: numOp(get("costPriceOp")),

    attributeFilters: Object.keys(attributeFilters).length > 0 ? attributeFilters : undefined,
  };
}

export function flattenForPreserve(filters: AdminProductFilterParams): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (k: keyof AdminProductFilterParams, v: string | undefined) => {
    if (v) out[k as string] = v;
  };
  set("q", filters.q);
  set("status", filters.status);
  set("stock", filters.stock);
  set("name", filters.name);
  set("nameOp", filters.nameOp);
  set("baseSku", filters.baseSku);
  set("baseSkuOp", filters.baseSkuOp);
  if (filters.categoryIds?.length) out.categoryIds = filters.categoryIds.join(",");
  if (filters.supplierIds?.length) out.supplierIds = filters.supplierIds.join(",");
  if (filters.volumePrefixIds?.length)
    out.volumePrefixIds = filters.volumePrefixIds.join(",");
  set("categoryId", filters.categoryId);
  set("categoryIdOp", filters.categoryIdOp);
  set("supplierId", filters.supplierId);
  set("supplierIdOp", filters.supplierIdOp);
  set("vatRateId", filters.vatRateId);
  set("vatRateIdOp", filters.vatRateIdOp);
  set("brand", filters.brand);
  set("brandOp", filters.brandOp);
  set("priceValue", filters.priceValue);
  set("minPrice", filters.minPrice);
  set("maxPrice", filters.maxPrice);
  set("priceOp", filters.priceOp);
  set("minAge", filters.minAge);
  set("maxAge", filters.maxAge);
  set("ageOp", filters.ageOp);
  set("minWeight", filters.minWeight);
  set("maxWeight", filters.maxWeight);
  set("weightOp", filters.weightOp);
  set("minCostPrice", filters.minCostPrice);
  set("maxCostPrice", filters.maxCostPrice);
  set("costPriceOp", filters.costPriceOp);
  return out;
}

/** Counts user-active filter rules for the "Φίλτρα (N)" badge. */
export function countActiveFilters(filters: AdminProductFilterParams): number {
  let n = 0;
  if (filters.status) n++;
  if (filters.stock) n++;

  if (filters.nameOp === "empty" || filters.nameOp === "not_empty") n++;
  else if (filters.name) n++;
  if (filters.baseSkuOp === "empty" || filters.baseSkuOp === "not_empty") n++;
  else if (filters.baseSku) n++;

  if (filters.categoryIds?.length) n++;
  if (filters.supplierIds?.length) n++;
  if (filters.volumePrefixIds?.length) n++;

  if (filters.categoryIdOp === "empty" || filters.categoryIdOp === "not_empty") n++;
  else if (filters.categoryId) n++;

  if (filters.supplierIdOp === "empty" || filters.supplierIdOp === "not_empty") n++;
  else if (filters.supplierId) n++;

  if (filters.vatRateIdOp === "empty" || filters.vatRateIdOp === "not_empty") n++;
  else if (filters.vatRateId) n++;

  if (filters.brandOp === "empty" || filters.brandOp === "not_empty") n++;
  else if (filters.brand) n++;

  if (filters.priceOp === "empty" || filters.priceOp === "not_empty") n++;
  else if (filters.priceOp && SINGLE_OPERAND_NUM_OPS.has(filters.priceOp)) {
    if (filters.priceValue) n++;
  } else if (filters.minPrice || filters.maxPrice) n++;

  if (filters.ageOp === "empty" || filters.ageOp === "not_empty") n++;
  else if (filters.minAge || filters.maxAge) n++;

  if (filters.weightOp === "empty" || filters.weightOp === "not_empty") n++;
  else if (filters.minWeight || filters.maxWeight) n++;

  if (filters.costPriceOp === "empty" || filters.costPriceOp === "not_empty") n++;
  else if (filters.minCostPrice || filters.maxCostPrice) n++;

  if (filters.attributeFilters) n += Object.keys(filters.attributeFilters).length;
  return n;
}
