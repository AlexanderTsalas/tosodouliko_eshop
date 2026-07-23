"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setInventoryLevel } from "@/actions/inventory/setInventoryLevel";
import { addInventoryVariantsToDrafts } from "@/actions/supply-orders/addInventoryVariantsToDrafts";
import { removeInventoryVariantsFromDrafts } from "@/actions/supply-orders/removeInventoryVariantsFromDrafts";
import { useDraftToggleToast } from "@/components/admin/inventory/DraftToggleToast";
import { stockStatus, type StockStatus } from "@/types/inventory-sync";

export type InventoryDraftState = "none" | "draft" | "placed";

interface Props {
  variantId: string;
  sku: string;
  productName: string;
  /**
   * Resolved attribute label entries (already de-referenced from UUIDs into
   * display text by the page). Each entry is a row in the chip list.
   */
  attributeEntries?: Array<{ slug: string; label: string }>;
  initialAvailable: number;
  initialReserved: number;
  /** Units currently held by customers in active checkout sessions. Read-only here. */
  initialSoftHeld: number;
  /** Units currently held by wishlist priority notifications. Read-only here. */
  initialPriorityHeld: number;
  initialThreshold: number;
  initialDraftState?: InventoryDraftState;
  tableless?: boolean;
}

const BADGE: Record<StockStatus, { label: string; className: string }> = {
  out: { label: "Άδειο", className: "bg-destructive text-destructive-foreground" },
  low: { label: "Χαμηλό", className: "bg-amber-500 text-white" },
  ok: { label: "Διαθέσιμο", className: "bg-emerald-600 text-white" },
};

export default function InventoryRow({
  variantId,
  sku,
  productName,
  attributeEntries,
  initialAvailable,
  initialReserved,
  initialSoftHeld,
  initialPriorityHeld,
  initialThreshold,
  initialDraftState = "none",
  tableless = false,
}: Props) {
  const { showRemoved } = useDraftToggleToast();
  const [available, setAvailable] = useState(initialAvailable);
  const [reserved, setReserved] = useState(initialReserved);
  const [threshold, setThreshold] = useState(initialThreshold);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [draftState, setDraftState] = useState<InventoryDraftState>(initialDraftState);

  // Reconcile each piece of server-owned state with the latest props after
  // router.refresh() lands. Without these, a bulk admin action (e.g. setting
  // the threshold on 35 rows at once) succeeds at the DB but the already-
  // mounted rows keep their stale useState — same key in the table tbody, no
  // remount. The trade-off is that an in-progress unsaved edit in one of
  // these inputs gets overwritten by the server truth on the next refresh —
  // acceptable, since refresh is admin-initiated and the user can retype.
  useEffect(() => {
    setDraftState(initialDraftState);
  }, [initialDraftState]);
  useEffect(() => {
    setAvailable(initialAvailable);
  }, [initialAvailable]);
  useEffect(() => {
    setReserved(initialReserved);
  }, [initialReserved]);
  useEffect(() => {
    setThreshold(initialThreshold);
  }, [initialThreshold]);

  // soft_held and priority_held are read-only here — the customer-facing flow
  // mutates them via hold_soft / release_soft / promote_soft_to_reserved.
  // Admin doesn't get to edit them directly from this row.
  const softHeld = initialSoftHeld;
  const priorityHeld = initialPriorityHeld;
  const hasActiveHolds = softHeld > 0 || priorityHeld > 0;

  function performSave() {
    setError(null);
    setConfirmOpen(false);
    startTransition(async () => {
      const r = await setInventoryLevel({
        variantId,
        quantityAvailable: available,
        // quantity_reserved intentionally omitted — managed by the
        // order lifecycle. The "Held" cell below is now read-only.
        lowStockThreshold: threshold,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setSavedAt(Date.now());
    });
  }

  function handleSave() {
    // If there are active holds, gate the save behind a confirmation modal so
    // the admin understands the implications. Without holds, save immediately.
    if (hasActiveHolds) {
      setConfirmOpen(true);
      return;
    }
    performSave();
  }

  function handleAddToDraft() {
    setError(null);
    const previous = draftState;
    setDraftState("draft"); // optimistic
    startTransition(async () => {
      const r = await addInventoryVariantsToDrafts({ variantIds: [variantId] });
      if (!r.success) {
        setDraftState(previous);
        setError(r.error);
        return;
      }
      const outcome = r.data.results[0];
      if (outcome?.outcome === "no_supplier") {
        setDraftState(previous);
        setError("Κανένας προμηθευτής συνδεδεμένος με αυτή την παραλλαγή.");
        return;
      }
      if (outcome?.outcome === "error") {
        setDraftState(previous);
        setError(outcome.reason ?? "Σφάλμα");
        return;
      }
      setSavedAt(Date.now());
    });
  }

  function handleRemoveFromDraft() {
    setError(null);
    const previous = draftState;
    setDraftState("none"); // optimistic
    startTransition(async () => {
      const r = await removeInventoryVariantsFromDrafts({ variantIds: [variantId] });
      if (!r.success) {
        setDraftState(previous);
        setError(r.error);
        return;
      }
      if (r.data.removed === 0) {
        // Already wasn't on a draft — server truth takes over on refresh.
        return;
      }
      showRemoved(r.data.removedLines);
    });
  }

  const status = stockStatus({ quantity_available: available, low_stock_threshold: threshold });
  const badge = BADGE[status];

  const attrEntries = attributeEntries ?? [];

  // Projected totals for the confirmation modal.
  const totalBefore = initialAvailable + initialReserved + softHeld + priorityHeld;
  const totalAfter = available + reserved + softHeld + priorityHeld;

  const cells = (
    <>
      <td className="py-2 px-3 align-middle text-left">{productName}</td>
      <td className="py-2 px-3 align-middle">
        {attrEntries.length === 0 ? (
          <span className="text-muted-foreground text-xs">default</span>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {attrEntries.map((e) => (
              <span
                key={e.slug}
                className="cms-badge cms-badge-muted font-mono"
              >
                {e.slug}: {e.label}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="py-2 px-3 align-middle font-mono text-sm">{sku}</td>
      <td className="py-2 px-3 align-middle text-center">
        <input
          type="number"
          min={0}
          value={available}
          onChange={(e) => setAvailable(Math.max(0, Number(e.target.value)))}
          className={`w-20 border rounded px-2 py-1 text-center ${
            hasActiveHolds && available !== initialAvailable
              ? "border-amber-500 bg-amber-50"
              : ""
          }`}
        />
      </td>
      <td
        className="py-2 px-3 align-middle text-center"
        title="Διαχειρίζεται αυτόματα από τις παραγγελίες — δεν επεξεργάζεται απευθείας."
      >
        <span className="inline-block w-20 text-center font-mono tabular-nums text-sm text-muted-foreground py-1 px-2">
          {reserved}
        </span>
      </td>
      <td className="py-2 px-3 align-middle text-center">
        {softHeld + priorityHeld === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            className="inline-flex items-center gap-1 font-mono text-amber-700"
            title={
              priorityHeld > 0
                ? `${softHeld} σε ενεργό checkout · ${priorityHeld} priority hold (wishlist)`
                : `${softHeld} τεμάχια σε ενεργές αγορές πελατών`
            }
          >
            <span aria-hidden="true">⚠</span>
            {softHeld + priorityHeld}
          </span>
        )}
      </td>
      <td className="py-2 px-3 align-middle text-center">
        <input
          type="number"
          min={0}
          value={threshold}
          onChange={(e) => setThreshold(Math.max(0, Number(e.target.value)))}
          className="w-20 border rounded px-2 py-1 text-center"
          title="Quantity at or below which the variant is flagged as low-stock. 0 = never."
        />
      </td>
      <td className="py-2 px-3 align-middle text-center">
        <span className={`inline-block rounded px-2 py-0.5 text-xs whitespace-nowrap ${badge.className}`}>
          {badge.label}
        </span>
      </td>
      <td className="py-2 px-3 align-middle">
        <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="btn btn-primary btn-sm"
          >
            {isPending ? "..." : "Save"}
          </button>
          {draftState === "draft" ? (
            <button
              type="button"
              onClick={handleRemoveFromDraft}
              disabled={isPending}
              title="Αφαίρεση από το draft προμηθευτή"
              className="btn btn-destructive btn-sm"
            >
              − draft
            </button>
          ) : draftState === "placed" ? (
            <span
              title="Έχει παραγγελθεί σε προμηθευτή — σε αναμονή παράδοσης. Για επανα-draft σε άλλον προμηθευτή χρησιμοποιήστε τη σελίδα Παραγγελιών Προμηθευτών."
              className="cms-badge cms-badge-muted cursor-default"
            >
              Σε Παραγγελία
            </span>
          ) : (
            <button
              type="button"
              onClick={handleAddToDraft}
              disabled={isPending}
              title="Προσθήκη στο draft προμηθευτή"
              className="btn btn-secondary btn-sm"
            >
              + draft
            </button>
          )}
        </div>
      </td>
      <td className="py-2 pr-3 align-middle text-xs text-center">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : savedAt ? (
          <span className="text-emerald-600">✓</span>
        ) : null}
      </td>
    </>
  );

  const modal = (
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Υπάρχουν ενεργές αγορές για αυτό το προϊόν</DialogTitle>
          <DialogDescription>
            {productName}
            {attrEntries.length > 0 && (
              <span className="text-muted-foreground">
                {" "}
                ·{" "}
                {attrEntries.map((e) => `${e.slug}: ${e.label}`).join(" · ")}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium mb-1">⚠ Τι σημαίνει αυτό</p>
          <p>
            {softHeld + priorityHeld}{" "}
            {softHeld + priorityHeld === 1 ? "τεμάχιο" : "τεμάχια"} βρίσκονται
            αυτή τη στιγμή σε ενεργές αγορές πελατών. Η αλλαγή που κάνετε εδώ
            επηρεάζει <strong>μόνο τα ελεύθερα διαθέσιμα τεμάχια</strong> και
            δεν αγγίζει αυτά που έχουν ήδη «κλειστεί» από πελάτες σε αγορά.
          </p>
        </div>

        <div className="text-sm">
          <p className="font-medium mb-2">Λογιστική κατάσταση:</p>
          <table className="w-full">
            <thead>
              <tr className="text-left text-muted-foreground text-xs">
                <th className="font-normal pb-1"></th>
                <th className="font-normal pb-1 text-center">Πριν</th>
                <th className="font-normal pb-1 text-center">Μετά</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              <tr>
                <td>Διαθέσιμα</td>
                <td className="text-center">{initialAvailable}</td>
                <td className="text-center">{available}</td>
              </tr>
              <tr>
                <td>Δεσμευμένα</td>
                <td className="text-center">{initialReserved}</td>
                <td className="text-center">{reserved}</td>
              </tr>
              <tr>
                <td>Σε ενεργή αγορά</td>
                <td className="text-center">{softHeld}</td>
                <td className="text-center">{softHeld}</td>
              </tr>
              {priorityHeld > 0 && (
                <tr>
                  <td>Priority hold</td>
                  <td className="text-center">{priorityHeld}</td>
                  <td className="text-center">{priorityHeld}</td>
                </tr>
              )}
              <tr className="border-t font-medium">
                <td>Σύνολο λογιστικής</td>
                <td className="text-center">{totalBefore}</td>
                <td className="text-center">{totalAfter}</td>
              </tr>
            </tbody>
          </table>
          {totalAfter > totalBefore && (
            <p className="mt-2 text-xs text-amber-900">
              Η αλλαγή σας αυξάνει το συνολικό απόθεμα κατά{" "}
              {totalAfter - totalBefore}. Σιγουρευτείτε ότι αυτό αντικατοπτρίζει
              τα τεμάχια που έχετε πραγματικά στο φυσικό απόθεμα.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="rounded border px-4 py-2 text-sm"
          >
            Ακύρωση
          </button>
          <button
            type="button"
            onClick={performSave}
            disabled={isPending}
            className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
          >
            {isPending ? "Αποθήκευση..." : "Κατάλαβα — αποθήκευση"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (tableless) {
    return (
      <>
        {cells}
        {modal}
      </>
    );
  }
  return (
    <>
      <tr className="border-b align-top">{cells}</tr>
      {modal}
    </>
  );
}
