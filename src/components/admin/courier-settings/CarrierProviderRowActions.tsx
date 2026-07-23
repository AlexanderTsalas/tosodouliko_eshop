"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteCarrierProvider,
  setActiveCarrierProvider,
  testCarrierProvider,
} from "@/actions/courier-settings";
import type { CarrierProviderConfig } from "@/types/carrier-provider";

interface Props {
  provider: CarrierProviderConfig;
}

export default function CarrierProviderRowActions({ provider }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  function activate() {
    clearMessages();
    if (!confirm(`Ενεργοποίηση "${provider.display_name}";`)) return;
    startTransition(async () => {
      const r = await setActiveCarrierProvider({ id: provider.id });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function runTest() {
    clearMessages();
    startTransition(async () => {
      const r = await testCarrierProvider({ id: provider.id });
      if (!r.success) {
        setError(r.error);
        return;
      }
      if (r.data.ok) {
        setSuccess("✓ Test OK");
      } else {
        setError("Test απέτυχε: " + (r.data.message ?? "(no message)"));
      }
      router.refresh();
    });
  }

  function remove() {
    clearMessages();
    if (
      !confirm(
        `Οριστική διαγραφή του "${provider.display_name}";\n\n` +
          "Θα διαγραφούν και τα κρυπτογραφημένα credentials."
      )
    )
      return;
    startTransition(async () => {
      const r = await deleteCarrierProvider({ id: provider.id });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {!provider.is_active && (
          <button
            type="button"
            onClick={activate}
            disabled={isPending || !provider.secrets_encrypted}
            title={
              !provider.secrets_encrypted
                ? "Αποθηκεύστε credentials πρώτα"
                : "Καθιστά αυτήν την ενεργή ρύθμιση για αυτόν τον courier"
            }
            className="rounded border border-emerald-600 text-emerald-700 px-3 py-1 text-xs disabled:opacity-40"
          >
            Ενεργοποίηση
          </button>
        )}
        <button
          type="button"
          onClick={runTest}
          disabled={isPending || !provider.is_active}
          title={
            !provider.is_active
              ? "Ενεργοποιήστε τη ρύθμιση πρώτα"
              : "Καλεί ένα read-only endpoint για έλεγχο credentials"
          }
          className="rounded border px-3 py-1 text-xs disabled:opacity-40"
        >
          {isPending ? "..." : "Test connection"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={isPending || provider.is_active}
          title={
            provider.is_active
              ? "Δεν διαγράφεται η ενεργή ρύθμιση. Απενεργοποιήστε πρώτα."
              : ""
          }
          className="rounded border border-destructive text-destructive px-3 py-1 text-xs disabled:opacity-40"
        >
          Διαγραφή
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {success && <p className="text-xs text-emerald-700">{success}</p>}
    </div>
  );
}
