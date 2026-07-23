"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateNotificationMode } from "@/actions/wishlist-queue";

interface Props {
  currentMode: "automated" | "manual";
}

export default function WishlistQueueModeToggle({ currentMode }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"automated" | "manual">(currentMode);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(next: "automated" | "manual") {
    if (next === mode) return;
    const prev = mode;
    setMode(next);
    setError(null);
    startTransition(async () => {
      const r = await updateNotificationMode({ mode: next });
      if (!r.success) {
        setError(r.error);
        setMode(prev);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="rounded border p-4 bg-muted/10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">Λειτουργία ειδοποιήσεων λίστας επιθυμιών</h2>
          <p className="text-sm text-muted-foreground mt-1">
            <strong>Αυτόματα</strong>: το σύστημα στέλνει τις ειδοποιήσεις
            μόλις επιστρέψει απόθεμα.
            <br />
            <strong>Χειροκίνητα</strong>: οι ειδοποιήσεις μπαίνουν σε αυτή
            τη λίστα και επιβεβαιώνετε χειροκίνητα ποιες θα φύγουν.
          </p>
        </div>
        <div className="flex flex-col gap-2 min-w-[180px]">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="wishlist_mode"
              value="automated"
              checked={mode === "automated"}
              onChange={() => handleChange("automated")}
              disabled={isPending}
            />
            <span>Αυτόματα</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="wishlist_mode"
              value="manual"
              checked={mode === "manual"}
              onChange={() => handleChange("manual")}
              disabled={isPending}
            />
            <span>Χειροκίνητα</span>
          </label>
          {isPending && <p className="text-xs text-muted-foreground">Αποθήκευση...</p>}
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
