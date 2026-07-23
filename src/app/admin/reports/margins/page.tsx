import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import {
  resolveEffectiveVatRate,
  computeMargin,
  pushJoinedCategory,
} from "@/lib/vat-helpers";
import type { Product } from "@/types/products";
import type { VatRate, ResolvedVatRate } from "@/types/vat-rates";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Περιθώρια Κέρδους — Admin" };
export const dynamic = "force-dynamic";

type SortKey = "margin_pct_asc" | "margin_pct_desc" | "name" | "cost_desc";

interface Row {
  product: Product;
  resolved: ResolvedVatRate | null;
  netSale: number | null;
  marginAmount: number | null;
  marginPercent: number | null;
  /** Resolved cost actually used for this row (from supplier_products preferred avg, or products.cost_price fallback). */
  effectiveCost: number | null;
  /** Where the cost came from — for the display column. */
  costSource: "supplier" | "product_fallback" | null;
  /** Why margin is null when it is — for the empty-state cell. */
  missingReason: "no_cost" | "no_vat" | "currency_mismatch" | null;
}

/**
 * Profit margin report. Computes (sale_price − VAT) − cost per product
 * and surfaces the absolute + percentage margin, with sort options. Rows
 * with no cost / no VAT / currency mismatch are explicitly explained
 * rather than silently dropped so admins know what to fix.
 *
 * Margin emphasis: in the all-b/w palette, sub-20% margin rows get a
 * dotted underline + bold (a "caution" hint without color), and
 * negative margin rows get destructive emphasis (the one place red
 * stays because "losing money" is the strongest possible warning).
 */
export default async function MarginsReportPage(
  props: {
    searchParams: Promise<{ sort?: string }>;
  }
) {
  await requirePermission("manage:products");
  const searchParams = await props.searchParams;
  const sort: SortKey = isValidSort(searchParams.sort)
    ? (searchParams.sort as SortKey)
    : "margin_pct_asc";

  const supabase = await createClient();
  const [{ data: products }, { data: rates }, { data: pcRows }, { data: supRows }] =
    await Promise.all([
      supabase.from("products").select("*").eq("active", true),
      supabase.from("vat_rates").select("*").order("rate"),
      supabase
        .from("product_categories")
        .select("product_id, categories(id, vat_rate_id)"),
      // Pull every preferred supplier_products row joined to its product
      // via the variant. This gives us per-(product, variant) costs which
      // we average per product below to get the "effective" unit cost.
      supabase
        .from("supplier_products")
        .select(
          "unit_cost, unit_cost_currency, product_variants!inner(product_id)"
        )
        .eq("is_preferred", true)
        .not("unit_cost", "is", null),
    ]);

  const productList = (products ?? []) as Product[];
  const vatRates = (rates ?? []) as VatRate[];

  const catRowsByProduct = new Map<
    string,
    Array<{ id: string; vat_rate_id: string | null }>
  >();
  for (const r of (pcRows ?? []) as Array<{
    product_id: string;
    categories: unknown;
  }>) {
    const list = catRowsByProduct.get(r.product_id) ?? [];
    pushJoinedCategory(r.categories, list);
    if (list.length > 0) catRowsByProduct.set(r.product_id, list);
  }

  // Aggregate preferred-supplier costs per product. For each product
  // we collect every variant's preferred-supplier unit_cost and
  // average them (unweighted — without per-variant sales mix we can't
  // do better). Currency must be uniform across variants for the
  // product; otherwise we mark as currency_mismatch so the report
  // doesn't silently average across currencies.
  type SupRow = {
    unit_cost: number | string | null;
    unit_cost_currency: string | null;
    product_variants:
      | { product_id: string }
      | Array<{ product_id: string }>
      | null;
  };
  const supplierCostByProduct = new Map<
    string,
    { total: number; count: number; currencies: Set<string> }
  >();
  for (const r of (supRows ?? []) as SupRow[]) {
    if (r.unit_cost === null || !r.unit_cost_currency) continue;
    const pv = Array.isArray(r.product_variants)
      ? r.product_variants[0]
      : r.product_variants;
    if (!pv?.product_id) continue;
    const acc = supplierCostByProduct.get(pv.product_id) ?? {
      total: 0,
      count: 0,
      currencies: new Set<string>(),
    };
    acc.total += Number(r.unit_cost);
    acc.count += 1;
    acc.currencies.add(r.unit_cost_currency);
    supplierCostByProduct.set(pv.product_id, acc);
  }

  /**
   * Resolve a single "effective unit cost" for a product, in the
   * product's sale currency. Preference order:
   *   1. AVG of preferred-supplier unit_cost across variants, if
   *      currencies are uniform AND match the product's sale currency
   *   2. products.cost_price (legacy fallback), if same currency
   *   3. null + missingReason
   */
  function resolveProductCost(p: Product): {
    cost: number | null;
    source: Row["costSource"];
    reason: Row["missingReason"];
  } {
    const supAgg = supplierCostByProduct.get(p.id);
    if (supAgg && supAgg.count > 0) {
      if (supAgg.currencies.size > 1) {
        return { cost: null, source: null, reason: "currency_mismatch" };
      }
      const ccy = Array.from(supAgg.currencies)[0];
      if (ccy && p.currency && ccy !== p.currency) {
        return { cost: null, source: null, reason: "currency_mismatch" };
      }
      return {
        cost: supAgg.total / supAgg.count,
        source: "supplier",
        reason: null,
      };
    }
    if (p.cost_price === null || p.cost_price === undefined) {
      return { cost: null, source: null, reason: "no_cost" };
    }
    if (p.cost_currency && p.cost_currency !== p.currency) {
      return { cost: null, source: null, reason: "currency_mismatch" };
    }
    return {
      cost: Number(p.cost_price),
      source: "product_fallback",
      reason: null,
    };
  }

  const rows: Row[] = productList.map((p) => {
    const resolved = resolveEffectiveVatRate(
      p,
      catRowsByProduct.get(p.id) ?? [],
      vatRates
    );

    const { cost: effectiveCost, source, reason } = resolveProductCost(p);
    if (effectiveCost === null) {
      return {
        product: p,
        resolved,
        netSale: null,
        marginAmount: null,
        marginPercent: null,
        effectiveCost: null,
        costSource: null,
        missingReason: reason,
      };
    }
    if (!resolved) {
      return {
        product: p,
        resolved,
        netSale: null,
        marginAmount: null,
        marginPercent: null,
        effectiveCost,
        costSource: source,
        missingReason: "no_vat",
      };
    }
    const m = computeMargin(
      Number(p.base_price),
      effectiveCost,
      resolved.rate.rate
    );
    return {
      product: p,
      resolved,
      netSale: m.netSale,
      marginAmount: m.marginAmount,
      marginPercent: m.marginPercent,
      effectiveCost,
      costSource: source,
      missingReason: null,
    };
  });

  rows.sort((a, b) => {
    if (sort === "name") return a.product.name.localeCompare(b.product.name);
    if (sort === "cost_desc")
      return (b.effectiveCost ?? 0) - (a.effectiveCost ?? 0);
    const aN = a.marginPercent === null;
    const bN = b.marginPercent === null;
    if (aN && !bN) return 1;
    if (bN && !aN) return -1;
    if (aN && bN) return 0;
    return sort === "margin_pct_desc"
      ? b.marginPercent! - a.marginPercent!
      : a.marginPercent! - b.marginPercent!;
  });

  // Quick summary tiles — average margin + counts of "needs attention" rows.
  const computedRows = rows.filter((r) => r.marginPercent !== null);
  const avgMarginPct =
    computedRows.length > 0
      ? computedRows.reduce((acc, r) => acc + r.marginPercent!, 0) /
        computedRows.length
      : null;
  const lowMarginCount = computedRows.filter(
    (r) => r.marginPercent! < 0.2
  ).length;
  const negativeMarginCount = computedRows.filter(
    (r) => r.marginPercent! < 0
  ).length;
  const missingDataCount = rows.length - computedRows.length;

  return (
    <>
      <PageHeader
        eyebrow="Αναφορές"
        title="Περιθώρια Κέρδους"
        description="Καθαρό περιθώριο = τιμή πώλησης μείον ΦΠΑ μείον κόστος μονάδας. Προϊόντα χωρίς κόστος ή με κόστος σε διαφορετικό νόμισμα εμφανίζονται με «—»."
      />

      {/* Summary tiles */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="cms-card">
          <p className="text-xs text-muted-foreground font-medium">
            Μέσο περιθώριο
          </p>
          <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
            {avgMarginPct !== null
              ? `${(avgMarginPct * 100).toFixed(1)}%`
              : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Από {computedRows.length} προϊόντα με δεδομένα
          </p>
        </div>
        <div className="cms-card">
          <p className="text-xs text-muted-foreground font-medium">
            Χαμηλό περιθώριο
          </p>
          <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
            {lowMarginCount}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Κάτω από 20%
          </p>
        </div>
        <div className="cms-card">
          <p className="text-xs text-muted-foreground font-medium">
            Αρνητικό περιθώριο
          </p>
          <p
            className={`text-2xl font-semibold tracking-tight mt-1 tabular-nums ${
              negativeMarginCount > 0 ? "text-destructive" : ""
            }`}
          >
            {negativeMarginCount}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Προϊόντα με ζημία
          </p>
        </div>
        <div className="cms-card">
          <p className="text-xs text-muted-foreground font-medium">
            Χωρίς δεδομένα
          </p>
          <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
            {missingDataCount}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Κόστος ή ΦΠΑ λείπει
          </p>
        </div>
      </section>

      {/* Sort controls */}
      <nav className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs uppercase tracking-wider font-medium text-muted-foreground mr-2">
          Ταξινόμηση:
        </span>
        <SortChip current={sort} value="margin_pct_asc" label="Περιθώριο ↑" />
        <SortChip current={sort} value="margin_pct_desc" label="Περιθώριο ↓" />
        <SortChip current={sort} value="cost_desc" label="Κόστος ↓" />
        <SortChip current={sort} value="name" label="Όνομα" />
      </nav>

      {rows.length === 0 ? (
        <div className="cms-empty">Δεν υπάρχουν ενεργά προϊόντα.</div>
      ) : (
        <div className="cms-table-wrap">
          <table className="cms-table">
            <thead>
              <tr>
                <th>Προϊόν</th>
                <th className="text-center">Τιμή</th>
                <th className="text-center">ΦΠΑ</th>
                <th className="text-center">Καθαρή</th>
                <th className="text-center">Κόστος</th>
                <th className="text-center">Περιθώριο</th>
              </tr>
            </thead>
            <tbody className="content-reveal">
              {rows.map((r) => {
                const isNegative =
                  r.marginPercent !== null && r.marginPercent < 0;
                const isLow =
                  r.marginPercent !== null &&
                  r.marginPercent >= 0 &&
                  r.marginPercent < 0.2;
                return (
                  <tr
                    key={r.product.id}
                    className={isNegative ? "bg-destructive/5" : ""}
                  >
                    <td>
                      <Link
                        href={`/admin/products?focus=${r.product.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.product.name}
                      </Link>
                      <p className="text-xs text-muted-foreground font-mono">
                        {r.product.slug}
                      </p>
                    </td>
                    <td className="text-center font-mono tabular-nums">
                      {Number(r.product.base_price).toFixed(2)}{" "}
                      <span className="text-muted-foreground text-xs">
                        {r.product.currency}
                      </span>
                    </td>
                    <td className="text-center font-mono text-xs">
                      {r.resolved
                        ? `${(r.resolved.rate.rate * 100).toFixed(0)}%`
                        : "—"}
                    </td>
                    <td className="text-center font-mono tabular-nums text-xs">
                      {r.netSale !== null
                        ? r.netSale.toFixed(2)
                        : "—"}
                    </td>
                    <td className="text-center font-mono tabular-nums text-xs">
                      {r.effectiveCost !== null ? (
                        <span
                          className={
                            r.costSource === "product_fallback"
                              ? "text-muted-foreground italic"
                              : ""
                          }
                          title={
                            r.costSource === "product_fallback"
                              ? "Fallback από products.cost_price (δεν υπάρχει preferred-supplier cost)"
                              : "Μ.Ο. preferred-supplier cost ανά παραλλαγή"
                          }
                        >
                          {r.effectiveCost.toFixed(2)} {r.product.currency}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-center">
                      {r.marginPercent !== null ? (
                        <span
                          className={`font-mono tabular-nums ${
                            isNegative
                              ? "text-destructive font-bold"
                              : isLow
                                ? "font-semibold underline decoration-dotted underline-offset-2"
                                : ""
                          }`}
                        >
                          {(r.marginPercent * 100).toFixed(1)}%
                          <span className="text-muted-foreground text-xs ml-1.5">
                            ({r.marginAmount!.toFixed(2)}{" "}
                            {r.product.currency})
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          {r.missingReason === "no_cost" &&
                            "Δεν έχει οριστεί κόστος"}
                          {r.missingReason === "no_vat" &&
                            "Δεν έχει οριστεί ΦΠΑ"}
                          {r.missingReason === "currency_mismatch" &&
                            "Διαφορετικό νόμισμα κόστους"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function SortChip({
  current,
  value,
  label,
}: {
  current: SortKey;
  value: SortKey;
  label: string;
}) {
  const isActive = current === value;
  return (
    <Link
      href={`/admin/reports/margins?sort=${value}`}
      className={
        isActive
          ? "btn btn-primary btn-sm"
          : "btn btn-secondary btn-sm"
      }
    >
      {label}
    </Link>
  );
}

function isValidSort(s: string | undefined): boolean {
  return (
    s === "margin_pct_asc" ||
    s === "margin_pct_desc" ||
    s === "name" ||
    s === "cost_desc"
  );
}
