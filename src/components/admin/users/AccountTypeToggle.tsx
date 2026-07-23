"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAccountType } from "@/actions/users";

/**
 * Flips a user between the storefront ('customer') and back-office
 * ('internal') boundary. Server-guarded (manage:users, no self-change, no
 * last-admin demotion); this is UX only.
 */
export default function AccountTypeToggle({
  userId,
  current,
}: {
  userId: string;
  current: "customer" | "internal";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const next = current === "internal" ? "customer" : "internal";
  const label =
    current === "internal"
      ? "Υποβιβασμός σε πελάτη"
      : "Προαγωγή σε εσωτερικό χρήστη";

  function handleClick() {
    if (
      !confirm(
        next === "internal"
          ? "Προαγωγή σε εσωτερικό χρήστη; Θα αποκτήσει πρόσβαση στο back-office (ανάλογα με τους ρόλους του)."
          : "Υποβιβασμός σε πελάτη; Θα χάσει κάθε πρόσβαση στο back-office ακόμη κι αν διατηρεί ρόλους."
      )
    )
      return;

    setError(null);
    startTransition(async () => {
      const r = await setAccountType({ userId, accountType: next });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="btn btn-secondary btn-sm"
      >
        {isPending ? "…" : label}
      </button>
      {error && (
        <p className="text-xs text-destructive mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
