"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createShippingRate } from "@/actions/shipping/createShippingRate";
import { updateShippingRate } from "@/actions/shipping/updateShippingRate";
import type { ShippingRate, ShippingZone } from "@/types/shipping";

interface Props {
  rate?: ShippingRate;
  zones: ShippingZone[];
  mode: "create" | "edit";
}

export default function ShippingRateForm({ rate, zones, mode }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    const num = (k: string) => {
      const s = String(formData.get(k) ?? "");
      return s ? Number(s) : null;
    };

    const base = {
      carrier: String(formData.get("carrier") ?? ""),
      zone: String(formData.get("zone") ?? ""),
      zoneId: (String(formData.get("zoneId") ?? "") || null) as string | null,
      minWeightG: Number(formData.get("minWeightG") ?? 0),
      maxWeightG: num("maxWeightG"),
      minOrderAmount: num("minOrderAmount"),
      rate: Number(formData.get("rate") ?? 0),
      freeAbove: num("freeAbove"),
      active: formData.get("active") === "on",
    };

    startTransition(async () => {
      if (mode === "create") {
        const r = await createShippingRate(base);
        if (!r.success) {
          setError(r.error);
          return;
        }
      } else if (rate) {
        const r = await updateShippingRate({ id: rate.id, ...base });
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
        <span className="text-sm font-medium">Μεταφορέας *</span>
        <input name="carrier" required defaultValue={rate?.carrier} className="border rounded px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Κωδικός ζώνης (free-text) *</span>
        <input name="zone" required defaultValue={rate?.zone} className="border rounded px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-sm font-medium">Σύνδεση με ζώνη (προαιρετικό)</span>
        <select name="zoneId" defaultValue={rate?.zone_id ?? ""} className="border rounded px-3 py-2">
          <option value="">— καμία —</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>{z.name} ({z.code})</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Ελάχ. βάρος (g)</span>
        <input
          type="number"
          name="minWeightG"
          defaultValue={rate?.min_weight_g ?? 0}
          className="border rounded px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Μέγ. βάρος (g)</span>
        <input
          type="number"
          name="maxWeightG"
          defaultValue={rate?.max_weight_g ?? ""}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Ελάχ. αξία παραγγελίας</span>
        <input
          type="number"
          step="0.01"
          name="minOrderAmount"
          defaultValue={rate?.min_order_amount ?? ""}
          className="border rounded px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Δωρεάν πάνω από</span>
        <input
          type="number"
          step="0.01"
          name="freeAbove"
          defaultValue={rate?.free_above ?? ""}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-sm font-medium">Τιμή *</span>
        <input
          type="number"
          step="0.01"
          name="rate"
          required
          defaultValue={rate?.rate}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex items-center gap-2 col-span-2">
        <input type="checkbox" name="active" defaultChecked={rate?.active ?? true} />
        <span className="text-sm">Ενεργό</span>
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
