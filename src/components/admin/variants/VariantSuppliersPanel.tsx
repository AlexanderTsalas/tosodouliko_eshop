"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { linkSupplierToVariant } from "@/actions/suppliers/linkSupplierToVariant";
import { updateSupplierProduct } from "@/actions/suppliers/updateSupplierProduct";
import { unlinkSupplierFromVariant } from "@/actions/suppliers/unlinkSupplierFromVariant";
import type { Supplier, SupplierCurrentCost } from "@/types/suppliers";

interface Props {
  variantId: string;
  /** Composed rows from getSuppliersForVariant() — includes latest cost + flags. */
  initial: SupplierCurrentCost[];
  /** All suppliers (active or not) for the "add link" dropdown. */
  allSuppliers: Supplier[];
  /**
   * Re-fetch hook. On the edit page this is omitted and we fall back to
   * router.refresh() (which re-renders the server component that fed
   * `initial`). Inside the side panel the data is client-fetched, so the
   * host passes a callback that re-runs that fetch.
   */
  onRefetch?: () => void;
}

export default function VariantSuppliersPanel({
  variantId,
  initial,
  allSuppliers,
  onRefetch,
}: Props) {
  const router = useRouter();
  const refresh = () => {
    if (onRefetch) onRefetch();
    else router.refresh();
  };
  const [rows, setRows] = useState(initial);

  // Sync local rows when the host re-feeds `initial` (e.g. after an
  // onRefetch in the panel re-runs getVariantExtras with the new
  // composed shape for an added supplier).
  useEffect(() => {
    setRows(initial);
  }, [initial]);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [addSupplierId, setAddSupplierId] = useState("");
  const [addSku, setAddSku] = useState("");

  const linkedSupplierIds = new Set(rows.map((r) => r.supplier_id));
  const availableSuppliers = allSuppliers.filter(
    (s) => s.active && !linkedSupplierIds.has(s.id)
  );

  function handleAdd() {
    setError(null);
    if (!addSupplierId) return;
    startTransition(async () => {
      const r = await linkSupplierToVariant({
        variantId,
        supplierId: addSupplierId,
        supplierSku: addSku.trim() || null,
        isPreferred: rows.length === 0, // first link auto-becomes preferred
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      // Refresh server data so the new row gets its proper composed shape.
      setAddSupplierId("");
      setAddSku("");
      setShowAdd(false);
      refresh();
    });
  }

  function handleMakePreferred(row: SupplierCurrentCost) {
    if (row.is_preferred) return;
    setError(null);
    setRows((cur) =>
      cur.map((r) => ({ ...r, is_preferred: r.supplier_product_id === row.supplier_product_id }))
    );
    startTransition(async () => {
      const r = await updateSupplierProduct({
        id: row.supplier_product_id,
        isPreferred: true,
      });
      if (!r.success) {
        setError(r.error);
        refresh();
      }
    });
  }

  function handleEditSku(row: SupplierCurrentCost, newSku: string) {
    const next = newSku.trim() || null;
    if (next === row.supplier_sku) return;
    setError(null);
    setRows((cur) =>
      cur.map((r) =>
        r.supplier_product_id === row.supplier_product_id ? { ...r, supplier_sku: next } : r
      )
    );
    startTransition(async () => {
      const r = await updateSupplierProduct({
        id: row.supplier_product_id,
        supplierSku: next,
      });
      if (!r.success) {
        setError(r.error);
        refresh();
      }
    });
  }

  function handleUnlink(row: SupplierCurrentCost) {
    if (!confirm(`Αφαίρεση του προμηθευτή «${row.supplier_name}» από αυτή την παραλλαγή;`)) return;
    setError(null);
    const prev = rows;
    setRows((cur) => cur.filter((r) => r.supplier_product_id !== row.supplier_product_id));
    startTransition(async () => {
      const r = await unlinkSupplierFromVariant({ id: row.supplier_product_id });
      if (!r.success) {
        setError(r.error);
        setRows(prev);
      } else {
        refresh();
      }
    });
  }

  return (
    <section className="border rounded p-4 space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Προμηθευτές αυτής της παραλλαγής</h3>
        {!showAdd && availableSuppliers.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-xs text-primary underline"
          >
            + Προσθήκη
          </button>
        )}
      </header>

      {rows.length === 0 && !showAdd && (
        <p className="text-xs text-muted-foreground">
          Δεν έχει ανατεθεί προμηθευτής. Προσθέστε έναν για να εμφανίζεται στις παραγγελίες προμηθειών.
        </p>
      )}

      {rows.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Προμηθευτής</th>
              <th className="py-1">SKU προμηθευτή</th>
              <th className="py-1">Τελευταίο κόστος</th>
              <th className="py-1 w-28">Προτιμώμενος</th>
              <th className="py-1 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.supplier_product_id} className="border-b">
                <td className="py-1">{row.supplier_name}</td>
                <td className="py-1">
                  <input
                    defaultValue={row.supplier_sku ?? ""}
                    onBlur={(e) => handleEditSku(row, e.target.value)}
                    placeholder="—"
                    className="bg-transparent border-b border-transparent hover:border-muted focus:border-primary focus:outline-none w-full font-mono"
                  />
                </td>
                <td className="py-1 font-mono">
                  {row.has_no_history ? (
                    <span className="text-muted-foreground">καμία παραγγελία</span>
                  ) : (
                    <>
                      {row.last_unit_cost?.toFixed(2)} {row.last_unit_cost_currency}
                      {row.is_stale && (
                        <span className="ml-1 text-amber-600" title="Παλιά τιμή (>60 ημέρες)">
                          ⏳
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="py-1">
                  {row.is_preferred ? (
                    <span className="rounded bg-primary/10 text-primary px-2 py-0.5 text-[10px]">
                      ✓ Προτιμώμενος
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleMakePreferred(row)}
                      disabled={isPending}
                      className="underline text-muted-foreground"
                    >
                      Όρισε προτιμώμενο
                    </button>
                  )}
                </td>
                <td className="py-1 text-center">
                  <button
                    type="button"
                    onClick={() => handleUnlink(row)}
                    disabled={isPending}
                    className="text-destructive underline"
                  >
                    Αφαίρεση
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd && (
        <div className="border-t pt-3 grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">Προμηθευτής</span>
            <select
              value={addSupplierId}
              onChange={(e) => setAddSupplierId(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="">— επιλέξτε —</option>
              {availableSuppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">SKU προμηθευτή (προαιρετικό)</span>
            <input
              value={addSku}
              onChange={(e) => setAddSku(e.target.value)}
              placeholder="π.χ. ACM-100"
              className="border rounded px-2 py-1 text-sm font-mono"
            />
          </label>
          <button
            type="button"
            onClick={handleAdd}
            disabled={isPending || !addSupplierId}
            className="rounded bg-primary text-primary-foreground px-3 py-1 text-sm disabled:opacity-50"
          >
            Σύνδεση
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAdd(false);
              setAddSupplierId("");
              setAddSku("");
            }}
            className="text-xs text-muted-foreground underline"
          >
            Ακύρωση
          </button>
        </div>
      )}

      {availableSuppliers.length === 0 && !showAdd && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Όλοι οι διαθέσιμοι προμηθευτές έχουν ανατεθεί.
        </p>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
