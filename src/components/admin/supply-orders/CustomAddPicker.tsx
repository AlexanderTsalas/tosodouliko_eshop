"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  searchSupplierVariants,
  type SupplierVariantResult,
} from "@/actions/suppliers/searchSupplierVariants";
import { addToDraft } from "@/actions/supply-orders/addToDraft";

interface Props {
  supplierId: string;
  /** Variant IDs already on the draft, excluded from search results. */
  excludeIds: string[];
}

/**
 * Inline picker inside the supplier draft section that lets the admin add
 * ANY variant carried by this supplier — not just the auto-suggested low/out
 * ones. Supports typing a SKU or product name, picks one from the result
 * list, types a quantity, hits add.
 */
export default function CustomAddPicker({ supplierId, excludeIds }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SupplierVariantResult[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [qty, setQty] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [hasSearched, setHasSearched] = useState(false);

  function runSearch() {
    setError(null);
    setHasSearched(true);
    startTransition(async () => {
      const r = await searchSupplierVariants({
        supplierId,
        q: q.trim() || undefined,
        excludeIds,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setResults(r.data);
    });
  }

  function handleAdd() {
    if (!selectedId) return;
    const n = Number(qty);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      setError("Δώστε θετικό ακέραιο.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await addToDraft({
        supplierId,
        variantId: selectedId,
        orderedQty: n,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      // Reset and close — the parent will refresh and the new line will appear.
      setQ("");
      setResults([]);
      setSelectedId("");
      setQty("10");
      setHasSearched(false);
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary btn-sm"
      >
        + Προσθήκη προϊόντος εκτός προτεινόμενων
      </button>
    );
  }

  return (
    <div className="rounded-md border border-foreground/15 bg-muted/20 p-3 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          Αναζήτηση προϊόντος αυτού του προμηθευτή
        </span>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setHasSearched(false);
            setResults([]);
            setSelectedId("");
          }}
          aria-label="Κλείσιμο"
          className="btn btn-secondary btn-sm"
        >
          ✕
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Αναζήτηση SKU ή όνομα..."
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch();
            }
          }}
          className="cms-input cms-input-sm flex-1"
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={isPending}
          className="btn btn-secondary btn-sm"
        >
          Αναζήτηση
        </button>
      </div>

      {hasSearched && results.length === 0 && !isPending && (
        <p className="text-xs text-muted-foreground italic">
          Δεν βρέθηκαν προϊόντα συνδεδεμένα με αυτόν τον προμηθευτή.
        </p>
      )}

      {results.length > 0 && (
        <ul className="border border-foreground/15 rounded-md max-h-48 overflow-y-auto divide-y divide-foreground/10 bg-background">
          {results.map((r) => (
            <li
              key={r.variant_id}
              onClick={() => setSelectedId(r.variant_id)}
              className={`px-3 py-2 cursor-pointer transition-colors ${
                selectedId === r.variant_id
                  ? "bg-muted/60 font-medium"
                  : "hover:bg-muted/30"
              }`}
            >
              <p className="text-sm">
                {r.product_name}
                {r.variant_label && (
                  <span className="text-muted-foreground">
                    {" "}· {r.variant_label}
                  </span>
                )}
              </p>
              <p className="text-muted-foreground font-mono text-[11px] mt-0.5">
                {r.business_sku}
                {r.supplier_sku && ` · ${r.supplier_sku}`} · stock{" "}
                {r.quantity_available}/{r.low_stock_threshold}
              </p>
            </li>
          ))}
        </ul>
      )}

      {selectedId && (
        <div className="flex items-center gap-2 border-t border-foreground/10 pt-3">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Ποσότητα:</span>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="cms-input cms-input-sm w-20 text-center font-mono"
            />
          </label>
          <button
            type="button"
            onClick={handleAdd}
            disabled={isPending}
            className="btn btn-primary btn-sm"
          >
            + Προσθήκη στο draft
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
