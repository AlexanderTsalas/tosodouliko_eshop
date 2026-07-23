"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCustomDeliveryMethod } from "@/actions/courier-settings/createCustomDeliveryMethod";
import { updateCustomDeliveryMethod } from "@/actions/courier-settings/updateCustomDeliveryMethod";
import { DELIVERY_METHODS, type DeliveryMethodValue } from "@/config/storefront";

interface CarrierOption {
  slug: string;
  display_name: string;
  is_active: boolean;
}

export interface CustomDeliveryMethodInitial {
  slug: string;
  display_name: string;
  description: string | null;
  base_method: DeliveryMethodValue;
  carrier_slug: string | null;
}

interface Props {
  /** Pass for edit mode. Omit for create. */
  initial?: CustomDeliveryMethodInitial;
  /** Carriers shown in the optional scope dropdown. */
  carriers: CarrierOption[];
  onSaved?: () => void;
  onCancel?: () => void;
}

/**
 * Create + edit form for custom delivery methods. The shape mirrors
 * DeliveryCarrierForm so the management surface feels consistent.
 *
 * Carrier scope is OPTIONAL — leaving the dropdown empty means "any
 * carrier supporting this base_method". Picking a carrier means the
 * custom method only surfaces when that carrier is chosen at checkout.
 */
export default function CustomDeliveryMethodForm({
  initial,
  carriers,
  onSaved,
  onCancel,
}: Props) {
  const router = useRouter();
  const isEdit = Boolean(initial);

  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [baseMethod, setBaseMethod] = useState<DeliveryMethodValue>(
    initial?.base_method ?? "home_delivery"
  );
  const [carrierSlug, setCarrierSlug] = useState(initial?.carrier_slug ?? "");

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!displayName.trim()) {
      setError("Συμπληρώστε το όνομα του τρόπου παράδοσης.");
      return;
    }

    startTransition(async () => {
      const res = isEdit
        ? await updateCustomDeliveryMethod({
            slug: initial!.slug,
            display_name: displayName.trim(),
            description: description.trim() || null,
            base_method: baseMethod,
            carrier_slug: carrierSlug.trim() || null,
          })
        : await createCustomDeliveryMethod({
            display_name: displayName.trim(),
            description: description.trim() || null,
            base_method: baseMethod,
            carrier_slug: carrierSlug.trim() || null,
          });

      if (!res.success) {
        setError(res.error);
        return;
      }
      onSaved?.();
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">
          Όνομα (όπως φαίνεται στον πελάτη)
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={isPending}
          maxLength={120}
          placeholder="π.χ. Παράδοση με δικό μας Van"
          required
          className="w-full rounded border px-2 py-1 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Περιγραφή <span className="text-muted-foreground font-normal">(προαιρετικό)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isPending}
          maxLength={500}
          rows={2}
          placeholder="π.χ. Παράδοση εντός Αθηνών μέσω δικού μας van. Παράδοση εντός 24 ωρών."
          className="w-full rounded border px-2 py-1 text-sm"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Εμφανίζεται κάτω από την επιλογή στο checkout.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Τύπος παράδοσης (technical base)
        </label>
        <select
          value={baseMethod}
          onChange={(e) => setBaseMethod(e.target.value as DeliveryMethodValue)}
          disabled={isPending}
          className="w-full rounded border px-2 py-1 text-sm"
        >
          {DELIVERY_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground mt-1">
          Καθορίζει αν χρειάζεται διεύθυνση, επιλογή σημείου παραλαβής, και
          συμβατότητα με μεθόδους πληρωμής. Π.χ. για «Van» επιλέξτε
          «Παράδοση στο σπίτι».
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Σύνδεση με μεταφορική <span className="text-muted-foreground font-normal">(προαιρετικό)</span>
        </label>
        <select
          value={carrierSlug}
          onChange={(e) => setCarrierSlug(e.target.value)}
          disabled={isPending}
          className="w-full rounded border px-2 py-1 text-sm"
        >
          <option value="">Οποιαδήποτε συμβατή μεταφορική</option>
          {carriers.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.display_name}
              {!c.is_active && " (ανενεργή)"}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground mt-1">
          Αν επιλέξετε μεταφορική, αυτός ο τρόπος παράδοσης εμφανίζεται μόνο
          μαζί της. Π.χ. «Van» → δική σας custom μεταφορική.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2 pt-2 border-t">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {isPending
            ? "Αποθήκευση..."
            : isEdit
              ? "Αποθήκευση αλλαγών"
              : "Δημιουργία τρόπου παράδοσης"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="btn btn-secondary btn-md"
          >
            Άκυρο
          </button>
        )}
      </div>
    </form>
  );
}
