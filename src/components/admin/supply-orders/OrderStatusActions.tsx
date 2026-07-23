"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { placeOrder } from "@/actions/supply-orders/placeOrder";
import { cancelOrder } from "@/actions/supply-orders/cancelOrder";
import { manualStatusChange } from "@/actions/supply-orders/manualStatusChange";
import type { SupplyOrderStatus } from "@/types/suppliers";

interface Props {
  orderId: string;
  status: SupplyOrderStatus;
  /** Show a "Receive" button that links to the receipt workflow (built in H1.8). */
  onReceive?: () => void;
}

/**
 * Renders the workflow-appropriate buttons for a given order status, plus a
 * collapsible "Manual status change" escape hatch.
 */
export default function OrderStatusActions({ orderId, status, onReceive }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showManual, setShowManual] = useState(false);

  function withConfirm(message: string, action: () => Promise<{ success: boolean; error?: string }>) {
    if (!confirm(message)) return;
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (!r.success) {
        setError(r.error ?? "Σφάλμα");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && (
        <>
          <button
            type="button"
            onClick={() =>
              withConfirm("Καταχώρηση της παραγγελίας ως «Placed»;", () =>
                placeOrder({ id: orderId })
              )
            }
            disabled={isPending}
            className="btn btn-primary btn-sm"
          >
            Καταχώρηση
          </button>
          <button
            type="button"
            onClick={() =>
              withConfirm("Ακύρωση draft;", () => cancelOrder({ id: orderId }))
            }
            disabled={isPending}
            className="btn btn-destructive btn-sm"
          >
            Ακύρωση draft
          </button>
        </>
      )}

      {status === "placed" && (
        <>
          {onReceive && (
            <button
              type="button"
              onClick={onReceive}
              disabled={isPending}
              className="btn btn-primary btn-sm"
            >
              Παραλαβή
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              withConfirm("Ακύρωση παραγγελίας;", () => cancelOrder({ id: orderId }))
            }
            disabled={isPending}
            className="btn btn-destructive btn-sm"
          >
            Ακύρωση
          </button>
        </>
      )}

      {(status === "received" || status === "cancelled") && (
        <span className="text-xs text-muted-foreground italic">
          {status === "received"
            ? "Η παραγγελία έχει παραληφθεί."
            : "Η παραγγελία έχει ακυρωθεί."}
        </span>
      )}

      <button
        type="button"
        onClick={() => setShowManual((v) => !v)}
        className="text-xs text-muted-foreground hover:text-foreground underline ml-auto"
      >
        {showManual ? "Κλείσιμο" : "Χειροκίνητη αλλαγή"}
      </button>

      {showManual && (
        <div className="basis-full mt-2 rounded-md border border-foreground/15 bg-muted/30 px-3 py-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Αλλαγή κατάστασης σε:</span>
          {(["draft", "placed", "received", "cancelled"] as SupplyOrderStatus[])
            .filter((s) => s !== status)
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={() =>
                  withConfirm(
                    `Επιβεβαίωση χειροκίνητης αλλαγής σε «${s}»; (Δεν εκτελεί κανένα side-effect.)`,
                    () => manualStatusChange({ id: orderId, status: s })
                  )
                }
                disabled={isPending}
                className="btn btn-secondary btn-sm"
              >
                {s}
              </button>
            ))}
        </div>
      )}

      {error && (
        <p role="alert" className="basis-full text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
