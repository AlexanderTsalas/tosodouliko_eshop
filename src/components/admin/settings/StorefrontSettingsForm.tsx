"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateStorefrontSettings } from "@/actions/settings/updateStorefrontSettings";

interface Props {
  initialShowWhenOosDefault: boolean;
}

export default function StorefrontSettingsForm({
  initialShowWhenOosDefault,
}: Props) {
  const router = useRouter();
  const [showWhenOos, setShowWhenOos] = useState(initialShowWhenOosDefault);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSavedMsg(null);
    const next = formData.get("showWhenOos") === "on";
    startTransition(async () => {
      const r = await updateStorefrontSettings({ showWhenOosDefault: next });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setShowWhenOos(next);
      setSavedMsg("Αποθηκεύτηκε.");
      router.refresh();
    });
  }

  return (
    <form action={handleSubmit} className="space-y-6 max-w-2xl">
      <fieldset className="border rounded p-4 space-y-2">
        <legend className="text-sm font-medium px-1">
          Ορατότητα προϊόντων όταν εξαντλούνται
        </legend>
        <p className="text-xs text-muted-foreground">
          Καθολική προεπιλογή. Αν ενεργοποιηθεί, τα προϊόντα και οι παραλλαγές
          συνεχίζουν να εμφανίζονται στο κατάστημα με κουμπί &laquo;Ειδοποιήστε
          με&raquo; και &laquo;Προσθήκη στη λίστα επιθυμιών&raquo; όταν το
          απόθεμα είναι μηδέν. Διαφορετικά κρύβονται μέχρι να επιστρέψουν σε
          απόθεμα.
        </p>
        <p className="text-xs text-muted-foreground">
          Παρακάμπτεται από τη ρύθμιση κάθε προϊόντος και παραλλαγής όπου
          οριστεί ρητά.
        </p>
        <label className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            name="showWhenOos"
            defaultChecked={showWhenOos}
          />
          <span className="text-sm">
            Να παραμένουν ορατά τα προϊόντα όταν εξαντλούνται
          </span>
        </label>
      </fieldset>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {savedMsg && <p className="text-sm text-emerald-700">{savedMsg}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50"
      >
        {isPending ? "Αποθήκευση..." : "Αποθήκευση"}
      </button>
    </form>
  );
}
