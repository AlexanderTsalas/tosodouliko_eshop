import { createClient } from "@/lib/supabase/server";
import NewProductButton from "@/components/admin/products/NewProductButton";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import CatalogFilterBar, {
  type FilterSlot,
} from "@/components/admin/common/CatalogFilterBar";
import SelectionCheckbox from "@/components/admin/common/SelectionCheckbox";
import SelectionProvider from "@/components/admin/common/SelectionContext";
import BulkPropagationProvider from "@/components/admin/products/BulkPropagationContext";
import Pagination from "@/components/admin/common/Pagination";
import ProductsTableHead from "@/components/admin/products/ProductsTableHead";
import ProductDeleteButton from "@/components/admin/products/ProductDeleteButton";
import ProductThumbnailStack from "@/components/admin/products/ProductThumbnailStack";
import ProductDetailPanel from "@/components/admin/products/ProductDetailPanel";
import PanelControllerProvider from "@/components/admin/products/PanelControllerContext";
import ProductTableRow from "@/components/admin/products/ProductTableRow";
import { resolveProductImageUrls } from "@/lib/media/resolveProductImageUrl";
import type { ProductImage } from "@/types/products";
import InlineProductCell from "@/components/admin/products/InlineProductCell";
import InlineSupplierCell from "@/components/admin/products/InlineSupplierCell";
import InlineCategoriesCell from "@/components/admin/products/InlineCategoriesCell";
import InlineVolumetricCell from "@/components/admin/products/InlineVolumetricCell";
import { parseSelection } from "@/lib/bulk-selection/selectionUrl";
import {
  parseAdminProductFilters,
  flattenForPreserve,
} from "@/lib/admin-products-filter/productFilters";
import { resolveProductRestriction } from "@/lib/admin-products-filter/resolveProductRestriction";
import { resolveAutoCategories } from "@/lib/categories/resolveAutoCategories";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import { resolveEffectiveVatRate, computeMargin } from "@/lib/vat-helpers";
import type { Product } from "@/types/products";
import type { Category } from "@/types/category-navigation";
import type { Supplier } from "@/types/suppliers";
import type { VatRate } from "@/types/vat-rates";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Προϊόντα — Admin" };
export const dynamic = "force-dynamic";

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

export default async function AdminProductsPage(
  props: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  await requirePermission("manage:products");
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const filters = parseAdminProductFilters(searchParams);

  const page = Math.max(1, Number(typeof searchParams.page === "string" ? searchParams.page : 1));
  const requestedSize = Number(
    typeof searchParams.pageSize === "string" ? searchParams.pageSize : DEFAULT_PAGE_SIZE
  );
  const pageSize = ALLOWED_PAGE_SIZES.includes(requestedSize) ? requestedSize : DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const selection = parseSelection({
    selected: typeof searchParams.selected === "string" ? searchParams.selected : undefined,
    matchAll: typeof searchParams.matchAll === "string" ? searchParams.matchAll : undefined,
  });

  // Dropdown options for the inline cells + column filters. Categories
  // and suppliers feed both the inline editors and the header filters;
  // volumetric prefixes feed the Όγκος inline cell + its column filter.
  const [categoriesRes, suppliersRes, volumetricPrefixesRes] = await Promise.all([
    supabase.from("categories").select("id, name").eq("active", true).order("name"),
    supabase.from("suppliers").select("id, name").eq("active", true).order("name"),
    supabase
      .from("volumetric_prefixes")
      .select("id, display_name")
      .eq("active", true)
      .order("display_order", { ascending: true })
      .order("display_name", { ascending: true }),
  ]);

  const categories = (categoriesRes.data ?? []) as Pick<Category, "id" | "name">[];
  const suppliers = (suppliersRes.data ?? []) as Pick<Supplier, "id" | "name">[];
  const volumetricPrefixesTable = (volumetricPrefixesRes.data ?? []) as Array<{
    id: string;
    display_name: string;
  }>;

  // Resolve join-based filters into a product_id restriction set.
  const restrictToProductIds = await resolveProductRestriction(supabase, filters);
  const isEmptyRestriction = restrictToProductIds !== null && restrictToProductIds.length === 0;

  let query = supabase
    .from("products")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.q) {
    const term = `%${filters.q.replace(/[%_]/g, "\\$&")}%`;
    query = query.or(`name.ilike.${term},base_sku.ilike.${term}`);
  }
  if (filters.status === "active") query = query.eq("active", true);
  else if (filters.status === "inactive") query = query.eq("active", false);

  const vatOp = filters.vatRateIdOp ?? (filters.vatRateId ? "is" : undefined);
  if (vatOp === "is" && filters.vatRateId) query = query.eq("vat_rate_id", filters.vatRateId);
  else if (vatOp === "empty") query = query.is("vat_rate_id", null);
  else if (vatOp === "not_empty") query = query.not("vat_rate_id", "is", null);

  const brandOp = filters.brandOp ?? (filters.brand ? "contains" : undefined);
  if (brandOp === "contains" && filters.brand) {
    const term = `%${filters.brand.replace(/[%_]/g, "\\$&")}%`;
    query = query.ilike("brand", term);
  } else if (brandOp === "empty") {
    query = query.or("brand.is.null,brand.eq.");
  } else if (brandOp === "not_empty") {
    query = query.not("brand", "is", null).neq("brand", "");
  }

  // Text column filters (name / base_sku) — contains / not_contains /
  // empty / not_empty. not_contains uses Postgres NOT ILIKE.
  const applyText = (
    op: string | undefined,
    value: string | undefined,
    col: string
  ) => {
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
  applyText(filters.nameOp, filters.name, "name");
  applyText(filters.baseSkuOp, filters.baseSku, "base_sku");

  // Numeric column filter — supports a between-range plus the single-operand
  // comparison ops (=, >, <, >=, <=) and empty/not_empty.
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
        // "between" (or no op) → optional min/max range.
        const lo = num(min);
        const hi = num(max);
        if (lo !== undefined) query = query.gte(col, lo);
        if (hi !== undefined) query = query.lte(col, hi);
      }
    }
  };
  applyNumeric(
    filters.priceOp,
    filters.priceValue,
    filters.minPrice,
    filters.maxPrice,
    "base_price"
  );

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
  applyRange(filters.ageOp, filters.minAge, filters.maxAge, "age_min");
  applyRange(filters.weightOp, filters.minWeight, filters.maxWeight, "weight_g");
  applyRange(filters.costPriceOp, filters.minCostPrice, filters.maxCostPrice, "cost_price");

  // Volume-prefix set filter (column dropdown) — direct column on products.
  if (filters.volumePrefixIds && filters.volumePrefixIds.length > 0) {
    query = query.in("volumetric_prefix_id", filters.volumePrefixIds);
  }

  if (restrictToProductIds !== null) {
    query = query.in("id", isEmptyRestriction ? ["__none__"] : restrictToProductIds);
  }

  // Stock filter — narrows visible products by stock_rollup status. The
  // column itself is gone (revealed in the side panel) but filtering by
  // it is still useful.
  if (filters.stock && filters.stock !== "all") {
    const { data: matchingRollups } = await supabase
      .from("product_stock_rollup")
      .select("product_id")
      .eq("rolled_up_status", filters.stock);
    const matchingIds = ((matchingRollups ?? []) as Array<{ product_id: string }>)
      .map((r) => r.product_id);
    if (matchingIds.length === 0) {
      query = query.in("id", ["__no_stock_match__"]);
    } else {
      if (isEmptyRestriction || restrictToProductIds) {
        const allowed = new Set(matchingIds);
        const intersected = (restrictToProductIds ?? matchingIds).filter((id) =>
          allowed.has(id)
        );
        query = query.in("id", intersected.length > 0 ? intersected : ["__no_stock_match__"]);
      } else {
        query = query.in("id", matchingIds);
      }
    }
  }

  const { data, count } = await query;
  const products = (data ?? []) as Product[];
  const total = count ?? 0;

  // Batched thumbnail load for the visible rows.
  const productIds = products.map((p) => p.id);
  const imagesByProduct = new Map<string, ProductImage[]>();
  if (productIds.length > 0) {
    const { data: imageRows } = await supabase
      .from("product_images")
      .select("*")
      .in("product_id", productIds)
      .order("is_cover", { ascending: false })
      .order("display_order");
    const allImages = (imageRows ?? []) as ProductImage[];
    const resolved = await resolveProductImageUrls(allImages);
    for (const img of resolved) {
      const list = imagesByProduct.get(img.product_id) ?? [];
      list.push(img);
      imagesByProduct.set(img.product_id, list);
    }
  }

  // ─── Per-row extras: margin / avg cost / preferred supplier / categories.
  // Batched across all visible rows — 4 queries total regardless of
  // page size, not 2N as a per-product summary call would be.
  const extrasByProduct = await fetchProductsExtras(supabase, products);

  // A single fast-search box (matches product name OR base SKU). All other
  // filtering is done per-column from the table header via <ColumnFilter/>.
  const slots: FilterSlot[] = [
    {
      type: "search",
      key: "q",
      placeholder: "Γρήγορη αναζήτηση ονόματος ή SKU…",
    },
  ];

  const preserveParams = flattenForPreserve(filters);
  // The search box is a GET form; pass every OTHER active filter as hidden
  // inputs so submitting a search doesn't drop the column filters.
  const barPreserve = { ...preserveParams };
  delete barPreserve.q;

  return (
    <PanelControllerProvider>
      <BulkPropagationProvider>
      <PageHeader
        title="Προϊόντα"
        description={`${total.toLocaleString("el-GR")} συνολικά. Διαχείριση καταλόγου, παραλλαγών και τιμοκαταλόγου.`}
        actions={<NewProductButton />}
      />

      {/* Fast name/SKU search. Everything column-scoped (name, SKU, price,
          supplier, categories, volume) is filtered inline from the table
          header via <ColumnFilter/>. */}
      <div className="flex flex-wrap items-end gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <CatalogFilterBar
            slots={slots}
            values={{ q: filters.q ?? "" }}
            preserve={barPreserve}
          />
        </div>
      </div>

      <SelectionProvider
        initialSelectedIds={selection.selectedIds}
        initialMatchAll={selection.matchAll}
      >
        <div className="cms-table-wrap">
          <table className="cms-table">
            <ProductsTableHead
              pageIds={products.map((p) => p.id)}
              total={total}
              filterParams={filters}
              categories={categories}
              suppliers={suppliers}
              volumePrefixes={volumetricPrefixesTable.map((vp) => ({
                id: vp.id,
                name: vp.display_name,
              }))}
            />
            <tbody className="content-reveal">
              {products.map((p) => {
                const extras = extrasByProduct.get(p.id);
                return (
                  <ProductTableRow
                    key={p.id}
                    productId={p.id}
                    baseClassName={`cms-row-link ${!p.active ? "opacity-60" : ""}`}
                  >
                    <td data-row-action>
                      <SelectionCheckbox id={p.id} ariaLabel={p.name} />
                    </td>
                    <td data-row-action>
                      <ProductThumbnailStack
                        images={imagesByProduct.get(p.id) ?? []}
                        productName={p.name}
                        productId={p.id}
                      />
                    </td>
                    <td className="text-left font-medium">
                      {/* Single-click navigates (after 250ms — to allow
                          double-click detection); double-click opens
                          inline edit. This cell also carries the
                          stretched-link pseudo so other non-action
                          cells still navigate on click. */}
                      <span className="inline-flex items-center gap-1.5">
                        <InlineProductCell
                          productId={p.id}
                          field="name"
                          fieldType="text"
                          initialValue={p.name}
                          displayValue={p.name}                          isRowLinkTarget
                          inputWidth="w-48"
                        />
                        {p.is_draft && (
                          <span
                            data-row-action
                            className="cms-badge bg-amber-100 border-amber-300 text-amber-900 text-[10px] uppercase tracking-wide font-semibold whitespace-nowrap"
                          >
                            Πρόχειρο
                          </span>
                        )}
                      </span>
                    </td>
                    <td data-row-action className="text-left font-mono text-xs">
                      <InlineProductCell
                        productId={p.id}
                        field="baseSku"
                        fieldType="text"
                        initialValue={p.base_sku ?? ""}
                        displayValue={p.base_sku ?? "—"}                        inputWidth="w-32"
                        displayClassName={
                          p.base_sku ? "" : "text-muted-foreground/60"
                        }
                      />
                    </td>
                    <td data-row-action className="text-center tabular-nums">
                      <InlineProductCell
                        productId={p.id}
                        field="basePrice"
                        fieldType="number"
                        step={0.01}
                        min={0}
                        initialValue={String(p.base_price)}
                        displayValue={formatCurrency(
                          Number(p.base_price),
                          p.currency
                        )}                        inputWidth="w-24"
                      />
                    </td>
                    <td className="text-center">
                      {extras?.margin ? (
                        <span className="flex flex-col items-center leading-tight">
                          <span className="font-mono tabular-nums text-sm">
                            {extras.margin.percent.toFixed(1)}%
                          </span>
                          <span
                            className={`text-[10px] font-mono tabular-nums ${
                              extras.margin.amount >= 0
                                ? "text-emerald-700"
                                : "text-red-700"
                            }`}
                          >
                            {extras.margin.amount >= 0 ? "+" : ""}
                            {formatCurrency(
                              extras.margin.amount,
                              extras.margin.currency
                            )}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td className="text-center">
                      {extras?.avgSupplierCost ? (
                        <span className="flex flex-col items-center leading-tight">
                          <span className="font-mono tabular-nums text-sm">
                            {formatCurrency(
                              extras.avgSupplierCost.amount,
                              extras.avgSupplierCost.currency
                            )}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {extras.avgSupplierCost.supplier_count}{" "}
                            {extras.avgSupplierCost.supplier_count === 1
                              ? "πάροχος"
                              : "πάροχοι"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td data-row-action className="text-left max-w-[180px]">
                      <InlineSupplierCell
                        productId={p.id}
                        currentSupplierId={
                          extras?.preferredSupplier?.id ?? null
                        }
                        currentSupplierName={
                          extras?.preferredSupplier?.name ?? null
                        }
                        suppliers={suppliers}                      />
                    </td>
                    <td data-row-action className="text-left max-w-[220px]">
                      <InlineCategoriesCell
                        productId={p.id}
                        currentCategoryIds={(extras?.categories ?? []).map(
                          (c) => c.id
                        )}
                        currentCategoryNames={(extras?.categories ?? []).map(
                          (c) => c.name
                        )}
                        autoCategoryNames={(extras?.autoCategories ?? []).map(
                          (c) => c.name
                        )}
                        categories={categories}                      />
                    </td>
                    <td data-row-action className="text-left max-w-[140px]">
                      <InlineVolumetricCell
                        productId={p.id}
                        currentPrefixId={p.volumetric_prefix_id}
                        currentPrefixName={
                          volumetricPrefixesTable.find(
                            (vp) => vp.id === p.volumetric_prefix_id
                          )?.display_name ?? null
                        }
                        prefixes={volumetricPrefixesTable}                      />
                    </td>
                    <td data-row-action>
                      <div className="flex items-center justify-center gap-1.5">
                        <ProductDeleteButton
                          id={p.id}
                          productName={p.name}
                          variant="compact"
                        />
                      </div>
                    </td>
                  </ProductTableRow>
                );
              })}
            </tbody>
          </table>
        </div>

        {products.length === 0 && (
          <div className="cms-empty mt-4">Δεν υπάρχουν προϊόντα.</div>
        )}

        <Pagination page={page} pageSize={pageSize} total={total} preserveParams={preserveParams} />

        {/* Always mounted so the close animation can play. The panel owns
            its own open state (PanelControllerContext) and fetches its
            content via server actions. Lives INSIDE SelectionProvider so
            the edge indicator can read the current selection when opening
            the all-variants view. `filterParams` lets that view mirror the
            table's active filters. */}
        <ProductDetailPanel
          filterParams={filters}
          pageProductIds={products.map((p) => p.id)}
        />
      </SelectionProvider>
      </BulkPropagationProvider>
    </PanelControllerProvider>
  );
}

/* ── Per-row extras data fetcher ───────────────────────────────────── */

interface ProductExtras {
  margin: { percent: number; amount: number; currency: string } | null;
  avgSupplierCost: {
    amount: number;
    currency: string;
    supplier_count: number;
  } | null;
  preferredSupplier: { id: string; name: string } | null;
  /** Manually-assigned categories (product_categories rows). Editable. */
  categories: Array<{ id: string; name: string }>;
  /** Dynamic (auto-rule) categories the product currently resolves into.
   *  Read-only — membership is rule-derived, not stored. */
  autoCategories: Array<{ id: string; name: string }>;
}

/**
 * Batched fetcher for the four per-row admin columns that need data
 * outside the products table itself: margin, avg supplier cost,
 * preferred supplier, and categories. 4 queries total regardless of
 * page size — calling getProductSupplierSummary per-product would cost
 * 2N queries and saturate the connection pool on bigger page sizes.
 *
 * Margin and cost resolution mirror the edit page's overview tab:
 *   1. Preferred supplier's uniform same-currency cost
 *   2. products.cost_price (if same-currency)
 *   3. Otherwise margin is null
 */
async function fetchProductsExtras(
  supabase: Awaited<ReturnType<typeof createClient>>,
  products: Product[]
): Promise<Map<string, ProductExtras>> {
  const result = new Map<string, ProductExtras>();
  if (products.length === 0) return result;

  const productIds = products.map((p) => p.id);

  // Dynamic (auto-rule) category memberships — resolved, not stored.
  const autoCatsByProduct = await resolveAutoCategories(supabase, productIds);

  // Product-level default-supplier names — the "preferred" fallback for
  // products whose variants haven't been created yet (the default seeds
  // them on creation; until then it's the intended preferred supplier).
  const defaultSupplierIds = Array.from(
    new Set(
      products.map((p) => p.default_supplier_id).filter((id): id is string => !!id)
    )
  );
  const defaultSupplierNames = new Map<string, string>();
  if (defaultSupplierIds.length > 0) {
    const { data: defSup } = await supabase
      .from("suppliers")
      .select("id, name")
      .in("id", defaultSupplierIds);
    for (const s of (defSup ?? []) as Array<{ id: string; name: string }>) {
      defaultSupplierNames.set(s.id, s.name);
    }
  }

  // Phase 1: variants list + category joins + vat_rates, in parallel.
  const [variantsRes, productCatsRes, vatRatesRes] = await Promise.all([
    supabase
      .from("product_variants")
      .select("id, product_id")
      .in("product_id", productIds),
    supabase
      .from("product_categories")
      .select("product_id, categories(id, name, vat_rate_id)")
      .in("product_id", productIds),
    supabase.from("vat_rates").select("*").order("rate"),
  ]);

  const variantRows = (variantsRes.data ?? []) as Array<{
    id: string;
    product_id: string;
  }>;
  const productIdByVariant = new Map<string, string>();
  for (const v of variantRows) productIdByVariant.set(v.id, v.product_id);

  // Phase 2: supplier_products joined to suppliers, scoped to all
  // variants of the visible products in one shot.
  type SpRow = {
    variant_id: string;
    supplier_id: string;
    is_preferred: boolean;
    unit_cost: number | string | null;
    unit_cost_currency: string | null;
    suppliers:
      | { id: string; name: string; default_currency: string }
      | Array<{ id: string; name: string; default_currency: string }>
      | null;
  };
  let spRows: SpRow[] = [];
  const allVariantIds = variantRows.map((v) => v.id);
  if (allVariantIds.length > 0) {
    const { data } = await supabase
      .from("supplier_products")
      .select(
        "variant_id, supplier_id, is_preferred, unit_cost, unit_cost_currency, suppliers!inner(id, name, default_currency)"
      )
      .in("variant_id", allVariantIds);
    spRows = (data ?? []) as SpRow[];
  }

  // Group supplier_products rows by product_id.
  const spByProduct = new Map<string, SpRow[]>();
  for (const sp of spRows) {
    const productId = productIdByVariant.get(sp.variant_id);
    if (!productId) continue;
    const arr = spByProduct.get(productId) ?? [];
    arr.push(sp);
    spByProduct.set(productId, arr);
  }

  // Group categories by product_id, keeping the (id, name, vat_rate_id) shape.
  type CategoryJoined = {
    id: string;
    name: string;
    vat_rate_id: string | null;
  };
  const catsByProduct = new Map<string, CategoryJoined[]>();
  for (const row of (productCatsRes.data ?? []) as Array<{
    product_id: string;
    categories: unknown;
  }>) {
    const cat = Array.isArray(row.categories)
      ? row.categories[0]
      : row.categories;
    if (!cat) continue;
    const typed = cat as CategoryJoined;
    const arr = catsByProduct.get(row.product_id) ?? [];
    arr.push(typed);
    catsByProduct.set(row.product_id, arr);
  }

  const vatRates = (vatRatesRes.data ?? []) as VatRate[];

  // Per-product aggregation + computation.
  for (const product of products) {
    const spForProduct = spByProduct.get(product.id) ?? [];

    // Collapse (supplier × variant) rows into a per-supplier summary.
    type SupplierSummary = {
      supplier_id: string;
      supplier_name: string;
      is_preferred: boolean;
      default_unit_cost: number | null;
      default_unit_cost_currency: string | null;
      cost_is_mixed: boolean;
    };
    const bySupplier = new Map<string, SpRow[]>();
    for (const sp of spForProduct) {
      const arr = bySupplier.get(sp.supplier_id) ?? [];
      arr.push(sp);
      bySupplier.set(sp.supplier_id, arr);
    }
    const supplierSummary: SupplierSummary[] = [];
    for (const [supplierId, group] of bySupplier) {
      const first = group[0];
      const supplierObj = Array.isArray(first.suppliers)
        ? first.suppliers[0]
        : first.suppliers;
      if (!supplierObj) continue;
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
      const allPreferred = group.every((g) => g.is_preferred);
      supplierSummary.push({
        supplier_id: supplierId,
        supplier_name: supplierObj.name,
        is_preferred: allPreferred,
        default_unit_cost: defaultCost,
        default_unit_cost_currency: defaultCcy,
        cost_is_mixed: costIsMixed,
      });
    }

    // VAT resolution.
    const cats = catsByProduct.get(product.id) ?? [];
    const resolvedVat = resolveEffectiveVatRate(
      { vat_rate_id: product.vat_rate_id ?? null },
      cats.map((c) => ({ id: c.id, vat_rate_id: c.vat_rate_id })),
      vatRates
    );

    // Cost resolution chain.
    const preferredWithCost = supplierSummary.find(
      (s) =>
        s.is_preferred &&
        s.default_unit_cost !== null &&
        !s.cost_is_mixed &&
        s.default_unit_cost_currency === product.currency
    );
    let cost: number | null = null;
    if (preferredWithCost) {
      cost = preferredWithCost.default_unit_cost;
    } else if (
      product.cost_price !== null &&
      product.cost_price !== undefined &&
      (!product.cost_currency || product.cost_currency === product.currency)
    ) {
      cost = Number(product.cost_price);
    }

    let margin: ProductExtras["margin"] = null;
    if (cost !== null && resolvedVat) {
      const m = computeMargin(
        Number(product.base_price),
        cost,
        resolvedVat.rate.rate
      );
      margin = {
        percent: m.marginPercent * 100,
        amount: m.marginAmount,
        currency: product.currency,
      };
    }

    let avgSupplierCost: ProductExtras["avgSupplierCost"] = null;
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
        currency: product.currency,
        supplier_count: validCosts.length,
      };
    }

    const preferredRow = supplierSummary.find((s) => s.is_preferred);
    let preferredSupplier = preferredRow
      ? { id: preferredRow.supplier_id, name: preferredRow.supplier_name }
      : null;
    // Fallback to the product-level default supplier (the template that
    // seeds variants) when no per-variant preferred exists yet.
    if (!preferredSupplier && product.default_supplier_id) {
      const name = defaultSupplierNames.get(product.default_supplier_id);
      if (name) preferredSupplier = { id: product.default_supplier_id, name };
    }

    result.set(product.id, {
      margin,
      avgSupplierCost,
      preferredSupplier,
      categories: cats.map((c) => ({ id: c.id, name: c.name })),
      autoCategories: autoCatsByProduct.get(product.id) ?? [],
    });
  }

  return result;
}
