"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Landing form for an admin-issued invite / recovery link. Establishes a
 * session from the token_hash via verifyOtp (NOT exchangeCodeForSession — the
 * link is minted by the cookieless service-role client, so there is no PKCE
 * code_verifier in this browser), then lets the user set their own password
 * and forwards them into /admin.
 */
export default function AcceptInviteForm({
  tokenHash,
  type,
}: {
  tokenHash?: string;
  type?: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"verifying" | "ready" | "error">(
    "verifying"
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      if (!tokenHash) {
        setError("Λείπει ο σύνδεσμος πρόσκλησης. Ζητήστε νέα πρόσκληση.");
        setPhase("error");
        return;
      }
      const supabase = createClient();
      const otpType: EmailOtpType = type === "recovery" ? "recovery" : "invite";
      const { error: vErr } = await supabase.auth.verifyOtp({
        type: otpType,
        token_hash: tokenHash,
      });
      if (vErr) {
        setError(
          "Ο σύνδεσμος δεν είναι έγκυρος ή έχει λήξει. Ζητήστε νέα πρόσκληση από τον διαχειριστή σας."
        );
        setPhase("error");
        return;
      }
      setPhase("ready");
    })();
  }, [tokenHash, type]);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (password.length < 8) {
      setError("Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.");
      return;
    }
    if (password !== confirm) {
      setError("Οι κωδικοί δεν ταιριάζουν.");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { error: uErr } = await supabase.auth.updateUser({ password });
    if (uErr) {
      setError(uErr.message);
      setSubmitting(false);
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  if (phase === "verifying") {
    return (
      <p className="text-sm text-muted-foreground">Επαλήθευση συνδέσμου…</p>
    );
  }
  if (phase === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3 max-w-sm">
      <label className="flex flex-col gap-1">
        <span className="text-sm">Νέος κωδικός</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="border rounded px-3 py-2 font-mono"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">Επιβεβαίωση κωδικού</span>
        <input
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="border rounded px-3 py-2 font-mono"
        />
      </label>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-primary text-primary-foreground py-2 disabled:opacity-50"
      >
        {submitting ? "Αποθήκευση…" : "Ορισμός κωδικού"}
      </button>
      <p className="text-xs text-muted-foreground mt-1">
        Μετά τον ορισμό κωδικού θα χρειαστείτε τον ξεχωριστό κωδικό
        ενεργοποίησης MFA που σας έδωσε ο διαχειριστής σας.
      </p>
    </form>
  );
}
