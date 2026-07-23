"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refundOrder } from "@/actions/orders/refundOrder";

interface Props {
  orderId: string;
  /** Hide when payment isn't in a refundable state. */
  paymentStatus: string;
  /** Optimistic-lock snapshot from page render (orders.updated_at).
   *  Refusing the refund when the row has moved prevents a stale
   *  click from triggering a Stripe refund against a state that
   *  e.g. already changed to 'refunded' or 'cancelled' by another
   *  admin / webhook. */
  orderUpdatedAt?: string;
}

/**
 * Compact refund control — sits inside the payment status card. Refund is
 * the only action the OrderStatusSelect dropdown doesn't cover because it
 * needs reason capture; keeping it as a button preserves that flow.
 *
 * Still uses window.confirm + window.prompt for reason capture. Replacing
 * with a proper modal + structured reason taxonomy is in the redesign
 * proposal queue (proposal #6).
 */
export default function OrderRefundButton({
  orderId,
  paymentStatus,
  orderUpdatedAt,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (paymentStatus !== "paid") return null;

  function doRefund() {
    if (!confirm("Επιστροφή χρημάτων;")) return;
    const reason = prompt("Λόγος επιστροφής χρημάτων (προαιρετικό):") ?? undefined;
    setError(null);
    startTransition(async () => {
      const r = await refundOrder({
        orderId,
        reason,
        expected_updated_at: orderUpdatedAt,
      });
      if (!r.success) {
        setError(r.error);
        if (r.code === "CONCURRENT_EDIT") {
          // Reload so the admin sees the current state — the order
          // may already be refunded / cancelled by someone else.
          router.refresh();
        }
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={doRefund}
        disabled={isPending}
        className="text-[10px] text-destructive underline disabled:opacity-50"
      >
        {isPending ? "Επιστροφή..." : "Επιστροφή χρημάτων"}
      </button>
      {error && <p className="text-[10px] text-destructive mt-0.5">{error}</p>}
    </div>
  );
}
