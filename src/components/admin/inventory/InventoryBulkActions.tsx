"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  bulkSetQuantity,
  bulkSetThreshold,
  bulkSetTrackSupply,
} from "@/actions/inventory/bulkInventoryOps";
import { addInventoryVariantsToDrafts } from "@/actions/supply-orders/addInventoryVariantsToDrafts";
import { removeInventoryVariantsFromDrafts } from "@/actions/supply-orders/removeInventoryVariantsFromDrafts";
import { useDraftToggleToast } from "@/components/admin/inventory/DraftToggleToast";

interface Props {
  matchAll: boolean;
  selectedIds: string[];
  filterParams: Record<string, string>;
  /** Variants on the current page that are on an open draft — drives the +/− split. */
  draftedVariantIds: string[];
  /** Variants on the current page that are on a placed (awaiting delivery) order. */
  placedVariantIds: string[];
}

type ActionKind = null | "qty" | "threshold" | "track";

/**
 * Three bulk actions for inventory:
 *   - Set quantity to N for selected variants
 *   - Set threshold to N for selected variants
 *   - Toggle track_supply for selected variants
 *
 * Each opens a tiny inline form below the action bar to collect the value
 * before confirming. Result reporting is a transient toast/message.
 */
export default function InventoryBulkActions({
  matchAll,
  selectedIds,
  filterParams,
  draftedVariantIds,
  placedVariantIds,
}: Props) {
  const router = useRouter();
  const { showRemoved } = useDraftToggleToast();
  const [active, setActive] = useState<ActionKind>(null);
  const [value, setValue] = useState("");
  const [trackValue, setTrackValue] = useState<"yes" | "no">("yes");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Partition the explicit selection into three buckets:
  //   - addable: not on any open supply order (eligible for "+ Στο draft")
  //   - onDraft: in a current draft (eligible for "− Από draft")
  //   - onPlaced: already ordered from a supplier (excluded from both bulk
  //     actions; admin re-drafts on the supply-orders page if needed)
  const draftedSet = new Set(draftedVariantIds);
  const placedSet = new Set(placedVariantIds);
  const addableSelected = matchAll
    ? []
    : selectedIds.filter((id) => !draftedSet.has(id) && !placedSet.has(id));
  const onDraftSelected = matchAll ? [] : selectedIds.filter((id) => draftedSet.has(id));
  const onPlacedSelected = matchAll ? [] : selectedIds.filter((id) => placedSet.has(id));

  function reset() {
    setActive(null);
    setValue("");
    setError(null);
    setResult(null);
  }

  function handleAddToDraft() {
    if (matchAll || addableSelected.length === 0) return;
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await addInventoryVariantsToDrafts({ variantIds: addableSelected });
      if (!r.success) {
        setError(r.error);
        return;
      }
      const noSupplier = r.data.results.filter((x) => x.outcome === "no_supplier").length;
      const errors = r.data.results.filter((x) => x.outcome === "error").length;
      const parts: string[] = [`${r.data.added} προστέθηκαν`];
      if (noSupplier > 0) parts.push(`${noSupplier} χωρίς προμηθευτή`);
      if (errors > 0) parts.push(`${errors} αποτυχ${errors === 1 ? "ία" : "ίες"}`);
      setResult(parts.join(" · "));
      router.refresh();
    });
  }

  function handleRemoveFromDraft() {
    if (matchAll || onDraftSelected.length === 0) return;
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await removeInventoryVariantsFromDrafts({ variantIds: onDraftSelected });
      if (!r.success) {
        setError(r.error);
        return;
      }
      if (r.data.removed > 0) {
        showRemoved(r.data.removedLines);
      }
      router.refresh();
    });
  }

  function handleSubmit() {
    setError(null);
    setResult(null);

    const baseInput = {
      ids: matchAll ? null : selectedIds,
      matchAll,
      filterParams: matchAll ? filterParams : undefined,
    };

    startTransition(async () => {
      let res:
        | Awaited<ReturnType<typeof bulkSetQuantity>>
        | Awaited<ReturnType<typeof bulkSetThreshold>>
        | Awaited<ReturnType<typeof bulkSetTrackSupply>>;

      if (active === "qty") {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) {
          setError("Δώστε ακέραιο αριθμό ≥ 0.");
          return;
        }
        res = await bulkSetQuantity({ ...baseInput, quantity: n });
      } else if (active === "threshold") {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) {
          setError("Δώστε ακέραιο αριθμό ≥ 0.");
          return;
        }
        res = await bulkSetThreshold({ ...baseInput, threshold: n });
      } else if (active === "track") {
        res = await bulkSetTrackSupply({ ...baseInput, trackSupply: trackValue === "yes" });
      } else {
        return;
      }

      if (!res.success) {
        setError(res.error);
        return;
      }
      setResult(
        `${res.data.succeeded} επιτυχία${res.data.succeeded === 1 ? "" : "ς"}` +
          (res.data.failed.length > 0
            ? ` · ${res.data.failed.length} αποτυχία${res.data.failed.length === 1 ? "" : "ες"}`
            : "")
      );
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setActive("qty")}
        disabled={isPending}
        className="rounded border px-3 py-1 text-xs"
      >
        Ορισμός ποσότητας
      </button>
      <button
        type="button"
        onClick={() => setActive("threshold")}
        disabled={isPending}
        className="rounded border px-3 py-1 text-xs"
      >
        Ορισμός ορίου
      </button>
      <button
        type="button"
        onClick={() => setActive("track")}
        disabled={isPending}
        className="rounded border px-3 py-1 text-xs"
      >
        Παρακολούθηση on/off
      </button>
      {addableSelected.length > 0 && (
        <button
          type="button"
          onClick={handleAddToDraft}
          disabled={isPending || matchAll}
          title={
            matchAll
              ? "Διαθέσιμο μόνο σε ρητή επιλογή — όχι σε matchAll"
              : "Στέλνει τα επιλεγμένα variants στο draft του προτιμώμενου προμηθευτή τους"
          }
          className="rounded border border-primary text-primary px-3 py-1 text-xs disabled:opacity-40"
        >
          + Στο draft ({addableSelected.length})
        </button>
      )}
      {onDraftSelected.length > 0 && (
        <button
          type="button"
          onClick={handleRemoveFromDraft}
          disabled={isPending || matchAll}
          title={
            matchAll
              ? "Διαθέσιμο μόνο σε ρητή επιλογή — όχι σε matchAll"
              : "Αφαιρεί τα επιλεγμένα variants από τα drafts στα οποία βρίσκονται"
          }
          className="rounded border border-amber-500 text-amber-700 px-3 py-1 text-xs disabled:opacity-40"
        >
          − Από draft ({onDraftSelected.length})
        </button>
      )}
      {onPlacedSelected.length > 0 && (
        <span
          title="Τα επιλεγμένα έχουν ήδη παραγγελθεί. Για επανα-draft σε άλλον προμηθευτή χρησιμοποιήστε τη σελίδα Παραγγελιών Προμηθευτών."
          className="rounded border border-sky-300 bg-sky-50 text-sky-700 px-3 py-1 text-xs cursor-default"
        >
          📦 Παραγγέλθηκαν ({onPlacedSelected.length})
        </span>
      )}

      {active !== null && (
        <div className="basis-full mt-2 border rounded p-2 flex items-center gap-2 text-xs bg-background">
          {active === "qty" && (
            <>
              <label className="flex items-center gap-1">
                <span>Νέα ποσότητα:</span>
                <input
                  type="number"
                  min={0}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="border rounded px-2 py-0.5 w-24"
                  autoFocus
                />
              </label>
            </>
          )}
          {active === "threshold" && (
            <>
              <label className="flex items-center gap-1">
                <span>Νέο όριο:</span>
                <input
                  type="number"
                  min={0}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="border rounded px-2 py-0.5 w-24"
                  autoFocus
                />
              </label>
              <span className="text-muted-foreground">0 = χωρίς παρακολούθηση</span>
            </>
          )}
          {active === "track" && (
            <label className="flex items-center gap-1">
              <span>Παρακολούθηση:</span>
              <select
                value={trackValue}
                onChange={(e) => setTrackValue(e.target.value as "yes" | "no")}
                className="border rounded px-2 py-0.5"
              >
                <option value="yes">Ναι</option>
                <option value="no">Όχι</option>
              </select>
            </label>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="rounded bg-primary text-primary-foreground px-3 py-0.5"
          >
            {isPending ? "..." : "Εφαρμογή"}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={isPending}
            className="text-muted-foreground underline"
          >
            Ακύρωση
          </button>
        </div>
      )}

      {error && <span className="basis-full text-xs text-destructive">{error}</span>}
      {result && <span className="basis-full text-xs text-emerald-700">{result}</span>}
    </>
  );
}
