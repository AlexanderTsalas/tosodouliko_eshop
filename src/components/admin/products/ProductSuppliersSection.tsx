"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setProductSupplier,
  removeProductSupplier,
} from "@/actions/suppliers/setProductSupplier";
import Toggle from "@/components/admin/common/Toggle";
import DeleteButton from "@/components/admin/common/DeleteButton";
import { Users } from "@/components/admin/common/icons";
import type { Supplier } from "@/types/suppliers";
import type { ProductSupplierSummary } from "@/lib/suppliers/getProductSupplierSummary";

/**
 * Currency options for the per-supplier cost dropdown. Mirrors the
 * product form's whitelist. If a row's stored currency isn't in this
 * list (e.g. legacy or exotic supplier currency), the SupplierCard
 * adds it dynamically so the value can still render.
 */
const CURRENCY_OPTIONS = ["EUR", "USD", "GBP"] as const;

interface Props {
  productId: string;
  variantCount: number;
  /** Aggregated supplier-summary rows from getProductSupplierSummary(). */
  initial: ProductSupplierSummary[];
  /** All active suppliers (for the "+ add" dropdown). */
  allSuppliers: Supplier[];
}

/**
 * Product-level supplier configuration. Each card represents one
 * supplier and edits ALL variants of the product in lockstep — the
 * server action fans the change out to every supplier_products row.
 *
 * The cost-per-(supplier, variant) data model lives underneath, but
 * 95% of the time admins want uniform cost across variants. When they
 * DO need per-variant divergence, the card shows "Διαφορετικό ανά
 * παραλλαγή" + a link to the variant detail page where granular
 * editing lives.
 *
 * Preferred semantics: at most one supplier per variant can be
 * preferred. The toggle at the product level promotes "this supplier
 * is preferred for every variant" — automatically demoting the
 * previously-preferred supplier on those variants.
 */
export default function ProductSuppliersSection({
  productId,
  variantCount,
  initial,
  allSuppliers,
}: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [addSupplierId, setAddSupplierId] = useState("");

  const linkedSupplierIds = new Set(rows.map((r) => r.supplier_id));
  const availableSuppliers = allSuppliers.filter(
    (s) => s.active && !linkedSupplierIds.has(s.id)
  );

  function refreshFromServer() {
    router.refresh();
  }

  function handleAdd() {
    if (!addSupplierId) return;
    setError(null);
    const supplierMeta = allSuppliers.find((s) => s.id === addSupplierId);
    if (!supplierMeta) {
      setError("Ο προμηθευτής δεν βρέθηκε.");
      return;
    }
    const willBePreferred = rows.length === 0;
    startTransition(async () => {
      // First-link auto-becomes preferred (mirroring VariantSuppliersPanel's
      // behavior). Subsequent suppliers added as non-preferred until the
      // admin explicitly promotes them via the toggle.
      const r = await setProductSupplier({
        productId,
        supplierId: addSupplierId,
        isPreferred: willBePreferred,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      // Optimistic append — construct the ProductSupplierSummary
      // row locally from the supplier metadata we already have. SKU /
      // cost are empty (admin hasn't entered them yet); they'll be
      // populated inline via the SupplierCard fields. No
      // router.refresh() so the new card lands in the list
      // immediately.
      setRows((cur) => [
        ...cur,
        {
          supplier_id: supplierMeta.id,
          supplier_name: supplierMeta.name,
          supplier_default_currency: supplierMeta.default_currency,
          is_preferred: willBePreferred,
          variant_count: variantCount,
          total_variant_count: variantCount,
          default_supplier_sku: null,
          sku_is_mixed: false,
          default_unit_cost: null,
          default_unit_cost_currency: null,
          cost_is_mixed: false,
        },
      ]);
      setShowAdd(false);
      setAddSupplierId("");
    });
  }

  function handleRemove(row: ProductSupplierSummary) {
    if (
      !confirm(
        `Αφαίρεση του προμηθευτή «${row.supplier_name}» από όλες τις ${row.variant_count} παραλλαγές αυτού του προϊόντος;`
      )
    )
      return;
    setError(null);
    const prev = rows;
    setRows((cur) => cur.filter((r) => r.supplier_id !== row.supplier_id));
    startTransition(async () => {
      const r = await removeProductSupplier({
        productId,
        supplierId: row.supplier_id,
      });
      if (!r.success) {
        setError(r.error);
        setRows(prev);
      } else {
        refreshFromServer();
      }
    });
  }

  function handleSetPreferred(row: ProductSupplierSummary, next: boolean) {
    if (!next) return; // can't un-prefer; another supplier promotes instead
    setError(null);
    setRows((cur) =>
      cur.map((r) => ({
        ...r,
        is_preferred: r.supplier_id === row.supplier_id,
      }))
    );
    startTransition(async () => {
      const r = await setProductSupplier({
        productId,
        supplierId: row.supplier_id,
        isPreferred: true,
      });
      if (!r.success) {
        setError(r.error);
        refreshFromServer();
      } else {
        refreshFromServer();
      }
    });
  }

  return (
    <section className="cms-card-section space-y-5">
      <header className="flex items-start justify-between gap-3 pb-3 -mt-1 mb-1 border-b border-foreground/15">
        <div>
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <Users className="w-4 h-4" />
            Προμηθευτές
          </h2>
          <p className="text-sm text-foreground/70 mt-1.5 max-w-2xl">
            Συνδέστε προμηθευτές που πουλάνε αυτό το προϊόν. Το SKU και το
            κόστος ορίζονται ανά προμηθευτή — εφαρμόζονται σε όλες τις
            παραλλαγές του προϊόντος. Για διαφοροποίηση ανά παραλλαγή
            επεξεργαστείτε την παραλλαγή ξεχωριστά.
          </p>
        </div>
        {!showAdd && variantCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="btn btn-secondary btn-sm shrink-0"
          >
            <span className="text-base leading-none">+</span> Προσθήκη
          </button>
        )}
      </header>

      {variantCount === 0 && (
        <p className="rounded-md border border-foreground/20 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Δεν υπάρχουν παραλλαγές για αυτό το προϊόν. Δημιουργήστε
          τουλάχιστον μία παραλλαγή στην καρτέλα «Παραλλαγές» πριν
          συνδέσετε προμηθευτή.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="text-sm text-destructive bg-destructive/5 border border-destructive/30 rounded-md px-3 py-2"
        >
          {error}
        </p>
      )}

      {rows.length === 0 && !showAdd && variantCount > 0 && (
        <div className="cms-empty">
          Δεν έχει συνδεθεί προμηθευτής. Προσθέστε έναν για να
          εμφανίζεται στις παραγγελίες προμηθειών.
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <SupplierCard
              key={row.supplier_id}
              row={row}
              productId={productId}
              isPending={isPending}
              onPreferredChange={(next) => handleSetPreferred(row, next)}
              onRemove={() => handleRemove(row)}
              onUpdated={refreshFromServer}
              onError={setError}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <div className="rounded-md border border-foreground/15 bg-muted/20 p-3 space-y-3">
          {availableSuppliers.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1.5 flex-1 min-w-[220px]">
                <span className="text-sm font-medium">Σύνδεση υπάρχοντος προμηθευτή</span>
                <select
                  value={addSupplierId}
                  onChange={(e) => setAddSupplierId(e.target.value)}
                  className="cms-input"
                >
                  <option value="">— επιλέξτε —</option>
                  {availableSuppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleAdd}
                disabled={isPending || !addSupplierId}
                className="btn btn-primary btn-md"
              >
                Σύνδεση
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAdd(false);
                  setAddSupplierId("");
                }}
                className="btn btn-secondary btn-md"
              >
                Άκυρο
              </button>
            </div>
          )}

          {/* Deep-link "create new supplier" CTA. Carries returnTo so
              the supplier-creation page redirects back here after save.
              When all suppliers are already linked, this is the ONLY
              available action in the add panel. */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-foreground/15">
            <p className="text-xs text-muted-foreground">
              {availableSuppliers.length > 0
                ? "Δεν βρίσκετε τον προμηθευτή που χρειάζεστε;"
                : "Όλοι οι υπάρχοντες προμηθευτές είναι ήδη συνδεδεμένοι."}
            </p>
            <Link
              href={`/admin/suppliers/new?returnTo=${encodeURIComponent(
                `/admin/products?focus=${productId}`
              )}`}
              className="btn btn-secondary btn-sm whitespace-nowrap"
            >
              <span className="text-base leading-none">+</span> Νέος προμηθευτής
            </Link>
          </div>
        </div>
      )}

      {availableSuppliers.length === 0 && rows.length > 0 && !showAdd && (
        <p className="text-xs text-muted-foreground">
          Όλοι οι διαθέσιμοι προμηθευτές έχουν ήδη ανατεθεί.
        </p>
      )}
    </section>
  );
}

/**
 * One card per (product, supplier) pair. Edits SKU + cost locally,
 * commits on blur. Each commit fans the value out to every supplier_
 * products row for this product.
 */
function SupplierCard({
  row,
  productId,
  isPending,
  onPreferredChange,
  onRemove,
  onUpdated,
  onError,
}: {
  row: ProductSupplierSummary;
  productId: string;
  isPending: boolean;
  onPreferredChange: (next: boolean) => void;
  onRemove: () => void;
  onUpdated: () => void;
  onError: (msg: string) => void;
}) {
  const [, startTransition] = useTransition();
  const [skuDraft, setSkuDraft] = useState(row.default_supplier_sku ?? "");
  const [costDraft, setCostDraft] = useState(
    row.default_unit_cost === null ? "" : row.default_unit_cost.toFixed(2)
  );
  const [ccyDraft, setCcyDraft] = useState(
    row.default_unit_cost_currency ?? row.supplier_default_currency
  );

  function commitSku() {
    const next = skuDraft.trim() || null;
    if (next === (row.default_supplier_sku ?? null)) return;
    startTransition(async () => {
      const r = await setProductSupplier({
        productId,
        supplierId: row.supplier_id,
        supplierSku: next,
      });
      if (!r.success) onError(r.error);
      else onUpdated();
    });
  }

  function commitCost() {
    const trimmed = costDraft.trim();
    const ccy = ccyDraft.trim().toUpperCase() || row.supplier_default_currency;
    if (trimmed === "") {
      // Clear cost
      if (row.default_unit_cost === null) return; // nothing changed
      startTransition(async () => {
        const r = await setProductSupplier({
          productId,
          supplierId: row.supplier_id,
          unitCost: null,
          unitCostCurrency: null,
        });
        if (!r.success) onError(r.error);
        else onUpdated();
      });
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return;
    if (
      n === row.default_unit_cost &&
      ccy === (row.default_unit_cost_currency ?? "")
    )
      return;
    startTransition(async () => {
      const r = await setProductSupplier({
        productId,
        supplierId: row.supplier_id,
        unitCost: n,
        unitCostCurrency: ccy,
      });
      if (!r.success) onError(r.error);
      else onUpdated();
    });
  }

  return (
    <article className="rounded-md border border-foreground/15 bg-card p-3 space-y-2.5">
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Toggle
            checked={row.is_preferred}
            onChange={onPreferredChange}
            disabled={row.is_preferred}
            size="sm"
            ariaLabel={`Ορισμός ${row.supplier_name} ως προτιμώμενου`}
            title={
              row.is_preferred
                ? "Προτιμώμενος για όλες τις παραλλαγές"
                : "Πατήστε για ορισμό ως προτιμώμενος"
            }
          />
          <h3 className="font-semibold tracking-tight text-sm truncate">
            {row.supplier_name}
          </h3>
          {row.is_preferred && (
            <span className="cms-badge cms-badge-neutral">
              <span className="cms-badge-dot" aria-hidden />
              Προτιμώμενος
            </span>
          )}
          {row.variant_count < row.total_variant_count && (
            <span
              className="cms-badge cms-badge-muted"
              title={`Συνδεδεμένος σε ${row.variant_count} από ${row.total_variant_count} παραλλαγές`}
            >
              {row.variant_count}/{row.total_variant_count}
            </span>
          )}
        </div>
        <DeleteButton
          onClick={onRemove}
          ariaLabel={`Αφαίρεση ${row.supplier_name}`}
          title="Αφαίρεση από όλες τις παραλλαγές"
          disabled={isPending}
        />
      </header>

      {/* SKU + Cost+Currency side-by-side. SKU takes the flex remainder
          (typically 8-12 chars); Cost+Currency is a fixed 220px fused
          control. Wraps to a stack on very narrow card widths. */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block flex-1 min-w-[140px]">
          <span className="block text-xs font-medium mb-1 text-muted-foreground">
            SKU προμηθευτή
          </span>
          <input
            value={skuDraft}
            onChange={(e) => setSkuDraft(e.target.value)}
            onBlur={commitSku}
            placeholder={row.sku_is_mixed ? "(διαφορετικό ανά παραλλαγή)" : "—"}
            disabled={row.sku_is_mixed || isPending}
            className="cms-input font-mono"
          />
          {row.sku_is_mixed && (
            <span className="block text-[11px] text-muted-foreground italic mt-0.5">
              Διαφορετικό ανά παραλλαγή.
            </span>
          )}
        </label>

        {/* Cost + currency fused control. Fixed 220px so it doesn't
            grow alongside the SKU field. commitCost binds to both
            input blur AND select change so changing currency without
            touching the amount still persists. */}
        <div className="block w-[220px] shrink-0">
          <span className="block text-xs font-medium mb-1 text-muted-foreground">
            Κόστος μονάδας
          </span>
          <div
            className={`flex items-stretch h-10 rounded-md border border-foreground/20 bg-background overflow-hidden transition-colors focus-within:border-foreground focus-within:ring-2 focus-within:ring-foreground/15 ${
              row.cost_is_mixed || isPending ? "opacity-50" : ""
            }`}
          >
            <input
              type="number"
              step="0.01"
              min={0}
              value={costDraft}
              onChange={(e) => setCostDraft(e.target.value)}
              onBlur={commitCost}
              placeholder={row.cost_is_mixed ? "(μικτό)" : "—"}
              disabled={row.cost_is_mixed || isPending}
              className="flex-1 min-w-0 font-mono text-right bg-transparent border-0 outline-none focus:ring-0 px-3 text-sm"
            />
            <select
              value={ccyDraft}
              onChange={(e) => {
                setCcyDraft(e.target.value);
              }}
              onBlur={commitCost}
              disabled={row.cost_is_mixed || isPending}
              className="border-0 border-l border-foreground/20 bg-muted/50 font-mono uppercase text-sm px-2 outline-none focus:ring-0 cursor-pointer hover:bg-muted/70 transition-colors disabled:cursor-not-allowed"
            >
              {(ccyDraft &&
              !CURRENCY_OPTIONS.includes(
                ccyDraft as (typeof CURRENCY_OPTIONS)[number]
              )
                ? [ccyDraft, ...CURRENCY_OPTIONS]
                : CURRENCY_OPTIONS
              ).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {row.cost_is_mixed && (
            <span className="block text-[11px] text-muted-foreground italic mt-0.5">
              Διαφορετικό ανά παραλλαγή.
            </span>
          )}
        </div>
      </div>

      {(row.sku_is_mixed || row.cost_is_mixed) && (
        <p className="text-xs text-muted-foreground">
          <Link
            href={`/admin/products?focus=${productId}`}
            className="underline hover:text-foreground"
          >
            Άνοιγμα προϊόντος
          </Link>{" "}
          για επεξεργασία ανά παραλλαγή.
        </p>
      )}
    </article>
  );
}
