"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { bulkLinkSupplierAsPreferred } from "@/actions/suppliers/bulkLinkSupplierAsPreferred";
import { linkSupplierToVariant } from "@/actions/suppliers/linkSupplierToVariant";
import type { LowStockVariant, Supplier } from "@/types/suppliers";

interface Props {
  items: LowStockVariant[];
  /**
   * Active suppliers to populate the inline + bulk dropdowns. Passed
   * from the server page rather than re-fetched in the client so the
   * panel can render synchronously.
   */
  suppliers: Pick<Supplier, "id" | "name">[];
}

/**
 * "Παραλλαγές χωρίς προμηθευτή" panel for the Supply Orders Drafts view.
 *
 * Previously rendered as a wall of underlined links pointing the admin
 * at each variant's edit page; the friction was real because assigning
 * a supplier required navigating away, picking, and coming back per
 * variant. This rewrite keeps the variant info but lets the admin:
 *
 *   - Pick a supplier per row from an inline dropdown + "Assign" button
 *   - Tick multiple rows and bulk-assign the same supplier in one click
 *   - Still jump to the variant edit page for richer config when needed
 *
 * Hidden when the input list is empty so the section vanishes once all
 * low-stock variants have been assigned.
 */
export default function UnassignedBanner({ items, suppliers }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [perRowSupplier, setPerRowSupplier] = useState<Record<string, string>>({});
  const [bulkSupplier, setBulkSupplier] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showAll, setShowAll] = useState(false);
  // Default collapsed — these warning tables can be lengthy, and the
  // admin's primary attention is the drafts below. Expanding is an
  // explicit "I'm going to triage this now" gesture.
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const visibleItems = showAll ? items : items.slice(0, 10);
  const allOnPageSelected = visibleItems.every((v) => selected.has(v.variant_id));
  const someOnPageSelected = visibleItems.some((v) => selected.has(v.variant_id));

  function toggleOne(variantId: string, on: boolean) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(variantId);
      else next.delete(variantId);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((cur) => {
      const next = new Set(cur);
      if (allOnPageSelected) {
        for (const v of visibleItems) next.delete(v.variant_id);
      } else {
        for (const v of visibleItems) next.add(v.variant_id);
      }
      return next;
    });
  }

  function handleAssignSingle(variantId: string) {
    const supplierId = perRowSupplier[variantId];
    if (!supplierId) {
      setError("Επιλέξτε προμηθευτή για αυτή την παραλλαγή.");
      return;
    }
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await linkSupplierToVariant({
        variantId,
        supplierId,
        isPreferred: true,
      });
      if (!r.success) {
        // If supplier is already linked but not preferred, retry via the
        // bulk path which handles "promote existing row to preferred" so
        // the admin still gets the expected outcome.
        if (r.code === "ALREADY_LINKED") {
          const bulkRes = await bulkLinkSupplierAsPreferred({
            supplierId,
            variantIds: [variantId],
          });
          if (!bulkRes.success) {
            setError(bulkRes.error);
            return;
          }
        } else {
          setError(r.error);
          return;
        }
      }
      setInfo("Ο προμηθευτής ανατέθηκε.");
      router.refresh();
    });
  }

  function handleBulkAssign() {
    if (selected.size === 0) {
      setError("Δεν έχετε επιλέξει παραλλαγές.");
      return;
    }
    if (!bulkSupplier) {
      setError("Επιλέξτε προμηθευτή για bulk ανάθεση.");
      return;
    }
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await bulkLinkSupplierAsPreferred({
        supplierId: bulkSupplier,
        variantIds: Array.from(selected),
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setInfo(
        `Ανατέθηκε προμηθευτής σε ${r.data.linked} παραλλαγή${
          r.data.linked === 1 ? "" : "ές"
        }.`
      );
      setSelected(new Set());
      setBulkSupplier("");
      router.refresh();
    });
  }

  return (
    <section className="border border-foreground/15 rounded-lg overflow-hidden mb-4 bg-muted/40">
      {/* Header — clickable to expand/collapse the body. Uses an amber
          "Χρειάζονται προσοχή" pill (warm/warning hue) — distinct from
          MultiSourceBucket's blue "Χρειάζονται απόφαση" so the two are
          visually unambiguous at a glance. Header text scale bumped
          from "h3" to "text-lg" per design feedback. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left px-4 py-3.5 hover:bg-muted/60 transition-colors flex items-center justify-between gap-4"
      >
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold bg-amber-100 text-amber-900 border border-amber-300 mb-1">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"
              aria-hidden
            />
            Χρειάζονται προσοχή
          </span>
          <h3 className="text-lg font-semibold tracking-tight">
            {items.length} παραλλαγ{items.length === 1 ? "ή χωρίς" : "ές χωρίς"} προμηθευτή
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Αναθέστε έναν προμηθευτή ανά παραλλαγή ή επιλέξτε πολλαπλές
            και κάντε ομαδική ανάθεση.
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

      {/* Bulk action bar — only visible when something is selected */}
      {selected.size > 0 && (
        <div className="bg-background border-b border-foreground/10 px-4 py-2.5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium">
            {selected.size} επιλεγμέν{selected.size === 1 ? "η" : "ες"}
          </span>
          <span className="text-xs text-muted-foreground">→ προμηθευτής:</span>
          <select
            value={bulkSupplier}
            onChange={(e) => setBulkSupplier(e.target.value)}
            className="cms-input cms-input-sm w-auto min-w-[200px]"
          >
            <option value="">— επιλέξτε —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleBulkAssign}
            disabled={isPending || !bulkSupplier}
            className="btn btn-primary btn-sm"
          >
            {isPending ? "Ανάθεση..." : "Ανάθεση"}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Καθαρισμός
          </button>
        </div>
      )}

      {(error || info) && (
        <div
          role={error ? "alert" : "status"}
          className={`px-4 py-2 text-xs border-b border-foreground/10 ${
            error
              ? "bg-destructive/10 text-destructive"
              : "bg-muted/40 text-foreground"
          }`}
        >
          {error || info}
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="text-left px-3 py-2 w-8">
              <input
                type="checkbox"
                checked={allOnPageSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !allOnPageSelected && someOnPageSelected;
                }}
                onChange={toggleAllVisible}
                aria-label="Επιλογή όλων"
              />
            </th>
            <th className="text-left px-3 py-2 font-medium">Παραλλαγή</th>
            <th className="text-left px-3 py-2 font-medium">SKU</th>
            <th className="text-center px-3 py-2 font-medium">Stock / Όριο</th>
            <th className="text-left px-3 py-2 font-medium">Προμηθευτής</th>
            <th className="text-center px-3 py-2 font-medium">Ενέργεια</th>
          </tr>
        </thead>
        <tbody>
          {visibleItems.map((v) => {
            const isSelected = selected.has(v.variant_id);
            const rowSupplier = perRowSupplier[v.variant_id] ?? "";
            return (
              <tr
                key={v.variant_id}
                className={`border-t border-foreground/10 hover:bg-muted/20 transition-colors ${
                  isSelected ? "bg-muted/30" : ""
                }`}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => toggleOne(v.variant_id, e.target.checked)}
                    aria-label={v.product_name}
                  />
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/products?focus=${v.product_id}`}
                    className="font-medium hover:underline"
                  >
                    {v.product_name}
                  </Link>
                  {v.variant_label && (
                    <span className="text-muted-foreground text-xs ml-1.5">
                      · {v.variant_label}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {v.business_sku}
                </td>
                <td className="px-3 py-2 text-center font-mono text-xs">
                  <span
                    className={
                      v.quantity_available <= 0
                        ? "font-semibold"
                        : "text-muted-foreground"
                    }
                  >
                    {v.quantity_available}/{v.low_stock_threshold}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={rowSupplier}
                    onChange={(e) =>
                      setPerRowSupplier((cur) => ({
                        ...cur,
                        [v.variant_id]: e.target.value,
                      }))
                    }
                    disabled={isPending}
                    className="cms-input cms-input-sm w-full min-w-[180px]"
                  >
                    <option value="">— επιλέξτε —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => handleAssignSingle(v.variant_id)}
                    disabled={isPending || !rowSupplier}
                    className="btn btn-secondary btn-sm"
                  >
                    Ανάθεση
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {items.length > 10 && (
        <div className="bg-muted/20 px-4 py-2 border-t border-foreground/10 text-center">
          <button
            type="button"
            onClick={() => setShowAll((c) => !c)}
            className="text-xs underline text-muted-foreground hover:text-foreground"
          >
            {showAll
              ? `Εμφάνιση μόνο των πρώτων 10`
              : `+ ${items.length - 10} ακόμη — εμφάνιση όλων`}
          </button>
        </div>
      )}
        </div>
      </div>
    </section>
  );
}
