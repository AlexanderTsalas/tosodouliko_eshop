"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteOrder } from "@/actions/orders/deleteOrder";
import type { FulfillmentStatus, PaymentStatus, PaymentMethod } from "@/types/order-history";

interface Props {
  orderId: string;
  orderNumber: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
}

/**
 * Hard-deletes an order. The warning lists the specific consequences for this
 * order's current state — reservation release vs. straight-delete vs. refusal
 * — so the admin sees exactly what will happen before they type "DELETE".
 */
export default function DeleteOrderButton({
  orderId,
  orderNumber,
  paymentMethod,
  paymentStatus,
  fulfillmentStatus,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Mirror the server's safety gates so we can disable the button + explain why.
  const stripePaidNotRefunded =
    paymentMethod === "stripe" &&
    paymentStatus === "paid" &&
    fulfillmentStatus !== "cancelled";
  const shipmentLike: FulfillmentStatus[] = [
    "shipped",
    "ready_for_pickup",
    "delivered",
    "picked_up",
  ];
  const shippedNotClosed =
    shipmentLike.includes(fulfillmentStatus) && paymentStatus !== "refunded";

  const refusedReason = stripePaidNotRefunded
    ? "Πρέπει πρώτα να γίνει επιστροφή χρημάτων (refund)."
    : shippedNotClosed
      ? `Δεν διαγράφεται όσο είναι σε κατάσταση "${fulfillmentStatus}". Ακυρώστε ή κάντε refund πρώτα.`
      : null;

  // Predict the inventory effect the server will apply so we can warn about it.
  const willReleaseReservation =
    paymentMethod !== "stripe" &&
    !["draft", "cancelled"].includes(fulfillmentStatus);
  const willRestoreInventory =
    paymentMethod === "stripe" &&
    paymentStatus === "paid" &&
    !shipmentLike.includes(fulfillmentStatus) &&
    fulfillmentStatus !== "cancelled";

  function handleDelete() {
    if (refusedReason) return;

    const lines: string[] = [
      `Πρόκειται να διαγραφεί ΟΡΙΣΤΙΚΑ η παραγγελία ${orderNumber}.`,
      "",
      "Συνέπειες:",
      "  • Η παραγγελία και όλες οι γραμμές της θα διαγραφούν από τη βάση.",
      "  • Δεν θα εμφανίζεται πλέον σε λίστες, αναφορές ή ιστορικό πελάτη.",
      "  • Η ενέργεια καταγράφεται στο audit log αλλά δεν αναιρείται.",
    ];
    if (willReleaseReservation) {
      lines.push("  • Τα δεσμευμένα τεμάχια θα επιστραφούν στο διαθέσιμο στοκ.");
    }
    if (willRestoreInventory) {
      lines.push("  • Τα μειωμένα τεμάχια θα επιστραφούν στο διαθέσιμο στοκ.");
    }
    lines.push("", "Είστε σίγουρος; (πατήστε OK για επιβεβαίωση)");

    if (!confirm(lines.join("\n"))) return;

    setError(null);
    startTransition(async () => {
      const r = await deleteOrder({ orderId });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.replace("/admin/orders");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending || refusedReason !== null}
        title={refusedReason ?? "Οριστική διαγραφή της παραγγελίας"}
        className="rounded border border-destructive text-destructive px-3 py-1 text-sm disabled:opacity-40"
      >
        {isPending ? "Διαγραφή..." : "Διαγραφή παραγγελίας"}
      </button>
      {refusedReason && (
        <p className="text-xs text-muted-foreground">{refusedReason}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
