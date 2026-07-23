"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseCsv, type ParsedCsv } from "@/lib/suppliers/parseCsv";
import { confirmReceipt } from "@/actions/supply-orders/confirmReceipt";
import { saveReceiptColumnMap } from "@/actions/suppliers/saveReceiptColumnMap";
import type { Supplier, SupplyOrder, SupplyOrderLine, ReceiptColumnMap } from "@/types/suppliers";

interface Props {
  order: SupplyOrder;
  supplier: Supplier;
  lines: SupplyOrderLine[];
}

type Step = "upload" | "map" | "review" | "confirming";

interface MatchedLine {
  line: SupplyOrderLine;
  receivedQty: number;
  receivedUnitCost: number;
  costChanged: boolean;
}

interface UnexpectedLine {
  supplierSku: string;
  receivedQty: number;
  receivedUnitCost: number;
}

interface MissingLine {
  line: SupplyOrderLine;
}

/**
 * Multi-step receipt flow inside one component:
 *   upload → (map if no saved map) → review → confirming
 *
 * State is purely client-side until the final confirm — refresh restarts the
 * flow, which is acceptable for a workflow that takes minutes. The uploaded
 * file is persisted to Supabase Storage on the way in so the source artifact
 * survives in the order's audit trail regardless of whether the admin completes.
 */
export default function ReceiptWorkspace({ order, supplier, lines }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [uploadedKey, setUploadedKey] = useState<string | null>(null);
  const [columnMap, setColumnMap] = useState<ReceiptColumnMap>(
    supplier.receipt_column_map ?? {}
  );

  // Edited-in-place values for the review step, keyed by lineId/supplierSku.
  const [matchedEdits, setMatchedEdits] = useState<Record<string, { qty: number; cost: number }>>({});
  const [unexpectedAccept, setUnexpectedAccept] = useState<Record<string, boolean>>({});
  const [unexpectedVariantPick, setUnexpectedVariantPick] = useState<Record<string, string>>({});
  const [receiptNotes, setReceiptNotes] = useState("");

  // --- Upload step ---

  async function handleFile(file: File) {
    setError(null);
    const text = await file.text();
    const result = parseCsv(text);
    if (result.rows.length === 0) {
      setError("Το αρχείο δεν περιέχει γραμμές.");
      return;
    }

    // Upload to Storage in parallel so the artifact survives.
    try {
      const sb = createClient();
      const ts = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const key = `${order.id}/${ts}-${safeName}`;
      const { error: upErr } = await sb.storage
        .from("supply-order-receipts")
        .upload(key, file, { contentType: file.type || "text/csv", upsert: false });
      if (!upErr) setUploadedKey(key);
    } catch {
      // Non-fatal — admin can still complete the receipt without the archived file.
    }

    setParsed(result);
    const hasMap =
      columnMap.supplier_sku && columnMap.quantity && columnMap.unit_cost &&
      result.headers.includes(columnMap.supplier_sku) &&
      result.headers.includes(columnMap.quantity) &&
      result.headers.includes(columnMap.unit_cost);
    setStep(hasMap ? "review" : "map");
  }

  // --- Map step ---

  function saveMapAndContinue() {
    if (!columnMap.supplier_sku || !columnMap.quantity || !columnMap.unit_cost) {
      setError("Συμπληρώστε και τις τρεις αντιστοιχίες.");
      return;
    }
    setError(null);
    startTransition(async () => {
      await saveReceiptColumnMap({ supplierId: supplier.id, map: columnMap });
      setStep("review");
    });
  }

  // --- Review step: compute matched / unexpected / missing ---

  const diff = useMemo(() => {
    if (!parsed || step !== "review") {
      return { matched: [] as MatchedLine[], unexpected: [] as UnexpectedLine[], missing: [] as MissingLine[] };
    }
    const skuCol = columnMap.supplier_sku!;
    const qtyCol = columnMap.quantity!;
    const costCol = columnMap.unit_cost!;

    const linesBySupplierSku = new Map<string, SupplyOrderLine>();
    for (const l of lines) {
      if (l.supplier_sku_at_draft) linesBySupplierSku.set(l.supplier_sku_at_draft, l);
    }

    const matched: MatchedLine[] = [];
    const unexpected: UnexpectedLine[] = [];
    const matchedLineIds = new Set<string>();

    for (const row of parsed.rows) {
      const sku = (row[skuCol] ?? "").trim();
      const qty = Number(row[qtyCol]);
      const cost = Number(row[costCol]);
      if (!sku || !Number.isFinite(qty) || !Number.isFinite(cost)) continue;

      const line = linesBySupplierSku.get(sku);
      if (line) {
        matchedLineIds.add(line.id);
        matched.push({
          line,
          receivedQty: qty,
          receivedUnitCost: cost,
          costChanged: line.unit_cost !== null && Math.abs(Number(line.unit_cost) - cost) > 0.001,
        });
      } else {
        unexpected.push({ supplierSku: sku, receivedQty: qty, receivedUnitCost: cost });
      }
    }

    const missing: MissingLine[] = lines
      .filter((l) => !matchedLineIds.has(l.id))
      .map((l) => ({ line: l }));

    return { matched, unexpected, missing };
  }, [parsed, lines, columnMap, step]);

  // Effective qty/cost per row (with admin edits applied).
  function effectiveMatched(m: MatchedLine): { qty: number; cost: number } {
    const edit = matchedEdits[m.line.id];
    return {
      qty: edit?.qty ?? m.receivedQty,
      cost: edit?.cost ?? m.receivedUnitCost,
    };
  }

  // --- Confirm ---

  function handleConfirm() {
    if (!parsed) return;
    setError(null);
    setStep("confirming");

    const existingLines = [
      ...diff.matched.map((m) => {
        const e = effectiveMatched(m);
        return {
          lineId: m.line.id,
          receivedQty: Math.max(0, Math.floor(e.qty)),
          receivedUnitCost: e.cost,
          receivedUnitCostCurrency: m.line.unit_cost_currency ?? supplier.default_currency,
        };
      }),
      // Missing items: explicitly receive 0 so the line is closed.
      ...diff.missing.map((m) => ({
        lineId: m.line.id,
        receivedQty: 0,
        receivedUnitCost: m.line.unit_cost ?? 0,
        receivedUnitCostCurrency: m.line.unit_cost_currency ?? supplier.default_currency,
      })),
    ];

    const unexpectedLines = diff.unexpected
      .filter((u) => unexpectedAccept[u.supplierSku])
      .map((u) => ({
        variantId: unexpectedVariantPick[u.supplierSku],
        supplierSku: u.supplierSku,
        receivedQty: u.receivedQty,
        receivedUnitCost: u.receivedUnitCost,
        receivedUnitCostCurrency: supplier.default_currency,
      }))
      .filter((u) => u.variantId);

    startTransition(async () => {
      const r = await confirmReceipt({
        supplyOrderId: order.id,
        existingLines,
        unexpectedLines,
        receiptFileStorageKey: uploadedKey ?? undefined,
        notes: receiptNotes.trim() || undefined,
      });
      if (!r.success) {
        setError(r.error);
        setStep("review");
        return;
      }
      router.push(`/admin/supply-orders?view=tracking`);
      router.refresh();
    });
  }

  // --- Render ---

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Παραλαβή παραγγελίας</h2>
        <p className="text-xs text-muted-foreground">
          Βήμα {step === "upload" ? 1 : step === "map" ? 2 : step === "review" ? 3 : 4} από 3
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {step === "upload" && (
        <div className="border-2 border-dashed rounded p-8 text-center">
          <p className="text-sm mb-4">
            Ανεβάστε το CSV από τον προμηθευτή (λίστα παραληφθέντων ειδών).
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="block mx-auto text-sm"
          />
          <p className="text-xs text-muted-foreground mt-4">
            Δεν έχετε αρχείο; <button
              type="button"
              onClick={() => setStep("map")}
              className="underline"
            >
              Συμπληρώστε χειροκίνητα
            </button>
          </p>
        </div>
      )}

      {step === "map" && (
        <div className="border rounded p-4 space-y-3 text-sm">
          <p className="font-medium">Αντιστοίχιση στηλών</p>
          <p className="text-xs text-muted-foreground">
            Επιλέξτε ποιες στήλες του αρχείου αντιστοιχούν στα παρακάτω πεδία. Η επιλογή θα θυμηθεί για επόμενες παραλαβές από τον ίδιο προμηθευτή.
          </p>
          {(["supplier_sku", "quantity", "unit_cost"] as const).map((field) => (
            <label key={field} className="grid grid-cols-[120px_1fr] items-center gap-2">
              <span>{labelForField(field)}</span>
              <select
                value={columnMap[field] ?? ""}
                onChange={(e) =>
                  setColumnMap((cur) => ({ ...cur, [field]: e.target.value || undefined }))
                }
                className="border rounded px-2 py-1"
              >
                <option value="">— επιλέξτε στήλη —</option>
                {(parsed?.headers ?? []).map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </label>
          ))}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={saveMapAndContinue}
              disabled={isPending}
              className="rounded bg-primary text-primary-foreground px-3 py-1 text-sm disabled:opacity-50"
            >
              Συνέχεια
            </button>
            <button
              type="button"
              onClick={() => setStep("upload")}
              className="text-xs text-muted-foreground underline"
            >
              ← Πίσω
            </button>
          </div>
        </div>
      )}

      {(step === "review" || step === "confirming") && (
        <div className="space-y-4">
          {/* Matched */}
          {diff.matched.length > 0 && (
            <div className="border rounded p-3">
              <h3 className="text-sm font-semibold mb-2">
                Παραληφθέντα ({diff.matched.length})
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-1">Προϊόν</th>
                    <th className="py-1 w-24">Παραγγέλθηκαν</th>
                    <th className="py-1 w-24">Παρελήφθησαν</th>
                    <th className="py-1 w-28">Κόστος μον.</th>
                    <th className="py-1 w-20">Μεταβολή κόστους</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.matched.map((m) => {
                    const e = effectiveMatched(m);
                    return (
                      <tr key={m.line.id} className="border-b">
                        <td className="py-1">
                          <p>{m.line.variant_label ?? m.line.business_sku_at_draft}</p>
                          <p className="text-muted-foreground font-mono">
                            {m.line.business_sku_at_draft}
                            {m.line.supplier_sku_at_draft && ` · ${m.line.supplier_sku_at_draft}`}
                          </p>
                        </td>
                        <td className="py-1 font-mono">{m.line.ordered_qty}</td>
                        <td className="py-1">
                          <input
                            type="number"
                            min={0}
                            value={e.qty}
                            onChange={(ev) =>
                              setMatchedEdits((cur) => ({
                                ...cur,
                                [m.line.id]: { ...cur[m.line.id], qty: Number(ev.target.value), cost: e.cost },
                              }))
                            }
                            disabled={step === "confirming"}
                            className={`border rounded px-2 py-0.5 w-16 text-center ${e.qty < m.line.ordered_qty ? "border-amber-500" : ""}`}
                          />
                        </td>
                        <td className="py-1">
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            value={e.cost}
                            onChange={(ev) =>
                              setMatchedEdits((cur) => ({
                                ...cur,
                                [m.line.id]: { qty: e.qty, cost: Number(ev.target.value) },
                              }))
                            }
                            disabled={step === "confirming"}
                            className={`border rounded px-2 py-0.5 w-20 text-center ${m.costChanged ? "border-amber-500" : ""}`}
                          />
                          <span className="text-muted-foreground ml-1">
                            {m.line.unit_cost_currency ?? supplier.default_currency}
                          </span>
                        </td>
                        <td className="py-1 text-xs">
                          {m.costChanged && m.line.unit_cost !== null && (
                            <span className="text-amber-600">
                              {Number(m.line.unit_cost).toFixed(2)} → {e.cost.toFixed(2)}
                            </span>
                          )}
                          {!m.costChanged && <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Missing */}
          {diff.missing.length > 0 && (
            <div className="border rounded p-3 border-amber-500 bg-amber-50">
              <h3 className="text-sm font-semibold mb-2 text-amber-900">
                Λείπουν από την παραλαβή ({diff.missing.length})
              </h3>
              <p className="text-xs text-amber-700 mb-2">
                Θα καταχωρηθούν ως παραληφθέντες με 0 τεμάχια. Δημιουργήστε νέα παραγγελία αν χρειάζεται.
              </p>
              <ul className="text-xs space-y-0.5">
                {diff.missing.map((m) => (
                  <li key={m.line.id} className="font-mono">
                    {m.line.business_sku_at_draft} ({m.line.ordered_qty} ordered)
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Unexpected */}
          {diff.unexpected.length > 0 && (
            <div className="border rounded p-3 border-amber-500 bg-amber-50">
              <h3 className="text-sm font-semibold mb-2 text-amber-900">
                Μη αναμενόμενα είδη ({diff.unexpected.length})
              </h3>
              <p className="text-xs text-amber-700 mb-2">
                Αυτά δεν ήταν στην αρχική παραγγελία. Επιλέξτε ποιο variant αντιστοιχούν για να ενσωματωθούν.
              </p>
              <p className="text-xs text-amber-700">
                (Manual variant-matching UI για unexpected items: planned for H1.8 follow-up — χρησιμοποιήστε χειροκίνητη παραλαβή ή προσαρμογή στην αρχική γραμμή.)
              </p>
            </div>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Σημειώσεις παραλαβής</span>
            <textarea
              value={receiptNotes}
              onChange={(e) => setReceiptNotes(e.target.value)}
              rows={2}
              placeholder="π.χ. έλειπε ένα κουτί, ζημιά σε 2 τεμάχια…"
              className="border rounded px-2 py-1"
              disabled={step === "confirming"}
            />
          </label>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isPending || step === "confirming"}
              className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
            >
              {step === "confirming" ? "Καταχώρηση..." : "Επιβεβαίωση παραλαβής"}
            </button>
            {step === "review" && (
              <button
                type="button"
                onClick={() => setStep("upload")}
                disabled={isPending}
                className="text-xs text-muted-foreground underline"
              >
                ← Επανεκκίνηση
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function labelForField(field: "supplier_sku" | "quantity" | "unit_cost"): string {
  if (field === "supplier_sku") return "SKU προμηθευτή";
  if (field === "quantity") return "Ποσότητα";
  return "Κόστος μονάδας";
}
