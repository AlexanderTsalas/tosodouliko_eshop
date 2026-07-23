"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { matchOrCreateCustomer } from "@/actions/customers/matchOrCreateCustomer";
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

/**
 * Direct admin-side customer creation. Calls matchOrCreateCustomer with
 * prompt_on_match=true so the strict (email AND phone) dedup prompt fires
 * here too — admin types in a customer, if it's a duplicate they get the
 * "Είναι ο ίδιος;" callout and can either jump to the existing record or
 * force a fresh one.
 */
export default function NewCustomerForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_PHONE_COUNTRY);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [source, setSource] = useState<"admin_manual" | "phone" | "in_store">(
    "admin_manual"
  );

  const [matchPrompt, setMatchPrompt] = useState<Customer | null>(null);
  const [forceNew, setForceNew] = useState(false);

  function clearMatchPromptOnEdit() {
    setMatchPrompt(null);
    setForceNew(false);
  }

  function submit() {
    setError(null);
    const emailNorm = normalizeEmail(email);
    const phoneE164 = parsePhoneInput(phone, phoneCountry).e164;
    if (!emailNorm && !phoneE164) {
      setError("Συμπληρώστε email ή τηλέφωνο.");
      return;
    }
    if (emailNorm && !isValidEmail(emailNorm)) {
      setError("Μη έγκυρο email.");
      return;
    }
    startTransition(async () => {
      const r = await matchOrCreateCustomer({
        email: emailNorm || undefined,
        phone: phoneE164 || undefined,
        first_name: normalizeNameAdvanced(firstName).value || undefined,
        last_name: normalizeSurnameAdvanced(lastName).value || undefined,
        source,
        prompt_on_match: true,
        force_new: forceNew,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      if (r.data.outcome === "matched" && r.data.needs_confirmation) {
        setMatchPrompt(r.data.customer);
        return;
      }
      router.push(`/admin/customers/${r.data.customer.id}`);
    });
  }

  function acceptMatch() {
    if (!matchPrompt) return;
    router.push(`/admin/customers/${matchPrompt.id}`);
  }

  function rejectMatch() {
    setMatchPrompt(null);
    setForceNew(true);
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <label>
          <span className="block text-xs text-muted-foreground mb-1">Όνομα</span>
          <input
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              clearMatchPromptOnEdit();
            }}
            onBlur={() => setFirstName(normalizeNameAdvanced(firstName).value)}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
        <label>
          <span className="block text-xs text-muted-foreground mb-1">Επώνυμο</span>
          <input
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
              clearMatchPromptOnEdit();
            }}
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
            onChange={(e) => {
              setEmail(e.target.value);
              clearMatchPromptOnEdit();
            }}
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
              clearMatchPromptOnEdit();
            }}
          />
        </label>
        <label className="md:col-span-2">
          <span className="block text-xs text-muted-foreground mb-1">Πηγή</span>
          <select
            value={source}
            onChange={(e) =>
              setSource(e.target.value as "admin_manual" | "phone" | "in_store")
            }
            className="border rounded px-2 py-1 w-full"
          >
            <option value="admin_manual">Από admin (γενικά)</option>
            <option value="phone">Τηλεφωνική επικοινωνία</option>
            <option value="in_store">Σε κατάστημα</option>
          </select>
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        Αν τα στοιχεία ταιριάζουν με υπάρχοντα πελάτη, θα εμφανιστεί επιβεβαίωση πριν τη
        δημιουργία.
      </p>

      {matchPrompt && (
        <div className="rounded border border-primary/50 bg-primary/5 p-3 space-y-2">
          <p className="text-sm font-medium">Είναι αυτός ο ίδιος πελάτης;</p>
          <p className="text-sm">
            {[matchPrompt.first_name, matchPrompt.last_name]
              .filter(Boolean)
              .join(" ") || "(χωρίς όνομα)"}
            {matchPrompt.email && (
              <span className="text-muted-foreground"> · {matchPrompt.email}</span>
            )}
            {matchPrompt.phone && (
              <span className="text-muted-foreground"> · {matchPrompt.phone}</span>
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={acceptMatch}
              className="rounded bg-primary text-primary-foreground px-3 py-1 text-xs"
            >
              Ναι, ανοίξτε αυτόν τον πελάτη
            </button>
            <button
              type="button"
              onClick={rejectMatch}
              className="rounded border border-amber-500 text-amber-700 px-3 py-1 text-xs"
            >
              Όχι, δημιούργησε νέο
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-center">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
        >
          {isPending ? "Δημιουργία..." : "Δημιουργία πελάτη"}
        </button>
      </div>
    </div>
  );
}
