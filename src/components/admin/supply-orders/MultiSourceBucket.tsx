"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addToDraft } from "@/actions/supply-orders/addToDraft";
import type { LowStockVariant, SupplierCurrentCost } from "@/types/suppliers";

interface Props {
  items: LowStockVariant[];
}

interface RowState {
  /** Picked supplier_id. Defaults to cheapest, then preferred, then first available. */
  supplierId: string;
  qty: number;
}

function suggestedQty(item: LowStockVariant): number {
  return Math.max(item.low_stock_threshold * 2 - item.quantity_available, 1);
}

/**
 * Default-pick algorithm:
 *   1. The cheapest supplier with a known cost, if any.
 *   2. Else the preferred supplier (if marked).
 *   3. Else the first entry.
 */
function defaultSupplierId(item: LowStockVariant): string {
  const withCost = item.suppliers.filter((s) => s.last_unit_cost !== null);
  if (withCost.length > 0) {
    const cheapest = withCost.reduce((acc, s) =>
      (s.last_unit_cost ?? Infinity) < (acc.last_unit_cost ?? Infinity) ? s : acc
    );
    return cheapest.supplier_id;
  }
  const preferred = item.suppliers.find((s) => s.is_preferred);
  if (preferred) return preferred.supplier_id;
  return item.suppliers[0]?.supplier_id ?? "";
}

function formatCost(s: SupplierCurrentCost | undefined): string {
  if (!s) return "—";
  if (s.last_unit_cost === null) return "—";
  return `${s.last_unit_cost.toFixed(2)} ${s.last_unit_cost_currency ?? ""}`.trim();
}

function supplierOptionLabel(s: SupplierCurrentCost): string {
  const cost = s.last_unit_cost !== null
    ? ` — ${s.last_unit_cost.toFixed(2)} ${s.last_unit_cost_currency ?? ""}`.trimEnd()
    : " — καμία ιστορία";
  const tags: string[] = [];
  if (s.is_preferred) tags.push("✓");
  if (s.is_cheapest) tags.push("$");
  if (s.is_stale) tags.push("⏳");
  const tagSuffix = tags.length > 0 ? ` ${tags.join("")}` : "";
  return `${s.supplier_name}${cost}${tagSuffix}`;
}

/**
 * Compact table — one row per variant with a supplier dropdown so the admin
 * can pick which supplier handles this line. The dropdown options each show
 * the supplier's most-recent cost and badges for preferred / cheapest / stale.
 * The "Cost" cell shows the currently picked supplier's cost (defaults to the
 * cheapest with known history).
 */
export default function MultiSourceBucket({ items }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Default collapsed — matches UnassignedBanner. Both warning tables
  // start out of the way; the admin expands them when they're ready
  // to triage.
  const [open, setOpen] = useState(false);
  const [rowState, setRowState] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const item of items) {
      init[item.variant_id] = {
        supplierId: defaultSupplierId(item),
        qty: suggestedQty(item),
      };
    }
    return init;
  });

  // Re-seed any items not yet in state (new arrivals after refresh).
  const ensuredRowState = useMemo(() => {
    const next = { ...rowState };
    let dirty = false;
    for (const item of items) {
      if (!next[item.variant_id]) {
        next[item.variant_id] = {
          supplierId: defaultSupplierId(item),
          qty: suggestedQty(item),
        };
        dirty = true;
      }
    }
    return dirty ? next : rowState;
  }, [items, rowState]);

  if (items.length === 0) return null;

  function update(variantId: string, patch: Partial<RowState>) {
    setRowState((cur) => ({
      ...cur,
      [variantId]: { ...cur[variantId], ...patch },
    }));
  }

  function handleAdd(item: LowStockVariant) {
    const state = ensuredRowState[item.variant_id];
    if (!state?.supplierId || !state.qty || state.qty <= 0) return;
    setError(null);
    startTransition(async () => {
      const r = await addToDraft({
        supplierId: state.supplierId,
        variantId: item.variant_id,
        orderedQty: state.qty,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="border border-foreground/15 rounded-lg overflow-hidden bg-muted/40 mb-4">
      {/* Header — clickable to expand/collapse. Sky-blue chip
          "Χρειάζονται απόφαση" deliberately distinct from
          UnassignedBanner's amber so the eye can sort them at a
          glance even when both are open. Same dashed-tile interaction
          model as other accordions in the workspace. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left px-4 py-3.5 hover:bg-muted/60 transition-colors flex items-center justify-between gap-4"
      >
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold bg-sky-100 text-sky-900 border border-sky-300 mb-1">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-sky-500"
              aria-hidden
            />
            Χρειάζονται απόφαση
          </span>
          <h2 className="text-lg font-semibold tracking-tight">
            {items.length} παραλλαγ{items.length === 1 ? "ή" : "ές"} με πολλαπλούς
            πιθανούς προμηθευτές
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Επιλέξτε προμηθευτή και ποσότητα ανά παραλλαγή. Ετικέτες:{" "}
            <span className="font-mono">✓</span> = προτιμώμενος ·{" "}
            <span className="font-mono">$</span> = φθηνότερος ·{" "}
            <span className="font-mono">⏳</span> = παλιά τιμή (&gt; 60 ημέρες)
          </p>
        </div>
        <span
          className={`shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        >
          ▼
        </span>
      </button>

      <div className={`cms-accordion ${open ? "is-open" : ""}`}>
        <div className="bg-card border-t border-foreground/10">

      {error && (
        <p
          role="alert"
          className="px-4 py-2 text-sm text-destructive bg-destructive/5 border-b border-destructive/30"
        >
          {error}
        </p>
      )}

      <table className="cms-table">
        <thead>
          <tr>
            <th>Προϊόν</th>
            <th>SKU</th>
            <th className="text-center">Stock / Όριο</th>
            <th className="text-center">Τιμή</th>
            <th className="text-center">Ποσότητα</th>
            <th>Προμηθευτής</th>
            <th className="text-center">Κόστος</th>
            <th className="text-center">Δράση</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const state = ensuredRowState[item.variant_id];
            const selectedSupplier = item.suppliers.find(
              (s) => s.supplier_id === state?.supplierId
            );
            return (
              <tr key={item.variant_id}>
                <td>
                  <p className="font-medium">
                    {item.product_name}
                    {item.variant_label && (
                      <span className="text-muted-foreground">
                        {" "}· {item.variant_label}
                      </span>
                    )}
                  </p>
                </td>
                <td className="font-mono text-xs text-muted-foreground">
                  {item.business_sku}
                </td>
                <td className="text-center font-mono text-xs">
                  <span
                    className={
                      item.status === "out"
                        ? "font-semibold"
                        : "text-muted-foreground"
                    }
                  >
                    {item.quantity_available}/{item.low_stock_threshold}
                  </span>
                </td>
                <td className="text-center font-mono tabular-nums">
                  {item.sale_price.toFixed(2)}
                </td>
                <td className="text-center">
                  <input
                    type="number"
                    min={1}
                    value={state?.qty ?? 1}
                    onChange={(e) =>
                      update(item.variant_id, {
                        qty: Math.max(
                          1,
                          Math.floor(Number(e.target.value) || 1)
                        ),
                      })
                    }
                    className="cms-input cms-input-sm w-20 text-center font-mono"
                  />
                </td>
                <td>
                  <select
                    value={state?.supplierId ?? ""}
                    onChange={(e) =>
                      update(item.variant_id, { supplierId: e.target.value })
                    }
                    className="cms-input cms-input-sm w-full min-w-[200px]"
                  >
                    {item.suppliers.map((s) => (
                      <option key={s.supplier_id} value={s.supplier_id}>
                        {supplierOptionLabel(s)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="text-center font-mono text-xs">
                  {/* When the selected supplier has a known cost, show
                      it. When no cost has been configured for this
                      (supplier, variant) pair, warn explicitly + link
                      to the supplier's edit page where the cost field
                      lives. Opens in a new tab so the admin doesn't
                      lose the draft selection in progress. */}
                  {selectedSupplier?.last_unit_cost !== null &&
                  selectedSupplier?.last_unit_cost !== undefined ? (
                    formatCost(selectedSupplier)
                  ) : selectedSupplier ? (
                    <Link
                      href={`/admin/suppliers/${selectedSupplier.supplier_id}`}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-semibold bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 transition-colors font-sans"
                      title="Δεν έχει οριστεί κόστος για αυτόν τον προμηθευτή — κάντε κλικ για να το ρυθμίσετε"
                    >
                      Χωρίς κόστος ↗
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="text-center">
                  <button
                    type="button"
                    onClick={() => handleAdd(item)}
                    disabled={isPending || !state?.supplierId}
                    className="btn btn-primary btn-sm"
                  >
                    + Πρόσθεσε
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
        </div>
      </div>
    </section>
  );
}
