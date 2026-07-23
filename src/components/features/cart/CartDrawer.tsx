"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/hooks/useCart";
import { useCartRealtime } from "@/hooks/useCartRealtime";
import { useEnsureSession } from "@/hooks/useEnsureSession";
import { startCheckoutSession } from "@/actions/checkout/startCheckoutSession";
import { pingSoftWaitPresence } from "@/actions/cart/pingSoftWaitPresence";
import ContentionModal, {
  type ContestedItem,
} from "@/components/features/contention/ContentionModal";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import MaskIcon from "@/components/layout/MaskIcon";
import type { CartWithItems } from "@/types/shopping-cart";

interface Props {
  initialCart: CartWithItems | null;
  /** The currency to display all prices in. Server pre-converts unit_price + subtotal. */
  displayCurrency?: string;
}

export default function CartDrawer({ initialCart, displayCurrency = "EUR" }: Props) {
  const cart = useCart(initialCart);
  const router = useRouter();
  const [isCheckoutPending, startCheckoutTransition] = useTransition();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [contested, setContested] = useState<ContestedItem[]>([]);
  const [contentionOpen, setContentionOpen] = useState(false);

  function handleRemove(id: string) {
    cart.remove(id);
  }

  // Subscribe to Realtime CDC. On any soft_wait / priority_hold / cart_item
  // change, refetch the cart so waiting badges, promoted-state UI, and item
  // lists stay live. The "items sold" modal is owned globally by
  // CollapseWatcher (root layout), so we no longer need foreign-delete
  // tracking here.
  useCartRealtime({
    cartId: cart.data?.id ?? null,
    onChange: () => cart.refresh(),
  });

  // Presence ping while this customer has any pending soft_wait. The
  // abandonment reaper (reap_abandoned_soft_waits, cron-scheduled) removes
  // wait rows whose last_seen_at is older than 2 minutes, so we ping every
  // 30 seconds to keep the row alive while the cart is open.
  const hasPendingWait = (cart.data?.items ?? []).some(
    (i) => i.wait_state === "pending"
  );
  useEffect(() => {
    if (!hasPendingWait) return;
    void pingSoftWaitPresence({});
    const id = window.setInterval(() => {
      void pingSoftWaitPresence({});
    }, 30_000);
    return () => window.clearInterval(id);
  }, [hasPendingWait]);

  const ensureSession = useEnsureSession();

  function proceedToCheckout() {
    setCheckoutError(null);
    startCheckoutTransition(async () => {
      // Phase 9: guests reach here without an auth session if they added
      // to cart from the server-rendered cart page directly. Ensure an
      // anonymous session before startCheckoutSession. The in-checkout
      // CheckoutAuthBanner (rendered on /checkout for anon users) offers
      // the guest / signin / signup choice AFTER the soft hold is in
      // place — that's the right surface for the timer extension.
      const userId = await ensureSession();
      if (!userId) {
        setCheckoutError("Δεν ήταν δυνατή η σύνδεση. Ανανεώστε τη σελίδα.");
        return;
      }
      const r = await startCheckoutSession();
      if (!r.success) {
        setCheckoutError(r.error);
        return;
      }
      if (r.data.kind === "contention") {
        setContested(r.data.contested);
        setContentionOpen(true);
        return;
      }
      router.push(`/checkout?session=${r.data.session_id}`);
    });
  }

  if (cart.isLoading) {
    return (
      <div aria-hidden="true" className="space-y-2">
        <div className="h-12 bg-warm-sand/60 rounded-sm animate-pulse" />
        <div className="h-12 bg-warm-sand/60 rounded-sm animate-pulse" />
      </div>
    );
  }

  if (!cart.data || cart.data.items.length === 0) {
    return (
      <div>
        <div className="flex justify-center mb-6 text-[#6b4f37]">
          <MaskIcon src="/icons_svgs/cart_empty_hedgehog.svg" className="w-64 h-64" />
        </div>
        <div className="border border-dashed border-stone-taupe/40 bg-warm-sand/20 rounded-sm py-10 text-center">
          <p className="text-stone-taupe">Το καλάθι σας είναι άδειο.</p>
          <Link href="/products" className="mt-4 inline-block text-terracotta hover:underline font-medium">
            Συνέχεια αγορών
          </Link>
        </div>
      </div>
    );
  }

  const hasPending = cart.data.items.some((i) => i.wait_state === "pending");

  return (
    <div>
      <div className="flex justify-center mb-6 text-[#6b4f37]">
        <MaskIcon src="/icons_svgs/cart_full.svg" className="w-64 h-64" />
      </div>
      <ul className="divide-y divide-stone-taupe/15">
        {cart.data.items.map((item) => (
          <li key={item.id} className="py-3 flex items-center justify-between gap-3">
            <div className="flex-1">
              <Link
                href={`/products/${item.product_slug}`}
                className="font-serif font-bold text-ink hover:text-terracotta transition-colors"
              >
                {item.product_name}
              </Link>
              <p className="text-sm text-muted-foreground">
                {item.variant_label ?? "—"} · {formatCurrency(item.unit_price, displayCurrency)}
                {item.modifier_total > 0 && (
                  <span className="text-emerald-700">
                    {" "}
                    + {formatCurrency(item.modifier_total, displayCurrency)}
                  </span>
                )}
              </p>
              {item.custom_fields && item.custom_fields.length > 0 && (
                <ul className="mt-1 text-xs text-muted-foreground space-y-0.5">
                  {item.custom_fields.map((cf) => (
                    <li key={cf.field_id} className="flex gap-1.5">
                      <span className="font-medium text-foreground/80">
                        {cf.field_label}:
                      </span>
                      <span className="flex-1 break-words">
                        {cf.display_value}
                      </span>
                      {cf.contributed_price > 0 && (
                        <span className="tabular-nums text-emerald-700">
                          +{formatCurrency(cf.contributed_price, displayCurrency)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {item.wait_state === "pending" && (
                <p className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                  {item.queue_position === 1
                    ? "Είστε επόμενος/η σε σειρά αναμονής"
                    : item.queue_position
                      ? `Είστε #${item.queue_position} σε σειρά αναμονής`
                      : "Σε αναμονή — άλλος πελάτης ολοκληρώνει αυτή τη στιγμή"}
                </p>
              )}
              {item.wait_state === "promoted" && (
                <PromotedBadge expiresAt={item.priority_expires_at} />
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) => cart.update(item.id, Math.max(1, Number(e.target.value)))}
                disabled={item.wait_state === "pending"}
                className="w-16 border border-stone-taupe/30 rounded-sm px-2 py-1 text-right disabled:bg-muted/40 disabled:text-muted-foreground"
                aria-label="Ποσότητα"
              />
              <button
                onClick={() => handleRemove(item.id)}
                className="text-sm text-destructive hover:underline"
              >
                Αφαίρεση
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center justify-between border-t border-stone-taupe/20 pt-4">
        <span className="font-serif text-lg font-bold text-ink">Σύνολο</span>
        <span className="font-mono font-bold text-ink">{formatCurrency(cart.data.subtotal, displayCurrency)}</span>
      </div>
      <button
        type="button"
        onClick={proceedToCheckout}
        disabled={cart.isPending || isCheckoutPending || hasPending}
        title={
          hasPending
            ? "Κάποια είδη βρίσκονται σε αναμονή. Θα μπορέσετε να ολοκληρώσετε μόλις απελευθερωθούν."
            : undefined
        }
        className="mt-4 block w-full text-center rounded-sm bg-primary text-primary-foreground py-2.5 text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isCheckoutPending ? "Επεξεργασία..." : "Ολοκλήρωση παραγγελίας"}
      </button>
      {hasPending && (
        <p className="mt-2 text-xs text-muted-foreground text-center">
          Θα ενημερωθείτε αυτόματα όταν τα είδη σε αναμονή γίνουν διαθέσιμα.
        </p>
      )}
      {checkoutError && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {checkoutError}
        </p>
      )}

      <ContentionModal
        open={contentionOpen}
        onOpenChange={setContentionOpen}
        contested={contested}
        source="contention_modal"
      />
    </div>
  );
}

/**
 * Live MM:SS countdown for a promoted (priority_hold) item. Ticks every
 * second from the customer's clock; the server-side 5-min expiry is the
 * authoritative cutoff so small clock drift is harmless.
 */
function PromotedBadge({ expiresAt }: { expiresAt?: string }) {
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : null;
  const [remainingMs, setRemainingMs] = useState(() =>
    expiresMs ? Math.max(0, expiresMs - Date.now()) : 0
  );

  useEffect(() => {
    if (expiresMs === null) return;
    const id = window.setInterval(() => {
      setRemainingMs(Math.max(0, expiresMs - Date.now()));
    }, 1000);
    return () => window.clearInterval(id);
  }, [expiresMs]);

  if (expiresMs === null) {
    return (
      <p className="mt-1 inline-block rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">
        Διαθέσιμο τώρα — ολοκληρώστε την αγορά
      </p>
    );
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return (
    <p className="mt-1 inline-block rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">
      Διαθέσιμο τώρα — ολοκληρώστε σε{" "}
      <span className="font-mono font-semibold">
        {mm}:{ss.toString().padStart(2, "0")}
      </span>
    </p>
  );
}

