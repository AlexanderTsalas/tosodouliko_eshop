"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createShippingZone } from "@/actions/shipping/createShippingZone";
import { updateShippingZone } from "@/actions/shipping/updateShippingZone";
import type { ShippingZone } from "@/types/shipping";

interface Props {
  zone?: ShippingZone;
  mode: "create" | "edit";
}

export default function ShippingZoneForm({ zone, mode }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    const countriesRaw = String(formData.get("countryCodes") ?? "");
    const countryCodes = countriesRaw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length === 2);

    if (countryCodes.length === 0) {
      setError("Δώστε τουλάχιστον έναν κωδικό χώρας (π.χ. GR, CY)");
      return;
    }

    const base = {
      name: String(formData.get("name") ?? ""),
      code: String(formData.get("code") ?? "").toUpperCase(),
      countryCodes,
      active: formData.get("active") === "on",
    };

    startTransition(async () => {
      if (mode === "create") {
        const r = await createShippingZone(base);
        if (!r.success) {
          setError(r.error);
          return;
        }
      } else if (zone) {
        const r = await updateShippingZone({ id: zone.id, ...base });
        if (!r.success) {
          setError(r.error);
          return;
        }
      }
      router.push("/admin/shipping");
    });
  }

  return (
    <form action={handleSubmit} className="grid grid-cols-2 gap-4 max-w-2xl">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Όνομα *</span>
        <input name="name" required defaultValue={zone?.name} className="border rounded px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Κωδικός ζώνης *</span>
        <input
          name="code"
          required
          defaultValue={zone?.code}
          className="border rounded px-3 py-2 uppercase"
        />
      </label>
      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-sm font-medium">Χώρες (ISO 2-γραμμάτων, διαχωρισμένες με κόμμα) *</span>
        <input
          name="countryCodes"
          required
          defaultValue={zone?.country_codes?.join(", ") ?? "GR"}
          placeholder="GR, CY"
          className="border rounded px-3 py-2 font-mono"
        />
      </label>
      <label className="flex items-center gap-2 col-span-2">
        <input type="checkbox" name="active" defaultChecked={zone?.active ?? true} />
        <span className="text-sm">Ενεργή</span>
      </label>

      {error && <p role="alert" className="col-span-2 text-sm text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="col-span-2 rounded bg-primary text-primary-foreground py-2 disabled:opacity-50"
      >
        {isPending ? "Αποθήκευση..." : mode === "create" ? "Δημιουργία" : "Αποθήκευση"}
      </button>
    </form>
  );
}
