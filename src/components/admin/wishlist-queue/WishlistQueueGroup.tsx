"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  notifyPending,
  skipPending,
  bulkNotify,
  releaseToGeneral,
} from "@/actions/wishlist-queue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PendingRow {
  id: string;
  wishlist_item_id: string;
  variant_id: string;
  customer_id: string;
  quantity_to_offer: number;
  triggered_by: string;
  triggered_at: string;
}

export interface EnrichedPendingRow extends PendingRow {
  queue_position: number;
  customer_email: string | null;
  customer_name: string | null;
}

export interface VariantInfo {
  variant_id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  variant_label: string | null;
  available_now: number;
}

interface Props {
  variantInfo: VariantInfo;
  rows: EnrichedPendingRow[];
}

const TRIGGER_LABEL: Record<string, string> = {
  stripe_abandon: "Stripe abandon",
  cod_cancel: "COD ακύρωση",
  supply_receipt: "Νέο απόθεμα",
  admin_topup: "Χειροκίνητη προσθήκη",
  priority_hold_expired: "Λήξη προτεραιότητας",
};

/**
 * Renders one variant's pending queue with per-row actions and group-level
 * bulk actions.
 */
export default function WishlistQueueGroup({ variantInfo, rows }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [customMessage, setCustomMessage] = useState<{
    pendingId: string;
    text: string;
  } | null>(null);

  function handleNotify(pendingId: string) {
    setError(null);
    startTransition(async () => {
      const r = await notifyPending({ pending_id: pendingId });
      if (!r.success) setError(r.error);
    });
  }

  function handleSkip(pendingId: string) {
    setError(null);
    startTransition(async () => {
      const r = await skipPending({ pending_id: pendingId });
      if (!r.success) setError(r.error);
    });
  }

  function handleCustomSubmit() {
    if (!customMessage) return;
    const { pendingId, text } = customMessage;
    setError(null);
    setCustomMessage(null);
    startTransition(async () => {
      const r = await notifyPending({
        pending_id: pendingId,
        admin_message: text,
      });
      if (!r.success) setError(r.error);
    });
  }

  function handleBulk() {
    setError(null);
    startTransition(async () => {
      const r = await bulkNotify({ variant_id: variantInfo.variant_id });
      if (!r.success) setError(r.error);
    });
  }

  function handleRelease() {
    setError(null);
    if (
      !window.confirm(
        "Απόρριψη όλων των εκκρεμών ειδοποιήσεων χωρίς να σταλούν emails;"
      )
    ) {
      return;
    }
    startTransition(async () => {
      const r = await releaseToGeneral({ variant_id: variantInfo.variant_id });
      if (!r.success) setError(r.error);
    });
  }

  const enoughSupply = variantInfo.available_now >= rows.length;

  return (
    <section className="rounded border">
      <header className="flex items-start justify-between gap-4 p-4 border-b bg-muted/10">
        <div>
          <Link
            href={`/products/${variantInfo.product_slug}`}
            className="font-medium hover:underline"
          >
            {variantInfo.product_name}
          </Link>
          {variantInfo.variant_label && (
            <p className="text-sm text-muted-foreground">
              {variantInfo.variant_label}
            </p>
          )}
          <p className="text-sm mt-1">
            {rows.length} εκκρεμή · {variantInfo.available_now} διαθέσιμα τώρα
            {!enoughSupply && (
              <span className="ml-2 text-amber-700">
                (ανεπαρκές απόθεμα για όλους — FIFO θα γίνει cap)
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-col gap-2 min-w-[180px]">
          <button
            type="button"
            onClick={handleBulk}
            disabled={isPending || variantInfo.available_now === 0}
            className="rounded bg-primary px-3 py-1 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Ειδοποίηση όλων (FIFO)
          </button>
          <button
            type="button"
            onClick={handleRelease}
            disabled={isPending}
            className="rounded border border-destructive px-3 py-1 text-sm text-destructive disabled:opacity-50"
          >
            Απόρριψη όλων
          </button>
        </div>
      </header>

      {error && (
        <p className="px-4 py-2 text-sm text-destructive border-b" role="alert">
          {error}
        </p>
      )}

      <ul className="divide-y">
        {rows.map((row) => (
          <li
            key={row.id}
            className="p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm">
                <span className="font-mono text-xs text-muted-foreground mr-2">
                  #{row.queue_position}
                </span>
                <span className="font-medium">
                  {row.customer_name ?? row.customer_email ?? "(χωρίς όνομα)"}
                </span>
              </p>
              {row.customer_email && row.customer_name && (
                <p className="text-xs text-muted-foreground">
                  {row.customer_email}
                </p>
              )}
              {!row.customer_email && (
                <p className="text-xs text-destructive">
                  Χωρίς email — δεν θα φτάσει η ειδοποίηση
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Ζητούνται {row.quantity_to_offer} ·{" "}
                {TRIGGER_LABEL[row.triggered_by] ?? row.triggered_by} ·{" "}
                {new Date(row.triggered_at).toLocaleString("el-GR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleNotify(row.id)}
                disabled={isPending}
                className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                Ειδοποίηση
              </button>
              <button
                type="button"
                onClick={() =>
                  setCustomMessage({ pendingId: row.id, text: "" })
                }
                disabled={isPending}
                className="rounded border px-3 py-1 text-xs disabled:opacity-50"
              >
                Custom message
              </button>
              <button
                type="button"
                onClick={() => handleSkip(row.id)}
                disabled={isPending}
                className="rounded border px-3 py-1 text-xs disabled:opacity-50"
              >
                Skip
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog
        open={customMessage !== null}
        onOpenChange={(v) => !v && setCustomMessage(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Custom μήνυμα ειδοποίησης</DialogTitle>
            <DialogDescription>
              Το μήνυμα αντικαθιστά το σώμα του template. Το subject + το
              κουμπί παραγγελίας παραμένουν.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={customMessage?.text ?? ""}
            onChange={(e) =>
              setCustomMessage(
                customMessage ? { ...customMessage, text: e.target.value } : null
              )
            }
            rows={6}
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Γεια σας Μαρία — το φόρεμα που σας άρεσε επέστρεψε στο νούμερό σας..."
          />
          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={() => setCustomMessage(null)}
              className="btn btn-secondary btn-md"
            >
              Άκυρο
            </button>
            <button
              type="button"
              onClick={handleCustomSubmit}
              disabled={!customMessage?.text.trim() || isPending}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Αποστολή
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
