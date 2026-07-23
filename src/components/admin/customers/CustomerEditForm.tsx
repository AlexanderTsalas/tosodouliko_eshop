"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCustomer } from "@/actions/customers/updateCustomer";
import { deleteCustomer } from "@/actions/customers/deleteCustomer";
import type { Customer } from "@/types/customer";
import PhoneCountryInput from "@/components/features/forms/PhoneCountryInput";
import {
  normalizeNameAdvanced,
  normalizeSurnameAdvanced,
  normalizeEmail,
  parsePhoneInput,
  isValidEmail,
  DEFAULT_PHONE_COUNTRY,
} from "@/lib/forms/normalize";
import type { CountryCode } from "libphonenumber-js";

interface Props {
  customer: Customer;
  orderCount: number;
}

/**
 * The editable customer-info form on /admin/customers/[id]. Plain saved-state
 * toggling — admin types changes, clicks Save, the row updates. Delete is
 * gated by `orderCount === 0 && auth_user_id === null` (also enforced on the
 * server), with a confirmation prompt.
 */
export default function CustomerEditForm({ customer, orderCount }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [email, setEmail] = useState(customer.email ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_PHONE_COUNTRY);
  const [firstName, setFirstName] = useState(customer.first_name ?? "");
  const [lastName, setLastName] = useState(customer.last_name ?? "");
  const [locale, setLocale] = useState(customer.preferred_locale);
  const [currency, setCurrency] = useState(customer.preferred_currency);
  const [marketingOptIn, setMarketingOptIn] = useState(customer.marketing_opt_in);
  const [notes, setNotes] = useState(customer.notes ?? "");

  function save() {
    setError(null);
    setSaved(false);
    const emailNorm = normalizeEmail(email);
    if (emailNorm && !isValidEmail(emailNorm)) {
      setError("Μη έγκυρο email.");
      return;
    }
    const phoneE164 = parsePhoneInput(phone, phoneCountry).e164;
    startTransition(async () => {
      const r = await updateCustomer({
        customer_id: customer.id,
        email: emailNorm || null,
        phone: phoneE164 || phone.trim() || null,
        first_name: normalizeNameAdvanced(firstName).value || null,
        last_name: normalizeSurnameAdvanced(lastName).value || null,
        preferred_locale: locale,
        preferred_currency: currency,
        marketing_opt_in: marketingOptIn,
        notes: notes.trim() || null,
        // Optimistic-lock guard — refuses the write if anyone else
        // (admin, webhook) advanced this customer since the form
        // loaded.
        expected_updated_at: customer.updated_at,
      });
      if (!r.success) {
        setError(r.error);
        if (r.code === "CONCURRENT_EDIT") {
          // Reload to fetch the latest customer state so the form
          // shows the new values; admin can re-edit on top.
          router.refresh();
        }
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  const deleteBlocked =
    customer.auth_user_id !== null
      ? "Συνδεδεμένος με λογαριασμό — διαγραφή από καρτέλα «Χρήστες»."
      : orderCount > 0
        ? `Έχει ${orderCount} παραγγελίες — δεν διαγράφεται.`
        : null;

  function handleDelete() {
    if (deleteBlocked) return;
    const ok = confirm(
      `Διαγραφή του πελάτη ΟΡΙΣΤΙΚΑ;\n\nΘα διαγραφούν και όλες οι αποθηκευμένες διευθύνσεις του.\n\nΑυτό δεν αναιρείται.`
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteCustomer({ customer_id: customer.id });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.replace("/admin/customers");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <label>
          <span className="block text-xs text-muted-foreground mb-1">Όνομα</span>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            onBlur={() => setFirstName(normalizeNameAdvanced(firstName).value)}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
        <label>
          <span className="block text-xs text-muted-foreground mb-1">Επώνυμο</span>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            onBlur={() => setLastName(normalizeSurnameAdvanced(lastName).value)}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
        <label>
          <span className="block text-xs text-muted-foreground mb-1">Email</span>
          <input
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setEmail(normalizeEmail(email))}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
        <label>
          <span className="block text-xs text-muted-foreground mb-1">Τηλέφωνο</span>
          <PhoneCountryInput
            value={phone}
            country={phoneCountry}
            onChange={({ value, country }) => {
              setPhone(value);
              setPhoneCountry(country);
            }}
          />
        </label>
        <label>
          <span className="block text-xs text-muted-foreground mb-1">Γλώσσα</span>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="border rounded px-2 py-1 w-full"
          >
            <option value="el">Ελληνικά</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          <span className="block text-xs text-muted-foreground mb-1">Νόμισμα</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="border rounded px-2 py-1 w-full"
          >
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
          </select>
        </label>
        <label className="flex items-center gap-2 md:col-span-2">
          <input
            type="checkbox"
            checked={marketingOptIn}
            onChange={(e) => setMarketingOptIn(e.target.checked)}
          />
          <span>Δέχεται marketing επικοινωνίες</span>
        </label>
        <label className="md:col-span-2">
          <span className="block text-xs text-muted-foreground mb-1">
            Σημειώσεις διαχείρισης (ιδιωτικές)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-emerald-700">✓ Αποθηκεύτηκε</p>}

      <div className="flex items-center justify-between pt-3 border-t">
        <div className="space-y-1">
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending || deleteBlocked !== null}
            className="rounded border border-destructive text-destructive px-3 py-1 text-sm disabled:opacity-40"
            title={deleteBlocked ?? "Διαγραφή πελάτη"}
          >
            Διαγραφή πελάτη
          </button>
          {deleteBlocked && (
            <p className="text-xs text-muted-foreground">{deleteBlocked}</p>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
        >
          {isPending ? "Αποθήκευση..." : "Αποθήκευση"}
        </button>
      </div>
    </div>
  );
}
