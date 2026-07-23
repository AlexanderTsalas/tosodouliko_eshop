"use client";

import { useSyncExternalStore, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { addToCart } from "@/actions/cart/addToCart";
import { addToCartWithContentionCheck } from "@/actions/cart/addToCartWithContentionCheck";
import { useEnsureSession } from "@/hooks/useEnsureSession";
import ContentionModal, {
  type ContestedItem,
} from "@/components/features/contention/ContentionModal";
import {
  subscribeStore,
  getStoreSnapshot,
  getSubmittableValues,
  focusFirstOffender,
} from "@/components/features/custom-fields/_formStore";

export default function AddToCartButton({
  productId,
  variantId,
  quantity = 1,
  fullWidth = false,
  buttonClassName = "",
}: {
  productId: string;
  variantId?: string;
  quantity?: number;
  /** When true the button stretches to fill its container (PDP CTA). */
  fullWidth?: boolean;
  /** Extra classes appended to the button (e.g. to square a merged edge). */
  buttonClassName?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [contested, setContested] = useState<ContestedItem[]>([]);
  const [contentionOpen, setContentionOpen] = useState(false);
  const ensureSession = useEnsureSession();
  const router = useRouter();

  // Subscribe to the custom-fields form store so the button reflects
  // validity in real-time. When no form is on the page (no custom
  // fields apply to this product), the snapshot stays empty and the
  // gating below is a no-op.
  const formSnapshot = useSyncExternalStore(
    subscribeStore,
    getStoreSnapshot,
    getStoreSnapshot
  );
  const hasFormFields = formSnapshot.applicable.length > 0;
  const isFormInvalid =
    formSnapshot.missingRequiredFieldIds.size > 0 ||
    formSnapshot.invalidFieldIds.size > 0;
  const disabled = isPending || (hasFormFields && isFormInvalid);

  function handleClick() {
    setError(null);

    // Gate on form validity. On an invalid click attempt, scroll-to
    // the first offending field so the customer can fix it.
    if (hasFormFields && isFormInvalid) {
      focusFirstOffender();
      if (formSnapshot.missingRequiredFieldIds.size > 0) {
        setError("Συμπληρώστε όλα τα υποχρεωτικά πεδία.");
      } else {
        setError("Διορθώστε τις τιμές που σημειώνονται με σφάλμα.");
      }
      return;
    }

    startTransition(async () => {
      // Phase 9: guests don't have an auth.uid() until we lazily create
      // an anonymous session. addToCart and contention actions all require
      // auth, so bootstrap here before any of them run.
      const userId = await ensureSession();
      if (!userId) {
        setError("Δεν ήταν δυνατή η σύνδεση. Ανανεώστε τη σελίδα και δοκιμάστε ξανά.");
        return;
      }
      // Variant-less adds (no-variant products) skip the contention check —
      // those are simple products without inventory tracking via variant_id.
      const qty = Math.max(1, Math.floor(quantity));
      const customFieldValues = hasFormFields ? getSubmittableValues() : [];

      if (!variantId) {
        const r = await addToCart({
          productId,
          quantity: qty,
          customFieldValues,
        });
        if (!r.success) setError(r.error);
        else router.refresh(); // refresh the header cart count badge
        return;
      }
      const r = await addToCartWithContentionCheck({
        productId,
        variantId,
        quantity: qty,
        customFieldValues,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      if (r.data.kind === "contention") {
        setContested(r.data.contested);
        setContentionOpen(true);
        return;
      }
      // Success — refresh so the header cart count badge updates live.
      router.refresh();
      // Success — `revalidatePath("/cart")` inside addToCart already refreshes
      // cart state via Next.js. The cart drawer re-renders.
    });
  }

  return (
    <div className={fullWidth ? "w-full" : undefined}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`inline-flex items-center justify-center rounded-sm bg-primary text-primary-foreground h-11 px-5 text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-50 ${
          fullWidth ? "w-full" : ""
        } ${buttonClassName}`}
      >
        {isPending ? "Προσθήκη..." : "Προσθήκη στο καλάθι"}
      </button>
      {error && <p className="text-sm text-destructive mt-1" role="alert">{error}</p>}

      <ContentionModal
        open={contentionOpen}
        onOpenChange={setContentionOpen}
        contested={contested}
        source="contention_modal"
      />
    </div>
  );
}
