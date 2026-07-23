"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteRole } from "@/actions/rbac/deleteRole";
import DeleteButton from "@/components/admin/common/DeleteButton";

export default function RoleDeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm(`Διαγραφή ρόλου '${name}'; Όλες οι αναθέσεις σε χρήστες θα χαθούν.`)) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteRole({ id });
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
        ariaLabel={`Διαγραφή ρόλου ${name}`}
        title={`Διαγραφή ρόλου ${name}`}
        disabled={isPending}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}
