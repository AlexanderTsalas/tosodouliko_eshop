"use client";

import { useState, useTransition } from "react";
import { subscribeToRestock } from "@/actions/wishlist/subscribeToRestock";
import { redirectToSignupIfNotPermanent } from "@/lib/auth/requirePermanentAccount";
import MaskIcon from "@/components/layout/MaskIcon";

interface Props {
  productId: string;
  variantId?: string;
  productName: string;
}

/**
 * Replaces "Add to Cart" on the product page when the selected variant has
 * effective_available === 0 (either fully contested by an active soft/hard
 * reservation, or genuinely sold out).
 *
 * Click → subscribes the variant to notify_on_restock=true in the customer's
 * wishlist. The Phase 6 notification dispatcher sends an email when the
 * inventory becomes available again.
 *
 * Anonymous / unauthenticated visitors are redirected to /auth/signup with
 * a `next` param pointing back here. The wishlist is account-only per spec
 * §8.3 — durable interest requires verified identity.
 */
export default function NotifyMeButton({
  productId,
  variantId,
  productName,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const ok = await redirectToSignupIfNotPermanent();
      if (!ok) return; // navigating to signup; nothing more to do here
      const r = await subscribeToRestock({
        productId,
        variantId,
        source: "sold_out_page",
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setSubscribed(true);
    });
  }

  if (subscribed) {
    return (
      <span className="text-sm text-emerald-700 text-center max-w-[10rem]">
        ✓ Θα ειδοποιηθείτε όταν είναι ξανά διαθέσιμο.
      </span>
    );
  }

  // Large circular dark action button — the hedgehog notify icon painted in
  // the canvas (background) colour, wiggling on hover with the label revealed
  // below. Matches the wishlist "icon" variant beside it.
  return (
    <div className="group icon-wiggle-group relative flex flex-col items-center">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        aria-label={`Ειδοποιήστε με όταν το «${productName}» είναι ξανά διαθέσιμο`}
        className="flex items-center justify-center w-14 h-14 rounded-full bg-[#6b4f37] text-canvas hover:bg-terracotta transition-colors disabled:opacity-50"
      >
        <MaskIcon src="/icons_svgs/Notify_Me.svg" className="icon-wiggle w-10 h-10" />
      </button>
      <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-medium text-ink opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {isPending ? "Εγγραφή..." : "Ειδοποιήστε Με!"}
      </span>
      {error && (
        <span
          className="absolute top-full mt-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-destructive"
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  );
}
