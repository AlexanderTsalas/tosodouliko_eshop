"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finalizeCarrierBatch } from "@/actions/courier-settings";

interface Props {
  carrierSlug: string;
  carrierDisplayName: string;
  pendingCount: number;
  /** Last successful batch_id stored in audit log, when available. */
  lastBatchId: string | null;
  lastFinalizedAt: string | null;
}

/**
 * Phase 8b — single carrier card on the daily-handoff page. One-click
 * "Κλείσιμο παρτίδας" with confirm-then-execute, result display, and
 * last-batch reference for audit.
 */
export default function DailyHandoffCard({
  carrierSlug,
  carrierDisplayName,
  pendingCount,
  lastBatchId,
  lastFinalizedAt,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    batchId?: string | null;
    voucherCount?: number | null;
  } | null>(null);

  function handleClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setResult(null);
    startTransition(async () => {
      const res = await finalizeCarrierBatch({ carrier: carrierSlug });
      if (!res.success) {
        setResult({ ok: false, message: res.error });
        return;
      }
      setResult({
        ok: true,
        message: `Παρτίδα κλείστηκε επιτυχώς${
          res.data.voucher_count != null ? ` (${res.data.voucher_count} vouchers)` : ""
        }.`,
        batchId: res.data.batch_id,
        voucherCount: res.data.voucher_count,
      });
      router.refresh();
    });
  }

  return (
    <div className="border rounded p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{carrierDisplayName}</h3>
          <p className="text-xs text-muted-foreground">
            {pendingCount > 0
              ? `${pendingCount.toLocaleString("el-GR")} vouchers σε αναμονή κλεισίματος`
              : "Καμία αναμονή"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending}
          className={`rounded px-3 py-1.5 text-sm disabled:opacity-50 ${
            confirming
              ? "bg-destructive text-destructive-foreground border border-destructive"
              : "bg-primary text-primary-foreground"
          }`}
        >
          {isPending
            ? "Κλείσιμο..."
            : confirming
              ? "Επιβεβαίωση"
              : "Κλείσιμο παρτίδας"}
        </button>
      </div>

      {confirming && !isPending && (
        <p className="text-xs text-muted-foreground">
          Μετά το κλείσιμο, τα vouchers ΔΕΝ μπορούν να ακυρωθούν αυτόματα. Ο
          courier τα παραλαμβάνει με βάση την τρέχουσα παρτίδα.{" "}
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="btn btn-secondary btn-sm ml-1"
          >
            Άκυρο
          </button>
        </p>
      )}

      {result && (
        <div
          className={`rounded border px-2 py-1.5 text-xs ${
            result.ok
              ? "border-emerald-500 bg-emerald-50 text-emerald-900"
              : "border-destructive bg-destructive/10 text-destructive"
          }`}
        >
          {result.message}
          {result.batchId && (
            <div className="font-mono mt-1">
              Pickup List: <span className="font-bold">{result.batchId}</span>
            </div>
          )}
        </div>
      )}

      {lastBatchId && (
        <p className="text-xs text-muted-foreground border-t pt-2">
          Τελευταίο κλείσιμο: pickup list{" "}
          <span className="font-mono">{lastBatchId}</span>
          {lastFinalizedAt
            ? ` · ${new Date(lastFinalizedAt).toLocaleString("el-GR")}`
            : ""}
        </p>
      )}
    </div>
  );
}
