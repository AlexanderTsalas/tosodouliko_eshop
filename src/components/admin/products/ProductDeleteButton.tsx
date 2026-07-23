"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteProduct } from "@/actions/products/deleteProduct";
import DeleteButton from "@/components/admin/common/DeleteButton";

interface Props {
  id: string;
  /** Used for accessible labels + the confirm prompt. */
  productName?: string;
  /**
   * "full"    — labeled button used on the product detail page; uses
   *             window.confirm and redirects back to the list on success.
   * "compact" — icon-only button used inline in the products list table;
   *             two-step inline confirmation (no modal), refreshes in place.
   */
  variant?: "full" | "compact";
}

/**
 * Product deletion button. Two visual variants share one server action
 * and both delegate appearance to the shared <DeleteButton/> primitive
 * so the icon / styling stays consistent with every other delete
 * affordance in the admin.
 */
export default function ProductDeleteButton({
  id,
  productName,
  variant = "full",
}: Props) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function performDelete(onSuccess: () => void) {
    setError(null);
    startTransition(async () => {
      const r = await deleteProduct({ id });
      if (!r.success) {
        setError(r.error);
        setArmed(false);
        return;
      }
      onSuccess();
    });
  }

  function handleFullClick() {
    if (
      !confirm("Οριστική διαγραφή προϊόντος; Η ενέργεια δεν αναιρείται.")
    )
      return;
    performDelete(() => router.push("/admin/products"));
  }

  if (variant === "compact") {
    if (armed) {
      return (
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => performDelete(() => router.refresh())}
            disabled={isPending}
            className="btn btn-sm border border-destructive bg-destructive/10 text-destructive hover:bg-destructive hover:text-background transition-colors"
            aria-label={`Επιβεβαίωση διαγραφής${
              productName ? ` ${productName}` : ""
            }`}
          >
            {isPending ? "..." : "Σίγουρα;"}
          </button>
          <button
            type="button"
            onClick={() => setArmed(false)}
            disabled={isPending}
            className="text-xs text-muted-foreground hover:text-foreground px-1"
            aria-label="Άκυρο"
          >
            ✕
          </button>
        </div>
      );
    }
    return (
      <DeleteButton
        onClick={() => setArmed(true)}
        ariaLabel={`Διαγραφή${productName ? ` ${productName}` : ""}`}
        title="Διαγραφή προϊόντος"
      />
    );
  }

  // "full" variant — labeled button.
  return (
    <div>
      <DeleteButton
        onClick={handleFullClick}
        label={isPending ? "Διαγραφή..." : "Διαγραφή προϊόντος"}
        disabled={isPending}
        size="md"
      />
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
