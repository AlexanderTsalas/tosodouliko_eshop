"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCarrierVoucher } from "@/actions/orders/createCarrierVoucher";
import { cancelCarrierVoucher } from "@/actions/orders/cancelCarrierVoucher";
import { refreshOrderTracking } from "@/actions/orders/refreshOrderTracking";

interface Props {
  orderId: string;
  trackingNumber: string | null;
  /** True when the carrier has create_voucher capability ON and credentials configured. */
  canCreate: boolean;
  /** True when the carrier has cancel_voucher capability ON. */
  canCancel: boolean;
  /** True when the carrier has fetch_tracking capability ON. */
  canRefreshTracking: boolean;
  /** Greek display name for messaging. */
  carrierDisplayName: string | null;
}

/**
 * Phase 8 — voucher creation + cancellation buttons for the admin order
 * detail page. Sits inside the "Παρακολούθηση αποστολής" section beside
 * the manual tracking-number editor.
 *
 * Behavior:
 *   - No tracking_number + create capability → "Δημιουργία voucher" button
 *   - Has tracking_number + cancel capability → "Ακύρωση voucher" button
 *   - Capability OFF for the carrier → button disabled with helper text
 *     pointing to the Couriers settings page
 *
 * After a successful create/cancel, calls router.refresh() so the
 * surrounding admin page (status, tracking editor, etc.) picks up the
 * change without a hard reload.
 */
export default function OrderVoucherActions({
  orderId,
  trackingNumber,
  canCreate,
  canCancel,
  canRefreshTracking,
  carrierDisplayName,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  function handleRefreshTracking() {
    setError(null);
    setRefreshNotice(null);
    startTransition(async () => {
      const res = await refreshOrderTracking({ order_id: orderId });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setRefreshNotice(
        `Κατάσταση: ${res.data.status}${
          res.data.carrier_status_label ? ` · ${res.data.carrier_status_label}` : ""
        }`
      );
      router.refresh();
    });
  }

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const res = await createCarrierVoucher({ order_id: orderId });
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function handleCancel() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setError(null);
    startTransition(async () => {
      const res = await cancelCarrierVoucher({ order_id: orderId });
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="border-t pt-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        Voucher μεταφορικής
      </p>

      {!trackingNumber ? (
        <>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate || isPending}
            className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {isPending ? "Δημιουργία..." : "Δημιουργία voucher"}
          </button>
          {!canCreate && (
            <p className="text-xs text-muted-foreground">
              {carrierDisplayName
                ? `Η αυτόματη δημιουργία voucher δεν είναι ενεργή για ${carrierDisplayName}. `
                : "Δεν υπάρχει ενεργή ρύθμιση μεταφορικής. "}
              Ενεργοποιήστε το capability «Δημιουργία voucher» στις ρυθμίσεις της
              μεταφορικής.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm">
            Voucher αριθμός: <span className="font-mono">{trackingNumber}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRefreshTracking}
              disabled={!canRefreshTracking || isPending}
              className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {isPending ? "Ανανέωση..." : "Ανανέωση tracking"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={!canCancel || isPending}
              className={`rounded border px-3 py-1.5 text-sm disabled:opacity-50 ${
                confirming
                  ? "bg-destructive text-destructive-foreground border-destructive"
                  : ""
              }`}
            >
              {isPending
                ? "..."
                : confirming
                  ? "Επιβεβαίωση ακύρωσης"
                  : "Ακύρωση voucher"}
            </button>
            {confirming && (
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="btn btn-secondary btn-sm"
              >
                Άκυρο
              </button>
            )}
          </div>
          {refreshNotice && (
            <p className="text-xs text-emerald-700">{refreshNotice}</p>
          )}
          {!canRefreshTracking && (
            <p className="text-xs text-muted-foreground">
              Το αυτόματο tracking δεν είναι ενεργό για αυτή τη μεταφορική.
            </p>
          )}
          {!canCancel && (
            <p className="text-xs text-muted-foreground">
              {carrierDisplayName
                ? `Η ακύρωση voucher μέσω API δεν είναι ενεργή για ${carrierDisplayName}.`
                : "Η ακύρωση voucher μέσω API δεν είναι ενεργή για αυτή τη μεταφορική."}
            </p>
          )}
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
