import ProductForm from "@/components/admin/products/ProductForm";
import ProductDeleteButton from "@/components/admin/products/ProductDeleteButton";
import ProductSuppliersSection from "@/components/admin/products/ProductSuppliersSection";
import ProductCategoriesEditor from "@/components/admin/products/ProductCategoriesEditor";
import type { Product } from "@/types/products";
import type { VatRate, ResolvedVatRate } from "@/types/vat-rates";
import type { Supplier } from "@/types/suppliers";
import type { ProductSupplierSummary } from "@/lib/suppliers/getProductSupplierSummary";
import type { VolumetricPrefix } from "@/types/volumetric";
import type { Category } from "@/types/category-navigation";

interface Props {
  product: Product;
  variantCount: number;
  totalStock: number;
  vatRates: VatRate[];
  resolvedVat: ResolvedVatRate | null;
  /** Active suppliers, for the "+ Add" dropdown. */
  allSuppliers: Supplier[];
  /** Aggregated supplier summary for this product. */
  supplierSummary: ProductSupplierSummary[];
  /** Active volumetric prefixes for the Logistics size-class picker. */
  volumetricPrefixes: VolumetricPrefix[];
  /** All active categories, for the in-overview category picker. */
  allCategories: Category[];
  /** IDs of categories the product is currently assigned to. */
  initialCategoryIds: string[];
  /** Dynamic (auto-rule) categories the product resolves into — read-only. */
  autoCategories: Array<{ id: string; name: string }>;
  /**
   * Pre-computed margin metrics for the stat tile. When `metrics`
   * is null, `missing` lists the reasons (e.g. "no cost", "no VAT")
   * so the tile can render an actionable hint.
   */
  margin: {
    metrics: { netSale: number; marginAmount: number; marginPercent: number } | null;
    missing: string[];
    costSource: "supplier" | "product_fallback" | null;
  };
  /** Pre-computed avg supplier cost across this product's suppliers
   *  (in the product's currency). null = no supplier with a valid
   *  same-currency cost. */
  avgSupplierCost: { amount: number; supplier_count: number } | null;
  globalShowWhenOosDefault: boolean;
  /**
   * When true, hides the top stat strip (margin tile, avg supplier
   * cost tile, total stock tile, delete button). Used in panel-tab
   * contexts where those metrics already live in the products table
   * — no need to duplicate them inside the overview body.
   */
  hideStatStrip?: boolean;
  /** Forwarded to ProductForm — fires after a successful save so the host
   *  panel can refetch (re-validating the draft footer). */
  onSaved?: () => void;
}

/**
 * Product overview — the first tab on the edit page. Composition:
 *
 *   1. Stat tiles — read-only summary cards (variants, stock, status, VAT)
 *   2. Form sections (rendered by ProductForm in mode="edit"):
 *      Βασικά → Τιμολόγηση → SUPPLIERS slot → Logistics → Ορατότητα
 *
 * The Suppliers section is injected as a slot between Pricing and
 * Logistics so the cost↔price relationship is read in one continuous
 * scroll, with shipping concerns directly after. Specs live in their
 * own tab now.
 */
export default function ProductOverviewTab({
  product,
  variantCount,
  totalStock,
  vatRates,
  resolvedVat,
  allSuppliers,
  supplierSummary,
  volumetricPrefixes,
  allCategories,
  initialCategoryIds,
  autoCategories,
  margin,
  avgSupplierCost,
  globalShowWhenOosDefault,
  hideStatStrip = false,
  onSaved,
}: Props) {
  return (
    <div className="space-y-6">
      {/* Stat strip — restructured per the design pass:
            - Status / Active VAT / Variants tiles REMOVED. Status now
              renders as a chip next to the product title. VAT lives
              in the Τιμολόγηση section's picker (the "Χρήση
              προεπιλογής" label spells out the current default).
              Variant count is in the Παραλλαγές tab badge.
            - Profit margin moved LEFT and expanded to 2 grid columns
              so the EUR amount + percentage sit side-by-side at the
              same scale.
            - New "Μέσο κόστος" tile shows avg supplier cost +
              avg courier cost stacked.
            - Total stock stays as a small chip on the right. */}
      {!hideStatStrip && (
        <header className="flex items-start justify-between gap-4 flex-wrap">
          {/* Flex strip: each tile sizes to its CONTENT (no grid-
              distributed columns padding tiles out to fixed widths),
              and `items-stretch` makes the row uniform-height so the
              strip reads as one visually-symmetrical band even when
              individual tiles have different amounts of content
              (e.g. the profit-margin disclaimer is a line taller than
              the bare "0" of total stock). flex-wrap kicks in on
              narrow viewports so tiles drop to a second row instead
              of overflowing. */}
          <div className="flex flex-wrap gap-3 items-stretch flex-1">
            <ProfitMarginTile margin={margin} currency={product.currency} />
            <AvgSupplierCostTile
              avgSupplierCost={avgSupplierCost}
              currency={product.currency}
            />
            <StatTile
              label="Συνολικό απόθεμα"
              value={totalStock.toLocaleString("el-GR")}
            />
          </div>
          <ProductDeleteButton id={product.id} />
        </header>
      )}

      {resolvedVat && resolvedVat.conflictingCategoryRateIds.length > 0 && (
        <p className="rounded-md border border-foreground/30 bg-muted/30 px-3 py-2 text-xs">
          <span className="font-semibold">Προσοχή:</span> το προϊόν ανήκει σε{" "}
          {resolvedVat.conflictingCategoryRateIds.length + 1} κατηγορίες με
          διαφορετικό ΦΠΑ. Χρησιμοποιείται ο χαμηλότερος (
          {(resolvedVat.rate.rate * 100).toFixed(2)}%). Ορίστε ρητή παράκαμψη
          στην ενότητα «Τιμολόγηση» αν χρειάζεται.
        </p>
      )}

      {/* The form sections are interleaved with the Suppliers section via
          the suppliersSlot prop — ProductForm renders the slot in
          column 2 right after Τιμολόγηση. */}
      <ProductForm
        mode="edit"
        product={product}
        variantCount={variantCount}
        suppliers={allSuppliers}
        onSaved={onSaved}
        vatRates={vatRates}
        volumetricPrefixes={volumetricPrefixes}
        globalShowWhenOosDefault={globalShowWhenOosDefault}
        suppliersSlot={
          <ProductSuppliersSection
            key="suppliers-slot"
            productId={product.id}
            variantCount={variantCount}
            initial={supplierSummary}
            allSuppliers={allSuppliers}
          />
        }
        categoriesSlot={
          /* Sits at the bottom of column 2 so it lines up
             symmetrically next to the Ορατότητα section at the
             bottom of column 1.

             Explicit `key` here silences a React 19 dev-mode warning
             — when the slot element is created in this parent
             (ProductOverviewTab) and rendered conditionally in a
             child position by ProductForm, React 19's stricter
             reconciliation flags the missing key. Adding a stable
             key matches the conditional-branch contract. */
          <ProductCategoriesEditor
            key="categories-slot"
            productId={product.id}
            allCategories={allCategories}
            initialCategoryIds={initialCategoryIds}
            autoCategories={autoCategories}
          />
        }
      />
    </div>
  );
}

/**
 * Read-only metric tile with comfortable presence. Padding p-5,
 * 12px uppercase label, 2xl value, slightly softer shadow. Sized
 * to read as a proper summary card while still smaller than the
 * cms-card-section sections below.
 */
function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-foreground/10 bg-card px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_2px_8px_rgba(0,0,0,0.04)]">
      <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground leading-tight">
        {label}
      </p>
      <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums leading-none">
        {value}
      </div>
      {hint && (
        <p className="text-[11px] text-muted-foreground mt-2 leading-tight truncate">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Profit-margin metric tile, restructured per the latest design pass:
 *   - Sits at the LEFT of the metric strip and spans 2 grid columns
 *     so the EUR amount and the percentage can sit side-by-side at the
 *     SAME font size (different color tones to distinguish them — the
 *     percentage uses the standard foreground, the EUR amount uses a
 *     softer secondary tone).
 *   - The "how this was calculated" disclaimer sits at the BOTTOM of
 *     the tile as a small italic line — visible without hovering, so
 *     admins always see that VAT + supplier cost feed the number.
 *
 * Missing-data state stays compact (one dash, missing-data hint).
 */
function ProfitMarginTile({
  margin,
  currency,
}: {
  margin: {
    metrics: { netSale: number; marginAmount: number; marginPercent: number } | null;
    missing: string[];
    costSource: "supplier" | "product_fallback" | null;
  };
  currency: string;
}) {
  // Computed state — compacted per design feedback:
  //   - "(μετά ΦΠΑ)" subtitle removed; the disclaimer already explains
  //     the math, no need to double-label the heading.
  //   - "Καθαρή τιμή πώλησης" line removed from the tile — it lives
  //     in real time inside the pricing section (Τιμολόγηση) next to
  //     the price input, so the merchant sees the VAT split AT the
  //     input that produces it.
  //   - Reduced vertical padding + tighter line-heights so the tile
  //     stops dominating the metric strip.
  if (margin.metrics) {
    const pct = (margin.metrics.marginPercent * 100).toFixed(1);
    const pctTone =
      margin.metrics.marginPercent < 0.15
        ? "text-destructive"
        : "text-foreground";
    const eurTone =
      margin.metrics.marginAmount < 0 ? "text-destructive" : "text-foreground/70";
    const sourceLabel =
      margin.costSource === "supplier"
        ? "από προτιμώμενο προμηθευτή"
        : "από fallback κόστος προϊόντος";
    return (
      // No `h-full` — let the tile size to its own content. Previously
      // it stretched to match the row's tallest sibling (when the
      // combined Μέσο κόστος tile had two stacked rows), leaving
      // dead whitespace at the bottom. With siblings now compact,
      // collapsing the tile is just removing h-full + mt-auto.
      <div className="rounded-lg border border-foreground/10 bg-card px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_2px_8px_rgba(0,0,0,0.04)]">
        <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground leading-tight">
          Καθαρό περιθώριο
        </p>
        {/* Two metrics, equal font weight + size, distinct color
            tones. Tightened mt-1.5 → mt-1 + mt-2 → mt-1.5 so the
            tile hugs its content. */}
        <div className="mt-2 flex items-baseline gap-2 flex-wrap">
          <span
            className={`text-3xl font-semibold tracking-tight tabular-nums leading-none ${pctTone}`}
          >
            {pct}%
          </span>
          <span className="text-lg text-muted-foreground leading-none">·</span>
          <span
            className={`text-3xl font-semibold tracking-tight tabular-nums leading-none ${eurTone}`}
          >
            {margin.metrics.marginAmount.toFixed(2)} {currency}
          </span>
          <span className="text-xs text-muted-foreground leading-none">
            /τεμ.
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2.5 leading-snug italic">
          Μετά ΦΠΑ + κόστος {sourceLabel}.
        </p>
      </div>
    );
  }
  // Missing-data state — shows the first reason inline, additional
  // reasons (if any) in the tooltip.
  const firstMissing = margin.missing[0] ?? "λείπουν δεδομένα";
  const fullList = margin.missing.join(" · ");
  return (
    <div
      className="rounded-lg border border-foreground/10 bg-card px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_2px_8px_rgba(0,0,0,0.04)]"
      title={`Συμπληρώστε: ${fullList}`}
    >
      <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground leading-tight">
        Καθαρό περιθώριο
      </p>
      <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums leading-none text-muted-foreground">
        —
      </div>
      <p className="text-[11px] text-muted-foreground mt-2.5 leading-snug">
        Συμπληρώστε: <span className="text-foreground">{firstMissing}</span>
      </p>
    </div>
  );
}

/**
 * "Μέσο κόστος προμηθευτή" tile — average unit_cost across the
 * product's suppliers (in the product's currency). Distinct from the
 * courier-cost tile because suppliers and carriers are independent
 * concerns: one scales with sourcing decisions, the other with
 * product size/weight + carrier configuration.
 */
function AvgSupplierCostTile({
  avgSupplierCost,
  currency,
}: {
  avgSupplierCost: { amount: number; supplier_count: number } | null;
  currency: string;
}) {
  return (
    <div className="rounded-lg border border-foreground/10 bg-card px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_2px_8px_rgba(0,0,0,0.04)]">
      <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground leading-tight">
        Μέσο κόστος προμηθευτή
      </p>
      {avgSupplierCost ? (
        <>
          <p className="mt-2 font-mono tabular-nums text-2xl font-semibold leading-none">
            {avgSupplierCost.amount.toFixed(2)} {currency}
          </p>
          {avgSupplierCost.supplier_count > 1 && (
            <p className="text-[11px] text-muted-foreground mt-2 leading-tight">
              {avgSupplierCost.supplier_count} προμηθευτές
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 font-mono text-2xl font-semibold text-muted-foreground leading-none">
            —
          </p>
          <p
            className="text-[11px] text-muted-foreground italic mt-1.5 leading-tight"
            title="Ορίστε έναν προμηθευτή με κόστος μονάδας στην ίδια νομισματική μονάδα με το προϊόν."
          >
            χωρίς κόστος προμηθευτή
          </p>
        </>
      )}
    </div>
  );
}

