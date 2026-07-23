"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createAssociationFromProduct } from "@/actions/related-products";

interface Props {
  product_id: string;
  product_name: string;
}

/**
 * "+ Νέα συσχέτιση από αυτό το προϊόν" button — fires the
 * createAssociationFromProduct action, then router.push() to the
 * workshop bench with `?expand=<id>` so the bench auto-opens the
 * inline editor for the new association.
 */
export default function CreateAssociationFromProductButton({
  product_id,
  product_name,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const r = await createAssociationFromProduct({ product_id });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.push(
        `/admin/related-products?expand=${r.data.association_id}`
      );
    });
  }

  void product_name; // reserved for future client-side preview / toast

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="btn btn-primary btn-sm flex items-center gap-1.5"
      >
        <Plus className="w-4 h-4" />
        {isPending ? "Δημιουργία…" : "Νέα συσχέτιση από αυτό το προϊόν"}
      </button>
      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-xs px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
