"use client";

import { useState, useTransition } from "react";
import { Info } from "lucide-react";
import { setProductImageAxes } from "@/actions/product-images/setProductImageAxes";

/**
 * Multi-checkbox of available variant attributes; selecting one marks
 * that attribute as image-affecting (`products.image_axes`).
 *
 * When existing images are present, surfaces an informational notice
 * — the change is non-destructive (existing images keep their
 * attribute_combo), but admins should be aware that current images
 * may not display as expected if the new axis set was intended to
 * re-group them.
 */
export default function ProductImageAxesSelector({
  mode,
  productId,
  initialAxes,
  availableAxes,
  imageCount,
  onChange,
}: {
  /** Edit mode persists the choice via setProductImageAxes server
   * action. Create mode skips the server call — the parent
   * (ProductForm) keeps the axes in local state and submits them
   * with createProduct in a single atomic step. */
  mode: "create" | "edit";
  /** Required in edit mode; ignored in create mode. */
  productId: string | null;
  initialAxes: string[];
  availableAxes: Array<{ slug: string; name: string }>;
  imageCount: number;
  onChange: (next: string[]) => void;
}) {
  const [axes, setAxes] = useState<string[]>(initialAxes);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const showNotice = imageCount > 0;
  const isCreate = mode === "create";

  function toggle(slug: string) {
    const next = axes.includes(slug)
      ? axes.filter((s) => s !== slug)
      : [...axes, slug];

    setAxes(next);
    onChange(next);
    setError(null);

    // Create mode skips the server call — createProduct on submit
    // takes the final axes value and writes it to products.image_axes.
    if (isCreate) return;

    startTransition(async () => {
      const r = await setProductImageAxes({
        productId: productId!,
        imageAxes: next,
      });
      if (!r.success) {
        // Revert local state on failure
        setAxes(axes);
        onChange(axes);
        setError(r.error);
      }
    });
  }

  return (
    <section className="flex flex-col">
      <header className="px-4 py-3 border-b border-foreground/10 bg-muted/30">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Άξονες εικόνας
        </h3>
        <p className="text-xs text-muted-foreground/80 mt-0.5">
          Ποιοι άξονες παραλλαγών αλλάζουν την εικόνα στο storefront
        </p>
      </header>

      <div className="p-3 space-y-2">
        {availableAxes.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-1">
            Αυτό το προϊόν δεν έχει άξονες παραλλαγής ακόμα. Προσθέστε
            παραλλαγές στην καρτέλα «Παραλλαγές» πρώτα.
          </p>
        ) : (
          // Vertical stack — one axis per row, fills the column width.
          // Prevents horizontal wrap from looking awkward when a product
          // has many attributes (e.g., shoes with size + color + width).
          <div className="flex flex-col gap-1.5">
            {availableAxes.map((axis) => {
              const checked = axes.includes(axis.slug);
              return (
                <label
                  key={axis.slug}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-md border cursor-pointer transition-all text-sm ${
                    checked
                      ? "border-foreground bg-foreground/5 font-medium shadow-sm"
                      : "border-foreground/15 hover:border-foreground/30 hover:bg-muted/30"
                  } ${pending ? "opacity-60 pointer-events-none" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(axis.slug)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${
                      checked
                        ? "bg-foreground border-foreground"
                        : "border-foreground/30"
                    }`}
                  >
                    {checked && (
                      <svg
                        viewBox="0 0 16 16"
                        className="w-2.5 h-2.5 text-background"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M3 8L7 12L13 4" />
                      </svg>
                    )}
                  </span>
                  <span className="flex-1 truncate">{axis.name}</span>
                </label>
              );
            })}
          </div>
        )}

        {showNotice && (
          <div className="flex items-start gap-2 rounded-md border border-foreground/15 bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground mt-2">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <p className="leading-snug">
              Έχετε {imageCount} εικόν{imageCount === 1 ? "α" : "ες"} ήδη
              ταξινομημέν{imageCount === 1 ? "η" : "ες"}. Οι αλλαγές δεν
              διαγράφουν τις υπάρχουσες ταξινομήσεις.
            </p>
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive bg-destructive/5 border border-destructive/30 rounded px-2 py-1.5 mt-2">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
