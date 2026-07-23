"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupplier } from "@/actions/suppliers/createSupplier";
import { updateSupplier } from "@/actions/suppliers/updateSupplier";
import type { Supplier } from "@/types/suppliers";
import {
  normalizeName,
  normalizeEmail,
  normalizeZip,
  normalizeAddressLine,
  parsePhoneInput,
  isValidEmail,
  DEFAULT_PHONE_COUNTRY,
} from "@/lib/forms/normalize";

interface Props {
  supplier?: Supplier;
  mode: "create" | "edit";
  /**
   * Optional URL to redirect to after a successful create / update.
   * Used by the deep-link "+ Νέος προμηθευτής" flow from the product
   * page so the admin lands back on the product they were editing.
   * Defaults to /admin/suppliers when omitted.
   */
  returnTo?: string;
}

export default function SupplierForm({ supplier, mode, returnTo }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    // Submit-time normalization (admin form uses uncontrolled inputs).
    // Email + phone go through the shared lib so storage stays consistent
    // with customer-side formats. Phone country is derived from the typed
    // "+XX" prefix or defaults to GR.
    const emailNorm = normalizeEmail(String(formData.get("primaryEmail") ?? ""));
    if (emailNorm && !isValidEmail(emailNorm)) {
      setError("Μη έγκυρο email.");
      return;
    }
    const phoneE164 =
      parsePhoneInput(
        String(formData.get("primaryPhone") ?? ""),
        DEFAULT_PHONE_COUNTRY
      ).e164;
    const countryCode =
      String(formData.get("countryCode") ?? "").trim().toUpperCase() || null;
    const base = {
      name: normalizeName(String(formData.get("name") ?? "")),
      primaryEmail: emailNorm || null,
      primaryPhone: phoneE164 || null,
      defaultCurrency: String(formData.get("defaultCurrency") ?? "EUR").trim().toUpperCase(),
      street: normalizeAddressLine(String(formData.get("street") ?? "")) || null,
      city: normalizeAddressLine(String(formData.get("city") ?? "")) || null,
      postalCode: normalizeZip(
        String(formData.get("postalCode") ?? ""),
        countryCode ?? "GR"
      ) || null,
      countryCode,
      notes: normalizeAddressLine(String(formData.get("notes") ?? "")) || null,
    };

    startTransition(async () => {
      if (mode === "create") {
        const r = await createSupplier(base);
        if (!r.success) {
          setError(r.error);
          return;
        }
        // Deep-link callers (e.g. "+ Νέος προμηθευτής" from a product
        // page) get redirected back to where they came from. Default
        // is the suppliers list. We only honor RELATIVE returnTo URLs
        // — never anything starting with "//" or a scheme — so this
        // can't be hijacked to redirect off-site.
        const safeReturn =
          returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
            ? returnTo
            : "/admin/suppliers";
        router.push(safeReturn);
      } else if (supplier) {
        const r = await updateSupplier({
          id: supplier.id,
          ...base,
          active: formData.get("active") === "on",
        });
        if (!r.success) {
          setError(r.error);
          return;
        }
        router.push("/admin/suppliers");
      }
    });
  }

  return (
    <form action={handleSubmit} className="grid grid-cols-2 gap-4 max-w-3xl">
      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-sm font-medium">Όνομα *</span>
        <input
          name="name"
          required
          defaultValue={supplier?.name}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Email επικοινωνίας</span>
        <input
          name="primaryEmail"
          type="email"
          defaultValue={supplier?.primary_email ?? ""}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Τηλέφωνο</span>
        <input
          name="primaryPhone"
          defaultValue={supplier?.primary_phone ?? ""}
          placeholder="+30 …"
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Προεπιλεγμένο νόμισμα *</span>
        <input
          name="defaultCurrency"
          required
          defaultValue={supplier?.default_currency ?? "EUR"}
          maxLength={3}
          className="border rounded px-3 py-2 uppercase font-mono"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Χώρα (ISO 2)</span>
        <input
          name="countryCode"
          defaultValue={supplier?.country_code ?? ""}
          maxLength={2}
          placeholder="GR"
          className="border rounded px-3 py-2 uppercase font-mono"
        />
      </label>

      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-sm font-medium">Διεύθυνση</span>
        <input
          name="street"
          defaultValue={supplier?.street ?? ""}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Πόλη</span>
        <input
          name="city"
          defaultValue={supplier?.city ?? ""}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Τ.Κ.</span>
        <input
          name="postalCode"
          defaultValue={supplier?.postal_code ?? ""}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-sm font-medium">Σημειώσεις</span>
        <textarea
          name="notes"
          rows={4}
          defaultValue={supplier?.notes ?? ""}
          placeholder="π.χ. δευτερεύουσες επαφές, όροι πληρωμής, ώρες λειτουργίας…"
          className="border rounded px-3 py-2"
        />
      </label>

      {mode === "edit" && (
        <label className="flex items-center gap-2 col-span-2">
          <input type="checkbox" name="active" defaultChecked={supplier?.active ?? true} />
          <span className="text-sm">Ενεργός</span>
        </label>
      )}

      {error && <p role="alert" className="col-span-2 text-sm text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="col-span-2 rounded bg-primary text-primary-foreground py-2 disabled:opacity-50"
      >
        {isPending
          ? "Αποθήκευση..."
          : mode === "create"
          ? "Δημιουργία προμηθευτή"
          : "Αποθήκευση αλλαγών"}
      </button>
    </form>
  );
}
