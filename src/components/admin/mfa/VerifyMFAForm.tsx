"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { verifyRecoveryCode } from "@/actions/mfa/verifyRecoveryCode";

/**
 * Recurring MFA prompt — admin is already enrolled with a verified TOTP
 * factor, and is now signing back in. We pick the first verified factor,
 * issue a fresh challenge on every page load (cheap), and submit
 * challengeId + code on Verify. Success promotes the session to AAL2 and
 * forwards into /admin.
 *
 * Recovery path: an "Έχασα τη συσκευή μου" link toggles a recovery-code
 * input. Submitting a valid code deletes the user's TOTP factor and
 * issues a fresh enrollment token; we redirect to /admin/mfa-enroll
 * with the token so the admin can immediately re-enroll a new device.
 */
export default function VerifyMFAForm() {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        setError(error.message);
        return;
      }
      const verified = (data?.totp ?? []).find((f) => f.status === "verified");
      if (!verified) {
        // No factor — kick to enroll.
        router.replace("/admin/mfa-enroll");
        return;
      }
      setFactorId(verified.id);
    })();
  }, [router]);

  function verify() {
    if (!factorId) return;
    const cleaned = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(cleaned)) {
      setError("Δώστε τον 6-ψήφιο κωδικό από την εφαρμογή.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
        factorId,
      });
      if (chErr || !challenge) {
        setError(chErr?.message ?? "Αποτυχία επικοινωνίας MFA.");
        return;
      }
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: cleaned,
      });
      if (vErr) {
        setError(vErr.message ?? "Λάθος κωδικός.");
        return;
      }
      router.replace("/admin");
      router.refresh();
    });
  }

  function submitRecovery() {
    const cleaned = recoveryCode.trim();
    if (cleaned.length < 8) {
      setError("Δώστε έγκυρο κωδικό ανάκτησης (8 χαρακτήρες).");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await verifyRecoveryCode({ code: cleaned });
      if (!r.success) {
        setError(r.error);
        return;
      }
      // The user is now in "needs to enroll" state with a fresh token.
      // Pass the token via URL so /admin/mfa-enroll opens the QR.
      router.replace(`/admin/mfa-enroll?token=${encodeURIComponent(r.data.enrollmentToken)}`);
      router.refresh();
    });
  }

  if (factorId === null && !error && !recoveryMode) {
    return <p className="text-sm text-muted-foreground">Φόρτωση...</p>;
  }

  if (recoveryMode) {
    return (
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Πληκτρολογήστε έναν από τους κωδικούς ανάκτησης που αποθηκεύσατε
          κατά την εγγραφή MFA. Κάθε κωδικός χρησιμοποιείται μόνο μία φορά.
        </p>
        <p className="text-xs text-muted-foreground">
          Μετά τη χρήση, ο τρέχων Authenticator καταργείται και θα σας
          ζητηθεί να συνδέσετε νέα συσκευή.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            placeholder="XXXX-XXXX"
            maxLength={20}
            className="border rounded px-3 py-2 w-40 font-mono text-center tracking-wider uppercase"
            autoFocus
          />
          <button
            type="button"
            onClick={submitRecovery}
            disabled={isPending}
            className="rounded bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50"
          >
            {isPending ? "Έλεγχος..." : "Ανάκτηση"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setRecoveryMode(false);
            setRecoveryCode("");
            setError(null);
          }}
          className="text-xs text-muted-foreground underline"
        >
          ← Επιστροφή στον 6-ψήφιο κωδικό
        </button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Πληκτρολογήστε τον τρέχοντα 6-ψήφιο κωδικό από την Authenticator εφαρμογή σας.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="6 ψηφία"
          className="border rounded px-3 py-2 w-32 font-mono text-center tracking-widest"
          autoFocus
        />
        <button
          type="button"
          onClick={verify}
          disabled={isPending || factorId === null}
          className="rounded bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50"
        >
          {isPending ? "Έλεγχος..." : "Συνέχεια"}
        </button>
      </div>
      <button
        type="button"
        onClick={() => {
          setRecoveryMode(true);
          setError(null);
        }}
        className="text-xs text-muted-foreground underline"
      >
        Έχασα τη συσκευή μου — χρήση κωδικού ανάκτησης
      </button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
