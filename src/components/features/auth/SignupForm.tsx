"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "@/actions/auth/signUp";
import { mergeAnonCart } from "@/actions/cart/mergeAnonCart";
import { createClient } from "@/lib/supabase/client";
import {
  normalizeNameAdvanced,
  normalizeSurnameAdvanced,
  normalizeEmail,
  isValidEmail,
} from "@/lib/forms/normalize";

interface Props {
  /** Where to send the customer after sign-up + email confirmation. */
  next?: string;
}

export default function SignupForm({ next = "/" }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      // Phase 9C: capture anonymous uid before signUp swaps the session.
      let anonUserId: string | null = null;
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (data.user?.is_anonymous) anonUserId = data.user.id;
      } catch {
        /* ignore */
      }

      // Submit-time normalization. Email is lowercased + trimmed, names
      // trim + collapse internal whitespace. We do this client-side so the
      // server gets the canonical form and audit logs / customer rows stay
      // consistent across creation surfaces.
      const emailNorm = normalizeEmail(String(formData.get("email") ?? ""));
      if (!isValidEmail(emailNorm)) {
        setError("Μη έγκυρο email.");
        return;
      }
      const r = await signUp({
        email: emailNorm,
        password: String(formData.get("password") ?? ""),
        firstName: normalizeNameAdvanced(String(formData.get("firstName") ?? "")).value,
        lastName: normalizeSurnameAdvanced(String(formData.get("lastName") ?? "")).value,
        marketingOptIn: formData.get("marketingOptIn") === "on",
        next,
        company: String(formData.get("company") ?? ""),
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      if (r.data.needsConfirmation) {
        setSuccess("Ελέγξτε το email σας για επιβεβαίωση.");
      } else {
        // Session is now permanent — merge anon cart if we had one.
        if (anonUserId) {
          await mergeAnonCart({ anon_user_id: anonUserId });
        }
        router.push(next);
        router.refresh();
      }
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3 max-w-sm">
      {/* Honeypot — visually hidden, not focusable, ARIA-hidden. Bots
          tend to fill all inputs; legitimate users never see this one.
          Server rejects any non-empty value with a generic error. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-9999px",
          width: "1px",
          height: "1px",
          overflow: "hidden",
        }}
      >
        <label>
          Εταιρεία (μην συμπληρώσετε)
          <input
            type="text"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Όνομα</span>
          <input name="firstName" required className="border rounded px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm">Επώνυμο</span>
          <input name="lastName" required className="border rounded px-3 py-2" />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-sm">Email</span>
        <input name="email" type="email" required className="border rounded px-3 py-2" autoComplete="email" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">Κωδικός</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          className="border rounded px-3 py-2"
          autoComplete="new-password"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="marketingOptIn" />
        <span>Θέλω να λαμβάνω newsletter</span>
      </label>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {success && <p className="text-sm" role="status">{success}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-primary text-primary-foreground py-2 disabled:opacity-50"
      >
        {isPending ? "Εγγραφή..." : "Εγγραφή"}
      </button>
    </form>
  );
}
