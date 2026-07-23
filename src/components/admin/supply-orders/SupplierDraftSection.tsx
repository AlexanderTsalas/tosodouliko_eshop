"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addToDraft } from "@/actions/supply-orders/addToDraft";
import { addManyToDraft } from "@/actions/supply-orders/addManyToDraft";
import { removeDraftLine } from "@/actions/supply-orders/removeDraftLine";
import { updateDraftLine } from "@/actions/supply-orders/updateDraftLine";
import OrderStatusActions from "@/components/admin/supply-orders/OrderStatusActions";
import DraftExportBar from "@/components/admin/supply-orders/DraftExportBar";
import CustomAddPicker from "@/components/admin/supply-orders/CustomAddPicker";
import type {
  LowStockVariant,
  PlacedSupplyLine,
  Supplier,
  SupplyOrder,
  SupplyOrderLine,
} from "@/types/suppliers";

export interface DraftSectionData {
  supplier: Supplier;
  /** Existing draft for this supplier (or null if none yet). */
  draft: SupplyOrder | null;
  /** Lines on the existing draft. */
  lines: SupplyOrderLine[];
  /**
   * Lines on this supplier's placed (awaiting delivery) orders.
   * Informational only — the row shows what's on the way and links to
   * the placed order; admin doesn't act on it from here.
   */
  placedLines: PlacedSupplyLine[];
  /** Low/out variants assigned to this supplier that are NOT yet on the draft. */
  suggestions: LowStockVariant[];
}

interface Props {
  data: DraftSectionData;
}

/**
 * One accordion section per supplier on the supply-orders drafts view.
 * Shows existing draft lines + the supplier's auto-suggested low/out
 * variants, plus informational "placed but awaiting delivery" lines.
 *
 * Admin can:
 *   - edit quantities/cost on existing lines
 *   - add a suggested variant to the draft (creates draft if needed)
 *   - bulk-add multiple suggestions at once
 *   - remove a line (deletes the draft if it becomes empty)
 *
 * Visual model: a single bordered card with a clickable header. The
 * header chevron rotates to indicate open/closed state, matching the
 * sidebar's section pattern.
 */
export default function SupplierDraftSection({ data }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  /** Suggestion variant IDs the admin has ticked for bulk-add. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [placedOpen, setPlacedOpen] = useState(false);

  function toggleSuggestion(variantId: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  }
  function toggleAllSuggestions() {
    const allIds = data.suggestions.map((s) => s.variant_id);
    if (allIds.every((id) => selected.has(id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }
  function suggestedQty(item: LowStockVariant): number {
    return Math.max(item.low_stock_threshold * 2 - item.quantity_available, 1);
  }
  function bulkAdd(items: LowStockVariant[]) {
    if (items.length === 0) return;
    setError(null);
    startTransition(async () => {
      const r = await addManyToDraft({
        supplierId: data.supplier.id,
        items: items.map((i) => ({
          variantId: i.variant_id,
          orderedQty: suggestedQty(i),
        })),
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      if (r.data.failed.length > 0) {
        setError(
          `${r.data.added} προστέθηκαν · ${r.data.failed.length} αποτυχ${
            r.data.failed.length === 1 ? "ία" : "ίες"
          }`
        );
      }
      setSelected(new Set());
      router.refresh();
    });
  }

  const lineCount = data.lines.length;
  const suggestionCount = data.suggestions.length;
  const placedCount = data.placedLines.length;
  const totalCost = data.lines.reduce(
    (acc, l) => acc + (Number(l.unit_cost) || 0) * l.ordered_qty,
    0
  );
  const currency = data.lines[0]?.unit_cost_currency ?? data.supplier.default_currency;

  function handleAddSuggestion(item: LowStockVariant) {
    setError(null);
    startTransition(async () => {
      const r = await addToDraft({
        supplierId: data.supplier.id,
        variantId: item.variant_id,
        orderedQty: suggestedQty(item),
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function handleEditQty(line: SupplyOrderLine, qty: number) {
    if (!Number.isFinite(qty) || qty <= 0 || qty === line.ordered_qty) return;
    setError(null);
    startTransition(async () => {
      const r = await updateDraftLine({ lineId: line.id, orderedQty: qty });
      if (!r.success) setError(r.error);
      else router.refresh();
    });
  }

  function handleEditCost(line: SupplyOrderLine, costStr: string) {
    const cost = costStr.trim() === "" ? null : Number(costStr);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return;
    if (cost === line.unit_cost) return;
    setError(null);
    startTransition(async () => {
      const r = await updateDraftLine({ lineId: line.id, unitCost: cost });
      if (!r.success) setError(r.error);
      else router.refresh();
    });
  }

  function handleRemove(line: SupplyOrderLine) {
    setError(null);
    startTransition(async () => {
      const r = await removeDraftLine({ lineId: line.id });
      if (!r.success) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <section className="border border-foreground/15 rounded-lg overflow-hidden bg-card">
      {/* Card header — supplier name + counts + contact + collapse */}
      <header
        className="flex items-center justify-between gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Chevron open={open} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-semibold tracking-tight truncate">
                {data.supplier.name}
              </h2>
              {/* Supplier-details link sits NEXT to the name — was
                  previously in the card footer, miles below. Click
                  bubbles through to the header toggle if not handled
                  here, so stopPropagation keeps the click on the
                  link only. */}
              <Link
                href={`/admin/suppliers/${data.supplier.id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-muted-foreground hover:text-foreground underline whitespace-nowrap"
              >
                Στοιχεία προμηθευτή →
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {lineCount > 0 && (
                <span className="cms-badge cms-badge-neutral">
                  <span className="cms-badge-dot" aria-hidden />
                  {lineCount} {lineCount === 1 ? "γραμμή" : "γραμμές"} σε draft
                </span>
              )}
              {suggestionCount > 0 && (
                <span className="cms-badge cms-badge-muted">
                  {suggestionCount} προτεινόμεν{suggestionCount === 1 ? "ο" : "α"}
                </span>
              )}
              {placedCount > 0 && (
                <span className="cms-badge cms-badge-muted">
                  {placedCount} σε αναμονή
                </span>
              )}
              {lineCount === 0 && suggestionCount === 0 && placedCount === 0 && (
                <span className="text-xs text-muted-foreground italic">
                  Όλα εντάξει
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="text-xs text-center shrink-0 hidden sm:block">
          {data.supplier.primary_email && (
            <p>
              <a
                href={`mailto:${data.supplier.primary_email}`}
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                {data.supplier.primary_email}
              </a>
            </p>
          )}
          {data.supplier.primary_phone && (
            <p>
              <a
                href={`tel:${data.supplier.primary_phone}`}
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                {data.supplier.primary_phone}
              </a>
            </p>
          )}
        </div>
      </header>

      {/* Body wrapped in cms-accordion so expand/collapse animates
          height + opacity smoothly. The is-open class toggles on
          `open` (state); the inner element carries the actual
          padding so the animated container can collapse to 0
          without leaving phantom padding. */}
      <div className={`cms-accordion ${open ? "is-open" : ""}`}>
        <div className="border-t border-foreground/10 p-4 space-y-5">
          {error && (
            <p
              role="alert"
              className="text-sm text-destructive bg-destructive/5 border border-destructive/30 rounded-md px-3 py-2"
            >
              {error}
            </p>
          )}

          {/* ────────────────────────── Draft lines ────────────────────────── */}
          {lineCount > 0 && (
            <div>
              <h3 className="text-sm font-semibold tracking-tight mb-1">
                Πρόχειρο παραγγελίας προμηθευτή
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Περάστε εδώ προϊόντα από την παρακάτω λίστα προϊόντων χαμηλού
                αποθέματος για να επεξεργαστείτε την παραγγελία του
                προμηθευτή.
              </p>
              <div className="cms-table-wrap">
                <table className="cms-table">
                  <thead>
                    <tr>
                      <th>Προϊόν</th>
                      <th>SKU προμηθευτή</th>
                      <th className="text-center">Stock / Όριο</th>
                      <th className="text-center">Ποσότητα</th>
                      <th className="text-center">Κόστος μον.</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((line) => (
                      <tr key={line.id}>
                        <td>
                          <p className="font-medium">
                            {line.variant_label ?? line.business_sku_at_draft}
                          </p>
                          <p className="text-muted-foreground font-mono text-xs">
                            {line.business_sku_at_draft}
                          </p>
                        </td>
                        <td className="font-mono text-xs">
                          {line.supplier_sku_at_draft ?? "—"}
                        </td>
                        <td className="text-center font-mono text-xs">
                          {line.qty_at_draft ?? "?"} /{" "}
                          {line.threshold_at_draft ?? "?"}
                        </td>
                        <td className="text-center">
                          <input
                            type="number"
                            min={1}
                            defaultValue={line.ordered_qty}
                            onBlur={(e) =>
                              handleEditQty(line, Number(e.target.value))
                            }
                            className="cms-input cms-input-sm w-20 text-center font-mono"
                          />
                        </td>
                        <td className="text-center">
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="number"
                              step="0.01"
                              min={0}
                              defaultValue={line.unit_cost ?? ""}
                              onBlur={(e) => handleEditCost(line, e.target.value)}
                              placeholder="—"
                              className="cms-input cms-input-sm w-20 text-center font-mono"
                            />
                            <span className="text-[11px] text-muted-foreground">
                              {line.unit_cost_currency ??
                                data.supplier.default_currency}
                            </span>
                          </div>
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => handleRemove(line)}
                            disabled={isPending}
                            className="btn btn-destructive btn-sm"
                            aria-label="Αφαίρεση"
                            title="Αφαίρεση"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted/40 font-semibold">
                      <td colSpan={4}>Σύνολο</td>
                      <td className="text-center font-mono tabular-nums">
                        {totalCost.toFixed(2)} {currency}
                      </td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ────────────────────── Placed (awaiting) ────────────────────── */}
          {placedCount > 0 && (
            <div className="rounded-md border border-foreground/15 overflow-hidden">
              <button
                type="button"
                onClick={() => setPlacedOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs hover:bg-muted/30 transition-colors"
              >
                <span className="font-medium flex items-center gap-2">
                  <Chevron open={placedOpen} />
                  Παραγγέλθηκαν — σε αναμονή παράδοσης ({placedCount})
                </span>
                <span className="text-muted-foreground">
                  {placedOpen ? "Σύμπτυξη" : "Ανάπτυξη"}
                </span>
              </button>
              {placedOpen && (
                <table className="cms-table">
                  <thead>
                    <tr>
                      <th>Προϊόν</th>
                      <th>SKU</th>
                      <th className="text-center">Ποσότητα</th>
                      <th className="text-center">Κόστος μον.</th>
                      <th>Στάλθηκε</th>
                      <th className="text-center">Παραγγελία</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.placedLines.map((line) => (
                      <tr key={line.line_id}>
                        <td>
                          {line.variant_label ?? line.business_sku_at_draft}
                        </td>
                        <td className="font-mono text-xs">
                          {line.business_sku_at_draft}
                        </td>
                        <td className="text-center font-mono">{line.ordered_qty}</td>
                        <td className="text-center font-mono">
                          {line.unit_cost !== null
                            ? `${Number(line.unit_cost).toFixed(2)} ${
                                line.unit_cost_currency ?? ""
                              }`.trim()
                            : "—"}
                        </td>
                        <td className="text-muted-foreground">
                          {line.placed_at
                            ? new Date(line.placed_at).toLocaleDateString("el-GR")
                            : "—"}
                        </td>
                        <td className="text-center">
                          <Link
                            href={`/admin/supply-orders/${line.supply_order_id}`}
                            className="btn btn-secondary btn-sm"
                          >
                            Άνοιγμα
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="px-3 py-2 text-[11px] text-muted-foreground bg-muted/20 border-t border-foreground/10">
                Αυτά τα προϊόντα έχουν παραγγελθεί. Για επανα-draft σε άλλον
                προμηθευτή, επιλέξτε το προϊόν από τον αντίστοιχο προμηθευτή ή
                από τη σελίδα Αποθέματος.
              </p>
            </div>
          )}

          {/* ────────────── Suggestions (auto, not yet drafted) ──────────────── */}
          {suggestionCount > 0 && (
            <div>
              <div className="flex flex-wrap items-center justify-between mb-1 gap-3">
                <div>
                  <h3 className="text-sm font-semibold tracking-tight">
                    Προϊόντα χαμηλού / εκτός αποθέματος
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Επιλέξτε ποια προϊόντα θέλετε να περάσετε στην
                    παραγγελία προμηθευτή.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {selected.size > 0 && (
                    <span className="text-muted-foreground">
                      {selected.size} επιλεγμέν{selected.size === 1 ? "ο" : "α"}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      bulkAdd(
                        data.suggestions.filter((s) => selected.has(s.variant_id))
                      )
                    }
                    disabled={isPending || selected.size === 0}
                    className="btn btn-primary btn-sm"
                  >
                    + Επιλεγμένα
                  </button>
                  <button
                    type="button"
                    onClick={() => bulkAdd(data.suggestions)}
                    disabled={isPending}
                    className="btn btn-secondary btn-sm"
                  >
                    + Όλα ({suggestionCount})
                  </button>
                </div>
              </div>
              <div className="cms-table-wrap">
                <table className="cms-table">
                  <thead>
                    <tr>
                      <th className="w-8">
                        <input
                          type="checkbox"
                          checked={
                            data.suggestions.length > 0 &&
                            data.suggestions.every((s) =>
                              selected.has(s.variant_id)
                            )
                          }
                          ref={(el) => {
                            if (!el) return;
                            const some =
                              data.suggestions.some((s) =>
                                selected.has(s.variant_id)
                              ) &&
                              !data.suggestions.every((s) =>
                                selected.has(s.variant_id)
                              );
                            el.indeterminate = some;
                          }}
                          onChange={toggleAllSuggestions}
                          aria-label="Επιλογή όλων των προτεινόμενων"
                        />
                      </th>
                      <th>Προϊόν</th>
                      <th className="text-center">Stock / Όριο</th>
                      <th className="text-center">Ενέργεια</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.suggestions.map((item) => (
                      <tr
                        key={item.variant_id}
                        className={
                          selected.has(item.variant_id) ? "bg-muted/30" : ""
                        }
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(item.variant_id)}
                            onChange={() => toggleSuggestion(item.variant_id)}
                            aria-label={`Επιλογή ${item.business_sku}`}
                          />
                        </td>
                        <td>
                          <p className="font-medium">
                            {item.product_name}
                            {item.variant_label && (
                              <span className="text-muted-foreground">
                                {" "}· {item.variant_label}
                              </span>
                            )}
                          </p>
                          <p className="text-muted-foreground font-mono text-xs">
                            {item.business_sku}
                          </p>
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
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => handleAddSuggestion(item)}
                            disabled={isPending}
                            className="btn btn-secondary btn-sm"
                          >
                            + Πρόσθεσε
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ────────────────────── Custom add picker ────────────────────── */}
          <div>
            <h3 className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
              Custom προσθήκη
            </h3>
            <CustomAddPicker
              supplierId={data.supplier.id}
              excludeIds={[
                ...data.lines.map((l) => l.variant_id),
                ...data.suggestions.map((s) => s.variant_id),
              ]}
            />
          </div>

          {/* ────────────────────── Footer actions ────────────────────── */}
          {lineCount > 0 && data.draft && (
            <div className="border-t border-foreground/10 pt-4 space-y-3">
              <DraftExportBar supplier={data.supplier} lines={data.lines} />
              {/* Footer used to include a duplicate supplier-details
                  link — moved to live next to the supplier name at the
                  top of the card. Keeping the order-status actions
                  here since they're the contextual draft controls. */}
              <OrderStatusActions
                orderId={data.draft.id}
                status={data.draft.status}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Small chevron used on both the section header and the placed-orders
 * sub-collapsible. Rotates 90° when open. Same shape vocabulary as the
 * sidebar so the whole admin shares one visual collapse affordance.
 */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 180ms ease",
        flexShrink: 0,
        color: "hsl(var(--foreground) / 0.55)",
      }}
    >
      <path
        d="M5 3.5 L9 7 L5 10.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
