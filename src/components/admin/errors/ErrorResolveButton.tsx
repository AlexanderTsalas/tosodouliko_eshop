"use client";

import { useState, useTransition } from "react";
import { setErrorResolved } from "@/actions/errors/setErrorResolved";

export default function ErrorResolveButton({
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
      const r = await setErrorResolved({ id, resolved: next });
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
