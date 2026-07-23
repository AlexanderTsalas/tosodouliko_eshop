import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { resolveLowStockBuckets } from "@/lib/suppliers/resolveLowStockBuckets";
import UnassignedBanner from "@/components/admin/supply-orders/UnassignedBanner";
import MultiSourceBucket from "@/components/admin/supply-orders/MultiSourceBucket";
import SupplierDraftSection, {
  type DraftSectionData,
} from "@/components/admin/supply-orders/SupplierDraftSection";
import TrackingList, { type TrackingRow } from "@/components/admin/supply-orders/TrackingList";
import Pagination from "@/components/admin/common/Pagination";
import type { Supplier, SupplyOrder, SupplyOrderLine, SupplyOrderStatus } from "@/types/suppliers";
import { requirePermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

export const metadata = { title: "Παραγγελίες προμηθειών — Admin" };

type View = "drafts" | "tracking";

function isView(v: string | undefined): v is View {
  return v === "drafts" || v === "tracking";
}

function isFilter(s: string | undefined): s is SupplyOrderStatus | "all" {
  return s === "all" || s === "placed" || s === "received" || s === "cancelled";
}

export default async function SupplyOrdersPage(
  props: {
    searchParams: Promise<{ view?: string; filter?: string; page?: string; pageSize?: string }>;
  }
) {
  await requirePermission("manage:suppliers");
  const searchParams = await props.searchParams;
  const view: View = isView(searchParams.view) ? searchParams.view : "drafts";
  const supabase = await createClient();

  if (view === "tracking") {
    const filter: SupplyOrderStatus | "all" = isFilter(searchParams.filter)
      ? searchParams.filter
      : "all";

    const page = Math.max(1, Number(searchParams.page ?? 1));
    const requestedSize = Number(searchParams.pageSize ?? DEFAULT_PAGE_SIZE);
    const pageSize = ALLOWED_PAGE_SIZES.includes(requestedSize)
      ? requestedSize
      : DEFAULT_PAGE_SIZE;
    const pageStart = (page - 1) * pageSize;
    const pageEnd = pageStart + pageSize - 1;

    // Server-side pagination via .range() + count: 'exact'. Previously
    // fetched ALL non-draft orders unbounded then paginated in JS,
    // which froze the page once the dataset grew past a few thousand
    // orders. Phase 5 of the data-layer remediation.
    let rowsQuery = supabase
      .from("supply_orders")
      .select(
        "*, suppliers(*), supply_order_lines(ordered_qty, unit_cost, unit_cost_currency)",
        { count: "exact" }
      )
      .neq("status", "draft")
      .order("created_at", { ascending: false });
    if (filter !== "all") rowsQuery = rowsQuery.eq("status", filter);
    rowsQuery = rowsQuery.range(pageStart, pageEnd);

    // Status-tab badge counts via four head-only queries running in
    // parallel with the visible page query. Five round-trips total,
    // any one of which is fast.
    const [rowsRes, allCountRes, placedCountRes, receivedCountRes, cancelledCountRes] =
      await Promise.all([
        rowsQuery,
        supabase
          .from("supply_orders")
          .select("id", { count: "exact", head: true })
          .neq("status", "draft"),
        supabase
          .from("supply_orders")
          .select("id", { count: "exact", head: true })
          .eq("status", "placed"),
        supabase
          .from("supply_orders")
          .select("id", { count: "exact", head: true })
          .eq("status", "received"),
        supabase
          .from("supply_orders")
          .select("id", { count: "exact", head: true })
          .eq("status", "cancelled"),
      ]);

    type RawRow = SupplyOrder & {
      suppliers: Supplier | Supplier[] | null;
      supply_order_lines:
        | Array<{ ordered_qty: number; unit_cost: number | null; unit_cost_currency: string | null }>
        | null;
    };

    const pagedRows: TrackingRow[] = ((rowsRes.data ?? []) as RawRow[])
      .map((r) => {
        const supplier = Array.isArray(r.suppliers) ? r.suppliers[0] : r.suppliers;
        const lines = r.supply_order_lines ?? [];
        let totalCost = 0;
        const currencies = new Set<string>();
        for (const l of lines) {
          totalCost += (Number(l.unit_cost) || 0) * l.ordered_qty;
          if (l.unit_cost_currency) currencies.add(l.unit_cost_currency);
        }
        const { suppliers: _s, supply_order_lines: _l, ...orderOnly } = r;
        return {
          order: orderOnly as SupplyOrder,
          supplier: supplier as Supplier,
          lineCount: lines.length,
          totalCost,
          totalCurrency:
            currencies.size === 1
              ? Array.from(currencies)[0]
              : supplier?.default_currency ?? "EUR",
        };
      })
      .filter((r) => r.supplier);

    const statusCounts = {
      all: allCountRes.count ?? 0,
      placed: placedCountRes.count ?? 0,
      received: receivedCountRes.count ?? 0,
      cancelled: cancelledCountRes.count ?? 0,
    };
    const totalForFilter = rowsRes.count ?? 0;

    return (
      <>
        <Header active="tracking" />
        <div className="space-y-4">
          <TrackingList rows={pagedRows} filter={filter} statusCounts={statusCounts} />
          <Pagination
            page={page}
            pageSize={pageSize}
            total={totalForFilter}
            preserveParams={{ view: "tracking", filter }}
          />
        </div>
      </>
    );
  }

  // --- Drafts view ---

  const buckets = await resolveLowStockBuckets();

  // Active supplier list for the "unassigned" inline assignment dropdowns.
  // Loaded here (server-side) so the UnassignedBanner can render
  // synchronously without a client-side fetch.
  const { data: activeSuppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("active", true)
    .order("name");

  // Load all open drafts + their lines + supplier metadata.
  const { data: openDrafts } = await supabase
    .from("supply_orders")
    .select("*, suppliers(*), supply_order_lines(*)")
    .eq("status", "draft")
    .order("created_at", { ascending: false });

  type RawDraft = SupplyOrder & {
    suppliers: Supplier | Supplier[] | null;
    supply_order_lines: SupplyOrderLine[] | null;
  };

  // Group by supplier_id; merge with auto-suggestions from buckets.bySupplier.
  const sectionsBySupplier = new Map<string, DraftSectionData>();

  for (const draftRaw of (openDrafts ?? []) as RawDraft[]) {
    const supplier = Array.isArray(draftRaw.suppliers) ? draftRaw.suppliers[0] : draftRaw.suppliers;
    if (!supplier) continue;
    const lines = (draftRaw.supply_order_lines ?? []) as SupplyOrderLine[];
    const { suppliers: _s, supply_order_lines: _l, ...draftWithoutJoins } = draftRaw;
    sectionsBySupplier.set(supplier.id, {
      supplier,
      draft: draftWithoutJoins as SupplyOrder,
      lines,
      placedLines: buckets.placedBySupplier.get(supplier.id) ?? [],
      suggestions: buckets.bySupplier.get(supplier.id) ?? [],
    });
  }

  // Any supplier that has suggestions OR placed lines (but no draft yet)
  // still gets a section so the admin sees the awaiting-delivery info.
  const supplierIdsWithoutDraft = new Set<string>();
  for (const supplierId of buckets.bySupplier.keys()) {
    if (!sectionsBySupplier.has(supplierId)) supplierIdsWithoutDraft.add(supplierId);
  }
  for (const supplierId of buckets.placedBySupplier.keys()) {
    if (!sectionsBySupplier.has(supplierId)) supplierIdsWithoutDraft.add(supplierId);
  }

  // Bulk-fetch suppliers in ONE round-trip via .in() instead of looping
  // a .maybeSingle() per id. Phase 5 of the data-layer remediation.
  // For 10 suppliers without drafts this is 10 round-trips → 1.
  const relevantSupplierIds = Array.from(supplierIdsWithoutDraft).filter(
    (id) =>
      (buckets.bySupplier.get(id)?.length ?? 0) > 0 ||
      (buckets.placedBySupplier.get(id)?.length ?? 0) > 0
  );
  if (relevantSupplierIds.length > 0) {
    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("*")
      .in("id", relevantSupplierIds);
    for (const supplier of (suppliers ?? []) as Supplier[]) {
      sectionsBySupplier.set(supplier.id, {
        supplier,
        draft: null,
        lines: [],
        placedLines: buckets.placedBySupplier.get(supplier.id) ?? [],
        suggestions: buckets.bySupplier.get(supplier.id) ?? [],
      });
    }
  }

  const sections = Array.from(sectionsBySupplier.values()).sort((a, b) =>
    a.supplier.name.localeCompare(b.supplier.name)
  );

  const draftCount = Array.from(sectionsBySupplier.values()).filter((s) => s.draft !== null).length;
  const suggestionCount = Array.from(sectionsBySupplier.values()).reduce(
    (acc, s) => acc + s.suggestions.length,
    0
  );

  return (
    <>
      <Header active="drafts" />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <div className="cms-card">
          <p className="text-xs text-muted-foreground font-medium">
            Ανοιχτά drafts
          </p>
          <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
            {draftCount}
          </p>
        </div>
        <div className="cms-card">
          <p className="text-xs text-muted-foreground font-medium">
            Προς προσθήκη
          </p>
          <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
            {suggestionCount}
          </p>
        </div>
        <div className="cms-card">
          <p className="text-xs text-muted-foreground font-medium">
            Χρειάζονται απόφαση
          </p>
          <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
            {buckets.multiSource.length}
          </p>
        </div>
      </div>

      <UnassignedBanner
        items={buckets.unassigned}
        suppliers={
          ((activeSuppliers ?? []) as Array<{ id: string; name: string }>)
        }
      />

      <div className="space-y-4">
        {buckets.multiSource.length > 0 && (
          <MultiSourceBucket items={buckets.multiSource} />
        )}

        {sections.length === 0 && buckets.multiSource.length === 0 && buckets.unassigned.length === 0 ? (
          <div className="cms-empty">
            Κανένα προϊόν δεν είναι κάτω από το όριο. Όλα τα drafts είναι κενά.
          </div>
        ) : (
          sections.map((s) => <SupplierDraftSection key={s.supplier.id} data={s} />)
        )}
      </div>
    </>
  );
}

function Header({ active }: { active: View }) {
  return (
    <>
      <PageHeader
        eyebrow="Προμηθευτές"
        title="Παραγγελίες προμηθειών"
        description="Διαχειριστείτε drafts προς αποστολή στους προμηθευτές σας και παρακολουθήστε όσες έχουν ήδη παραγγελθεί."
      />
      <nav
        className="border-b border-foreground/10 mb-6 flex flex-wrap gap-1"
        aria-label="Καρτέλες"
      >
        <Link
          href="/admin/supply-orders?view=drafts"
          className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
            active === "drafts"
              ? "border-foreground text-foreground font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30"
          }`}
          aria-current={active === "drafts" ? "page" : undefined}
        >
          Drafts
        </Link>
        <Link
          href="/admin/supply-orders?view=tracking"
          className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
            active === "tracking"
              ? "border-foreground text-foreground font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30"
          }`}
          aria-current={active === "tracking" ? "page" : undefined}
        >
          Παρακολούθηση
        </Link>
      </nav>
    </>
  );
}
