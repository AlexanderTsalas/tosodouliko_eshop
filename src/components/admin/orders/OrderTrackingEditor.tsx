"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveOrderTracking } from "@/actions/orders/saveOrderTracking";
import { buildTrackingUrl } from "@/lib/courier/buildTrackingUrl";

interface Props {
  orderId: string;
  carrierDisplayName: string | null;
  carrierTemplate: string | null;
  initialTrackingNumber: string | null;
  initialTrackingUrlOverride: string | null;
  /** Optimistic-lock snapshot from page render (orders.updated_at). */
  orderUpdatedAt?: string;
}

/**
 * Editor for the per-order tracking fields. Shows two inputs plus a live
 * preview of the resulting customer-facing tracking URL (so the admin can
 * verify the link works before saving).
 *
 * Used on the admin order detail page. For API-integrated carriers,
 * createVoucher writes tracking_number automatically — admins rarely need
 * to touch this form unless correcting a misfire. For non-integrated and
 * custom carriers, this is the only path to give the customer a working
 * tracking link.
 */
export default function OrderTrackingEditor({
  orderId,
  carrierDisplayName,
  carrierTemplate,
  initialTrackingNumber,
  initialTrackingUrlOverride,
  orderUpdatedAt,
}: Props) {
  const router = useRouter();
  const [trackingNumber, setTrackingNumber] = useState(
    initialTrackingNumber ?? ""
  );
  const [trackingUrlOverride, setTrackingUrlOverride] = useState(
    initialTrackingUrlOverride ?? ""
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Live preview — uses the same helper the customer page renders with.
  const previewUrl = buildTrackingUrl(
    {
      tracking_number: trackingNumber || null,
      tracking_url_override: trackingUrlOverride || null,
    },
    { tracking_url_template: carrierTemplate }
  );

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveOrderTracking({
        order_id: orderId,
        tracking_number: trackingNumber,
        tracking_url_override: trackingUrlOverride,
        expected_updated_at: orderUpdatedAt,
      });
      if (!res.success) {
        setError(res.error);
        if (res.code === "CONCURRENT_EDIT") {
          // Reload to surface the latest state; the form sees the
          // fresh updated_at on next submit attempt.
          router.refresh();
        }
        return;
      }
      router.refresh();
    });
  }

  const hasCarrierTemplate = !!carrierTemplate;
  const hasChanges =
    (trackingNumber || "") !== (initialTrackingNumber ?? "") ||
    (trackingUrlOverride || "") !== (initialTrackingUrlOverride ?? "");

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Voucher / tracking number
        </label>
        <input
          type="text"
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
          placeholder="π.χ. ACS123456789"
          className="border rounded px-2 py-1 w-full text-sm font-mono"
        />
        {carrierDisplayName && !hasCarrierTemplate && (
          <p className="text-xs text-amber-700 mt-1">
            Η μεταφορική «{carrierDisplayName}» δεν έχει tracking URL template —
            ο πελάτης δεν θα δει κουμπί παρακολούθησης παρά μόνο αν συμπληρώσετε
            override URL παρακάτω.
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Tracking URL override (προαιρετικό)
        </label>
        <input
          type="url"
          value={trackingUrlOverride}
          onChange={(e) => setTrackingUrlOverride(e.target.value)}
          placeholder="https://..."
          className="border rounded px-2 py-1 w-full text-sm"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Συμπληρώστε ΜΟΝΟ όταν χρειάζεται διαφορετικό URL από το πρότυπο της
          μεταφορικής (π.χ. δικό σας portal παρακολούθησης).
        </p>
      </div>

      <div className="border-t pt-3">
        <p className="text-xs text-muted-foreground mb-1">
          Προεπισκόπηση κουμπιού «Παρακολούθηση»
        </p>
        {previewUrl ? (
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline text-primary break-all"
          >
            {previewUrl}
          </a>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Δεν θα εμφανιστεί κουμπί παρακολούθησης (λείπει tracking number ή
            template).
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={isPending || !hasChanges}
        className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-40"
      >
        {isPending ? "Αποθήκευση..." : "Αποθήκευση"}
      </button>
    </div>
  );
}
