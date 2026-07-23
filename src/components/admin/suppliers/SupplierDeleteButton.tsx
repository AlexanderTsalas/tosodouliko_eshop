"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSupplier } from "@/actions/suppliers/deleteSupplier";
import DeleteButton from "@/components/admin/common/DeleteButton";

export default function SupplierDeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm("Διαγραφή προμηθευτή; Αυτό δεν επιτρέπεται αν υπάρχουν ιστορικές παραγγελίες.")) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteSupplier({ id });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.push("/admin/suppliers");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <DeleteButton
        onClick={handleClick}
        label="Διαγραφή"
        disabled={isPending}
      />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
