"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transitionOrderStatus } from "@/actions/orders/transitionOrderStatus";
import { refundOrder } from "@/actions/orders/refundOrder";
import type {
  FulfillmentStatus,
  PaymentStatus,
  PaymentMethod,
} from "@/types/order-history";

// Legacy "Status Actions" panel — superseded by OrderStatusSelect,
// which uses the carrier timeline. Kept here only for the legacy
// fulfillment spine; new-vocabulary codes resolve to an empty list
// (no buttons surfaced — admin uses the dropdown). Partial type
// reflects "not all enum values handled here on purpose".
const NEXT_FULFILLMENT: Partial<Record<FulfillmentStatus, FulfillmentStatus[]>> =
  {
    draft: ["pending", "confirmed", "cancelled"],
    pending: ["confirmed", "cancelled"],
    confirmed: ["preparing", "cancelled"],
    preparing: ["shipped", "ready_for_pickup", "cancelled"],
    shipped: ["delivered", "cancelled"],
    ready_for_pickup: ["picked_up", "cancelled"],
    delivered: [],
    picked_up: [],
    cancelled: [],
  };

const NEXT_PAYMENT: Record<PaymentStatus, PaymentStatus[]> = {
  pending:  ["paid", "failed"],
  paid:     ["refunded"],
  refunded: [],
  failed:   [],
};

interface Props {
  orderId: string;
  fulfillmentStatus: FulfillmentStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
}

export default function OrderStatusActions({
  orderId,
  fulfillmentStatus,
  paymentStatus,
  paymentMethod,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const fulfillmentNext = NEXT_FULFILLMENT[fulfillmentStatus] ?? [];
  // Stripe-paid orders take their payment_status from the webhook; admins only
  // toggle payment manually for COD / cash / bank_transfer / store_pickup.
  const paymentNext =
    paymentMethod === "stripe" ? [] : NEXT_PAYMENT[paymentStatus].filter((s) => s !== "refunded");

  function goFulfillment(to: FulfillmentStatus) {
    if (!confirm(`Μετάβαση ροής σε: ${to};`)) return;
    setError(null);
    startTransition(async () => {
      const r = await transitionOrderStatus({ orderId, fulfillment_status: to });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function goPayment(to: PaymentStatus) {
    if (!confirm(`Μετάβαση πληρωμής σε: ${to};`)) return;
    setError(null);
    startTransition(async () => {
      const r = await transitionOrderStatus({ orderId, payment_status: to });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function doRefund() {
    if (!confirm("Επιστροφή χρημάτων;")) return;
    const reason = prompt("Λόγος επιστροφής χρημάτων (προαιρετικό):") ?? undefined;
    setError(null);
    startTransition(async () => {
      const r = await refundOrder({ orderId, reason });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  const canRefund = paymentStatus === "paid";
  const nothingAvailable = fulfillmentNext.length === 0 && paymentNext.length === 0 && !canRefund;

  if (nothingAvailable) {
    return (
      <p className="text-sm text-muted-foreground">
        Δεν επιτρέπονται περαιτέρω μεταβάσεις.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {fulfillmentNext.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Ροή παραγγελίας</p>
          <div className="flex flex-wrap items-center gap-2">
            {fulfillmentNext.map((s) => (
              <button
                key={s}
                onClick={() => goFulfillment(s)}
                disabled={isPending}
                className="rounded border px-3 py-1 text-sm disabled:opacity-50"
              >
                → {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {paymentNext.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Πληρωμή</p>
          <div className="flex flex-wrap items-center gap-2">
            {paymentNext.map((s) => (
              <button
                key={s}
                onClick={() => goPayment(s)}
                disabled={isPending}
                className="rounded border px-3 py-1 text-sm disabled:opacity-50"
              >
                → {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {canRefund && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Επιστροφή χρημάτων</p>
          <button
            onClick={doRefund}
            disabled={isPending}
            className="rounded border border-destructive text-destructive px-3 py-1 text-sm disabled:opacity-50"
          >
            Refund
          </button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
