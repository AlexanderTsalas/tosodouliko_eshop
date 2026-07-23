import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import InventoryRow from "@/components/admin/inventory/InventoryRow";
import ProductThumbnailStack from "@/components/admin/products/ProductThumbnailStack";
import { resolveProductImageUrls } from "@/lib/media/resolveProductImageUrl";
import type { ProductImage } from "@/types/products";
import CatalogFilterBar, {
  type FilterSlot,
} from "@/components/admin/common/CatalogFilterBar";
import SelectionCheckbox from "@/components/admin/common/SelectionCheckbox";
import SelectAllHeaderCheckbox from "@/components/admin/common/SelectAllHeaderCheckbox";
import SelectionActionBar from "@/components/admin/common/SelectionActionBar";
import SelectionProvider from "@/components/admin/common/SelectionContext";
import InventoryBulkActions from "@/components/admin/inventory/InventoryBulkActions";
import DraftToggleToastProvider from "@/components/admin/inventory/DraftToggleToast";
import Pagination from "@/components/admin/common/Pagination";
import { parseSelection } from "@/lib/bulk-selection/selectionUrl";
import type { Category } from "@/types/category-navigation";
import type { Supplier } from "@/types/suppliers";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Απόθεμα — Admin" };

// Admin page — always fetch fresh. Router Cache otherwise persists the
// previous draftedVariantIds snapshot for ~30s after a tab switch, which is
// exactly the window where admins toggle draft membership from the
// supply-orders side and come back here expecting the buttons to reflect it.
export const dynamic = "force-dynamic";

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100, 250, 500];
const DEFAULT_PAGE_SIZE = 25;

// Pre-Phase-5 this page had MAX_FETCH=2000 with JS-side filter +
// pagination. Now uses inventory_with_product_status view with
// server-side .range() + .eq() filters. No more silent truncation.

interface InventoryRowData {
  inventory_id: string;
  variant_id: string;
  quantity_available: number;
  quantity_reserved: number;
  quantity_soft_held: number;
  quantity_priority_held: number;
  low_stock_threshold: number;
  sku: string;
  attribute_combo: Record<string, string> | null;
  track_supply: boolean;
  variant_active: boolean;
  product_id: string;
  product_name: string;
  product_active: boolean;
  stock_status: "untracked" | "ok" | "low" | "out";
}

export default async function AdminInventoryPage(
  props: {
    searchParams: Promise<{
      q?: string;
      status?: string;
      categoryId?: string;
      supplierId?: string;
      trackSupply?: string;
      selected?: string;
      matchAll?: string;
      page?: string;
      pageSize?: string;
    }>;
  }
) {
  await requirePermission("manage:products");
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const q = searchParams.q?.trim() ?? "";
  const status = searchParams.status ?? "";
  const categoryId = searchParams.categoryId ?? "";
  const supplierId = searchParams.supplierId ?? "";
  const trackSupply = searchParams.trackSupply ?? "";

  const selection = parseSelection(searchParams);
  const filterParams = { q, status, categoryId, supplierId, trackSupply };

  const page = Math.max(1, Number(searchParams.page ?? 1));
  const requestedSize = Number(searchParams.pageSize ?? DEFAULT_PAGE_SIZE);
  const pageSize = ALLOWED_PAGE_SIZES.includes(requestedSize) ? requestedSize : DEFAULT_PAGE_SIZE;

  // Dropdown options for the filter bar.
  const [categoriesRes, suppliersRes] = await Promise.all([
    supabase.from("categories").select("id, name").eq("active", true).order("name"),
    supabase.from("suppliers").select("id, name").eq("active", true).order("name"),
  ]);
  const categories = (categoriesRes.data ?? []) as Pick<Category, "id" | "name">[];
  const suppliers = (suppliersRes.data ?? []) as Pick<Supplier, "id" | "name">[];

  // Category/supplier filters reduce to a product_id restriction.
  let productIdRestriction: string[] | null = null;
  if (categoryId) {
    const { data: pcRows } = await supabase
      .from("product_categories")
      .select("product_id")
      .eq("category_id", categoryId);
    productIdRestriction = ((pcRows ?? []) as Array<{ product_id: string }>).map((r) => r.product_id);
    if (productIdRestriction.length === 0) productIdRestriction = ["__none__"];
  }
  if (supplierId) {
    const [{ data: defaults }, { data: links }] = await Promise.all([
      supabase.from("products").select("id").eq("default_supplier_id", supplierId),
      supabase
        .from("supplier_products")
        .select("product_variants!inner(product_id)")
        .eq("supplier_id", supplierId),
    ]);
    const set = new Set<string>();
    for (const r of (defaults ?? []) as Array<{ id: string }>) set.add(r.id);
    for (const r of (links ?? []) as Array<{
      product_variants: { product_id: string } | { product_id: string }[] | null;
    }>) {
      const pv = Array.isArray(r.product_variants) ? r.product_variants[0] : r.product_variants;
      if (pv?.product_id) set.add(pv.product_id);
    }
    const list = Array.from(set);
    if (productIdRestriction) {
      const cat = new Set(productIdRestriction);
      productIdRestriction = list.filter((id) => cat.has(id));
    } else {
      productIdRestriction = list;
    }
    if (productIdRestriction.length === 0) productIdRestriction = ["__none__"];
  }

  // Server-side range pagination via the inventory_with_product_status
  // view. The view already filters to active variants +
  // active products at the SQL level via the joins; stock_status is
  // pre-computed so the status filter is a single .eq() instead of a
  // post-fetch JS scan.
  const pageStart = (page - 1) * pageSize;
  const pageEnd = pageStart + pageSize - 1;

  let query = supabase
    .from("inventory_with_product_status")
    .select(
      "inventory_id, variant_id, quantity_available, quantity_reserved, quantity_soft_held, quantity_priority_held, low_stock_threshold, sku, attribute_combo, track_supply, variant_active, product_id, product_name, product_active, stock_status",
      { count: "exact" }
    )
    .eq("variant_active", true)
    .eq("product_active", true)
    .order("inventory_updated_at", { ascending: false });

  if (q) {
    const term = `%${q.replace(/[%_]/g, "\\$&")}%`;
    query = query.ilike("sku", term);
  }
  if (trackSupply === "yes") {
    query = query.eq("track_supply", true);
  } else if (trackSupply === "no") {
    query = query.eq("track_supply", false);
  }
  if (productIdRestriction) {
    query = query.in("product_id", productIdRestriction);
  }
  if (status === "out" || status === "low" || status === "ok") {
    query = query.eq("stock_status", status);
  }

  query = query.range(pageStart, pageEnd);
  const { data, count } = await query;
  const pagedRows = ((data ?? []) as unknown) as InventoryRowData[];

  // Batch-load product images for the products on this page — mirrors
  // the products-table thumbnail stack so the operator sees what they
  // manage stock for at a glance.
  const productIdsOnPage = Array.from(
    new Set(pagedRows.map((r) => r.product_id))
  );
  const imagesByProduct = new Map<string, ProductImage[]>();
  if (productIdsOnPage.length > 0) {
    const { data: imageRows } = await supabase
      .from("product_images")
      .select("*")
      .in("product_id", productIdsOnPage)
      .order("is_cover", { ascending: false })
      .order("display_order");
    const all = (imageRows ?? []) as ProductImage[];
    const resolved = await resolveProductImageUrls(all);
    for (const img of resolved) {
      const list = imagesByProduct.get(img.product_id) ?? [];
      list.push(img);
      imagesByProduct.set(img.product_id, list);
    }
  }

  const slots: FilterSlot[] = [
    { type: "search", key: "q", placeholder: "Αναζήτηση SKU..." },
    {
      type: "select",
      key: "status",
      label: "Κατάσταση",
      anyLabel: "Όλα",
      options: [
        { value: "ok", label: "Διαθέσιμο" },
        { value: "low", label: "Χαμηλό" },
        { value: "out", label: "Άδειο" },
      ],
    },
    {
      type: "select",
      key: "categoryId",
      label: "Κατηγορία",
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    },
    {
      type: "select",
      key: "supplierId",
      label: "Προμηθευτής",
      options: suppliers.map((s) => ({ value: s.id, label: s.name })),
    },
    {
      type: "select",
      key: "trackSupply",
      label: "Παρακολούθηση",
      anyLabel: "Όλα",
      options: [
        { value: "yes", label: "Ναι" },
        { value: "no", label: "Όχι" },
      ],
    },
  ];

  // Total matches the .range() result count from the view query
  // above. The exact count is reliable because filters are applied in
  // SQL (no post-pagination JS filter).
  const totalFiltered = count ?? 0;
  const pageVariantIds = pagedRows.map((r) => r.variant_id);

  // Which variants are currently on ANY open draft.
  //
  // Query from supply_orders (top-level filter on status='draft') and traverse
  // via the reverse FK to supply_order_lines. The previous version did the
  // opposite — supply_order_lines -> supply_orders!inner(status) with a JS
  // status filter — which silently returned an incomplete set when PostgREST
  // couldn't resolve the embedded-resource shape for some rows, leaving the
  // inventory tab showing "+draft" for variants that ARE on drafts. This
  // direction is straightforward to reason about and lets us surface any
  // PostgREST error to the server log.
  // Compute the supply-order state of each variant we're about to render.
  // Draft takes priority — if the variant is on both a draft and a placed
  // order, it should still expose the -draft remove action.
  const draftedVariantIds = new Set<string>();
  const placedVariantIds = new Set<string>();
  const { data: openOrders, error: openErr } = await supabase
    .from("supply_orders")
    .select("id, status, supply_order_lines(variant_id)")
    .in("status", ["draft", "placed"]);
  if (openErr) {
    console.error(
      "[admin/inventory] supply-order state query failed:",
      openErr.message,
      openErr
    );
  }
  for (const order of ((openOrders ?? []) as Array<{
    id: string;
    status: "draft" | "placed";
    supply_order_lines: Array<{ variant_id: string }> | { variant_id: string } | null;
  }>)) {
    const lines = Array.isArray(order.supply_order_lines)
      ? order.supply_order_lines
      : order.supply_order_lines
        ? [order.supply_order_lines]
        : [];
    const target = order.status === "draft" ? draftedVariantIds : placedVariantIds;
    for (const line of lines) target.add(line.variant_id);
  }

  // Resolve attribute_combo UUIDs into display labels for the paged rows.
  const valueIdsOnPage = new Set<string>();
  for (const r of pagedRows) {
    const combo = r.attribute_combo;
    if (!combo) continue;
    for (const valueId of Object.values(combo)) valueIdsOnPage.add(valueId);
  }
  const valueDisplayById = new Map<string, string>();
  if (valueIdsOnPage.size > 0) {
    const { data: vRows } = await supabase
      .from("attribute_values")
      .select("id, value")
      .in("id", Array.from(valueIdsOnPage));
    for (const v of (vRows ?? []) as Array<{ id: string; value: string }>) {
      valueDisplayById.set(v.id, v.value);
    }
  }

  return (
    <>
      <PageHeader
        title="Απόθεμα"
        description={`${totalFiltered.toLocaleString("el-GR")} παραλλαγές. Φιλτράρετε ανά κατάσταση και ενημερώστε ποσότητες ή όρια.`}
      />

      <details className="cms-accordion-details mb-4 rounded-lg border border-foreground/10 bg-muted/20 p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Πώς διαβάζω αυτή τη σελίδα; — εξήγηση των στηλών αποθέματος
        </summary>
        <div className="cms-accordion-body">
        <div className="mt-3 space-y-2 text-muted-foreground">
          <p>
            Η εφαρμογή χωρίζει το απόθεμα σε τέσσερα «κουτιά» για να
            παρακολουθεί τα ενεργά καλάθια και τις παραγγελίες:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong className="text-foreground">Διαθέσιμα</strong> — τεμάχια
              ελεύθερα προς πώληση αυτή τη στιγμή. Αυτή είναι η στήλη που
              αλλάζετε όταν κάνετε καταμέτρηση αποθέματος.
            </li>
            <li>
              <strong className="text-foreground">Δεσμευμένα</strong> — τεμάχια
              που χρωστάτε σε εκκρεμείς παραγγελίες (έχουν παραγγελθεί από
              πελάτες, περιμένουν εκπλήρωση).
            </li>
            <li>
              <strong className="text-foreground">Σε ενεργή αγορά</strong> —
              τεμάχια που έχουν ήδη ξεκινήσει checkout από πελάτη και
              βρίσκονται σε διαδικασία πληρωμής αυτή τη στιγμή (όχι όσα απλώς
              κάθονται σε καλάθια — αυτά δεν δεσμεύουν απόθεμα). Θα
              ολοκληρωθούν ή θα ακυρωθούν αυτόματα εντός 15&nbsp;λεπτών.
            </li>
            <li>
              <strong className="text-foreground">Όριο</strong> — όταν τα
              διαθέσιμα πέσουν σε ή κάτω από αυτόν τον αριθμό, η παραλλαγή
              σημαδεύεται «Χαμηλό απόθεμα».
            </li>
          </ul>
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
            ⚠ <strong>Προσοχή:</strong> όταν αλλάζετε τα «Διαθέσιμα» ενώ η
            στήλη «Σε ενεργή αγορά» δείχνει αριθμό &gt; 0, μπορεί να
            δημιουργηθούν φανταστικά τεμάχια στη λογιστική. Η εφαρμογή θα σας
            προειδοποιήσει πριν αποθηκεύσετε, αλλά σιγουρευτείτε ότι ο νέος
            αριθμός αντικατοπτρίζει τα τεμάχια που έχετε πραγματικά.
          </p>
        </div>
        </div>
      </details>

      <CatalogFilterBar
        slots={slots}
        values={{ q, status, categoryId, supplierId, trackSupply }}
      />

      <SelectionProvider
        initialSelectedIds={selection.selectedIds}
        initialMatchAll={selection.matchAll}
      >
      <DraftToggleToastProvider>
      <SelectionActionBar
        matchAll={selection.matchAll}
        explicitCount={selection.selectedIds.length}
        totalMatchingCount={totalFiltered}
        pageCount={pagedRows.length}
      >
        <InventoryBulkActions
          matchAll={selection.matchAll}
          selectedIds={selection.selectedIds}
          filterParams={filterParams}
          draftedVariantIds={Array.from(draftedVariantIds)}
          placedVariantIds={Array.from(placedVariantIds)}
        />
      </SelectionActionBar>

      {totalFiltered === 0 ? (
        <div className="cms-empty">Δεν υπάρχουν δεδομένα αποθέματος.</div>
      ) : (
        <div className="cms-table-wrap mt-3">
        {/* Adopting the shared cms-table class so row separators (via
            td border-top) and hover state come from the same source as
            the products table. */}
        <table className="cms-table">
          <thead>
            <tr>
              <th className="py-2 pl-3 pr-2 w-10 align-middle">
                <SelectAllHeaderCheckbox pageIds={pageVariantIds} />
              </th>
              <th className="py-2 px-2 w-16 align-middle">Εικόνα</th>
              <th className="py-2 px-3 align-middle text-left">Προϊόν</th>
              <th className="py-2 px-3 align-middle">Παραλλαγή</th>
              <th className="py-2 px-3 align-middle">SKU</th>
              <th className="py-2 px-3 w-24 text-center align-middle">Διαθέσιμα</th>
              <th className="py-2 px-3 w-24 text-center align-middle">Δεσμευμένα</th>
              <th
                className="py-2 px-3 w-24 text-center align-middle"
                title="Τεμάχια που βρίσκονται αυτή τη στιγμή σε ενεργή αγορά πελάτη (soft hold). Όχι όσα κάθονται απλά σε καλάθια — μόνο αυτά που έχουν ξεκινήσει checkout."
              >
                Σε ενεργή αγορά
              </th>
              <th
                className="py-2 px-3 w-24 text-center align-middle"
                title="Quantity at or below which the variant is flagged as low-stock. 0 = never."
              >
                Όριο
              </th>
              <th className="py-2 px-3 w-24 text-center align-middle">Κατάσταση</th>
              <th className="py-2 px-3 w-48 text-center align-middle">Ενέργειες</th>
              <th className="py-2 pl-3 pr-3 w-12 align-middle"></th>
            </tr>
          </thead>
          <tbody className="content-reveal">
            {pagedRows.map((r) => {
              return (
                <tr key={r.inventory_id} className="align-middle">
                  <td className="py-2 pl-3 pr-2 align-middle">
                    <SelectionCheckbox
                      id={r.variant_id}
                      ariaLabel={r.sku ?? r.variant_id}
                    />
                  </td>
                  <td className="py-2 px-2 align-middle">
                    <ProductThumbnailStack
                      images={imagesByProduct.get(r.product_id) ?? []}
                      productName={r.product_name}
                    />
                  </td>
                  <InventoryRow
                    variantId={r.variant_id}
                    sku={r.sku}
                    productName={r.product_name}
                    attributeEntries={
                      r.attribute_combo
                        ? Object.entries(r.attribute_combo).map(
                            ([slug, valueId]) => ({
                              slug,
                              label: valueDisplayById.get(valueId) ?? "(unknown)",
                            })
                          )
                        : []
                    }
                    initialAvailable={r.quantity_available}
                    initialReserved={r.quantity_reserved}
                    initialSoftHeld={r.quantity_soft_held}
                    initialPriorityHeld={r.quantity_priority_held}
                    initialThreshold={r.low_stock_threshold}
                    initialDraftState={
                      draftedVariantIds.has(r.variant_id)
                        ? "draft"
                        : placedVariantIds.has(r.variant_id)
                          ? "placed"
                          : "none"
                    }
                    tableless
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      <Pagination
        page={page}
        pageSize={pageSize}
        total={totalFiltered}
        preserveParams={{ q, status, categoryId, supplierId, trackSupply }}
      />
      </DraftToggleToastProvider>
      </SelectionProvider>
    </>
  );
}
