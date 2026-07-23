"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCheckoutCode } from "@/actions/checkout/addCheckoutCode";
import { removeCheckoutCode } from "@/actions/checkout/removeCheckoutCode";

interface Props {
  sessionId: string;
  initialCodes: string[];
}

/**
 * Code entry widget for the checkout sidebar.
 *
 * Chip-builder pattern (decision #12 — multiple codes allowed):
 *   - Input + "Προσθήκη" button on the top
 *   - List of applied codes as chips with a [✕] to remove
 *   - On success, `router.refresh()` re-renders the page so the
 *     server-side totals reflect the new code set (placeOrder
 *     re-evaluates the engine at submit time)
 *
 * The actual discount preview happens server-side; this component just
 * records the customer's intent. The final discount + audit insert
 * lands in `orders.discount_amount` after placeOrder runs.
 */
export default function CheckoutCodes({ sessionId, initialCodes }: Props) {
  const router = useRouter();
  const [codes, setCodes] = useState<string[]>(initialCodes);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    setError(null);
    const code = draft.trim();
    if (!code) return;
    startTransition(async () => {
      const r = await addCheckoutCode({ session_id: sessionId, code });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setCodes(r.data.applied_codes);
      setDraft("");
      router.refresh();
    });
  }

  function handleRemove(code: string) {
    setError(null);
    startTransition(async () => {
      const r = await removeCheckoutCode({ session_id: sessionId, code });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setCodes(r.data.applied_codes);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 pt-3 border-t">
      <p className="text-xs font-medium text-foreground mb-2">
        Κωδικός προσφοράς
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          maxLength={64}
          placeholder="ΚΩΔΙΚΟΣ"
          className="flex-1 text-sm font-mono uppercase border border-stone-taupe/30 rounded-sm px-2 py-1.5 focus:outline-none focus:border-terracotta"
          disabled={isPending}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={isPending || !draft.trim()}
          className="btn btn-secondary btn-sm"
        >
          Προσθήκη
        </button>
      </div>

      {error && (
        <p className="text-xs text-destructive mt-1.5">{error}</p>
      )}

      {codes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {codes.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 text-xs font-mono bg-warm-sand px-2 py-1 rounded-sm"
            >
              {c}
              <button
                type="button"
                onClick={() => handleRemove(c)}
                disabled={isPending}
                aria-label={`Αφαίρεση κωδικού ${c}`}
                className="text-stone-taupe hover:text-terracotta"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-2">
        Η προεπισκόπηση έκπτωσης φαίνεται στη σύνοψη παραπάνω. Η τελική
        έκπτωση επιβεβαιώνεται στην ολοκλήρωση της παραγγελίας.
      </p>
    </div>
  );
}
