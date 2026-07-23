"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteUser } from "@/actions/users/deleteUser";
import DeleteButton from "@/components/admin/common/DeleteButton";

export default function DeleteUserButton({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (
      !confirm(
        `Διαγραφή χρήστη ${email}; Όλα τα συνδεδεμένα στοιχεία (διευθύνσεις, καλάθι, λίστα επιθυμιών, συνεδρίες) θα διαγραφούν. Το ιστορικό παραγγελιών διατηρείται και αν υπάρχει αποτρέπει τη διαγραφή.`
      )
    )
      return;

    setError(null);
    startTransition(async () => {
      const r = await deleteUser({ userId });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.push("/admin/users");
    });
  }

  return (
    <div>
      <DeleteButton
        onClick={handleClick}
        label={isPending ? "Διαγραφή..." : "Διαγραφή χρήστη"}
        disabled={isPending}
        size="md"
      />
      {error && <p className="text-xs text-destructive mt-1" role="alert">{error}</p>}
    </div>
  );
}
