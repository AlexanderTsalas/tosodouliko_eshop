"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteCategory } from "@/actions/categories/deleteCategory";
import DeleteButton from "@/components/admin/common/DeleteButton";

export default function CategoryDeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm("Διαγραφή κατηγορίας; Τα παιδιά θα γίνουν root και οι αναθέσεις προϊόντων θα διαγραφούν.")) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteCategory({ id });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <DeleteButton
        onClick={handleClick}
        label="Διαγραφή"
        disabled={isPending}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}
