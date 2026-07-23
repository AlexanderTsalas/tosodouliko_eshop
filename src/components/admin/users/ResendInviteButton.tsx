"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resendInvite } from "@/actions/users";

/**
 * Re-issue the set-password link for a user who hasn't finished onboarding.
 * Shows the link with a copy fallback (email may not be configured).
 */
export default function ResendInviteButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; emailed: boolean } | null>(
    null
  );
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const r = await resendInvite({ userId });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setResult({ url: r.data.setPasswordUrl, emailed: r.data.emailDelivered });
      router.refresh();
    });
  }

  if (result) {
    return (
      <div className="rounded border px-3 py-2 text-sm space-y-2">
        <p className="text-xs">
          {result.emailed
            ? "✓ Νέο email πρόσκλησης στάλθηκε."
            : "⚠ Δεν στάλθηκε email — αντιγράψτε και στείλτε τον σύνδεσμο:"}
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 font-mono text-xs bg-muted px-2 py-1 rounded break-all">
            {result.url}
          </code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(result.url)}
            className="text-xs rounded border px-2 py-1"
          >
            📋
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="btn btn-secondary btn-sm"
      >
        {isPending ? "…" : "Επαναποστολή πρόσκλησης"}
      </button>
      {error && (
        <p className="text-xs text-destructive mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
