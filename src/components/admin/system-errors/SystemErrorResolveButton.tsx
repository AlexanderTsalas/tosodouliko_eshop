"use client";

import { useState, useTransition } from "react";
import { markSystemErrorResolved } from "@/actions/system-errors/markSystemErrorResolved";

/**
 * Toggle button for the resolved state of a system_errors row.
 * Optimistic flip with rollback if the server action fails. Same
 * pattern as ErrorResolveButton (application errors); separate
 * component because the target table + action differ.
 */
export default function SystemErrorResolveButton({
  id,
  initiallyResolved,
}: {
  id: string;
  initiallyResolved: boolean;
}) {
  const [resolved, setResolved] = useState(initiallyResolved);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !resolved;
    const prev = resolved;
    setResolved(next);
    startTransition(async () => {
      const r = await markSystemErrorResolved({ id, resolved: next });
      if (!r.success) setResolved(prev);
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      className="text-sm underline"
      aria-pressed={resolved}
    >
      {resolved ? "Επαναφορά" : "Επιλύθηκε"}
    </button>
  );
}
