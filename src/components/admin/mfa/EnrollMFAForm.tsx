"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { consumeEnrollmentToken } from "@/actions/mfa/consumeEnrollmentToken";
import { generateRecoveryCodes } from "@/actions/mfa/generateRecoveryCodes";

type EnrollState =
  | { phase: "loading" }
  | { phase: "ready"; factorId: string; qrCode: string; secret: string }
  | { phase: "showing-codes"; codes: string[] }
  | { phase: "error"; message: string };

interface Props {
  /**
   * Plaintext enrollment token passed from the page (already validated
   * server-side). The form consumes it AFTER successful TOTP verify so
   * an interrupted scan can be resumed with the same token until expiry.
   */
  enrollmentToken: string;
}

/**
 * One-shot TOTP enrollment + recovery-code generation.
 *
 * Flow:
 *   1. On mount, ask Supabase Auth to create a new (unverified) TOTP
 *      factor; render the QR + secret for the admin to scan.
 *   2. Admin types the 6-digit code; we challenge + verify.
 *   3. On success: consume the enrollment token (single-use) and
 *      generate 10 recovery codes — shown EXACTLY ONCE on this screen.
 *      The admin must save/print them before navigating away.
 *   4. Admin acknowledges → redirect into /admin.
 *
 * The recovery-codes step is critical: without it, losing the
 * authenticator means manual DB intervention to reset. Showing the
 * codes inline (not just emailing them) keeps the flow self-contained
 * and avoids depending on the email provider.
 *
 * If the user navigates away mid-enroll, Supabase leaves an unverified
 * factor row (`status='unverified'`); the verify flow ignores those.
 * The token is NOT consumed until step 3 succeeds, so a re-entry with
 * the same token URL works.
 */
export default function EnrollMFAForm({ enrollmentToken }: Props) {
  const router = useRouter();
  const [state, setState] = useState<EnrollState>({ phase: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [acknowledged, setAcknowledged] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Admin TOTP (${new Date().toLocaleDateString("el-GR")})`,
      });
      if (error || !data) {
        setState({
          phase: "error",
          message: error?.message ?? "Δεν ξεκίνησε η εγγραφή MFA.",
        });
        return;
      }
      setState({
        phase: "ready",
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });
    })();
  }, []);

  function verify() {
    if (state.phase !== "ready") return;
    const cleaned = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(cleaned)) {
      setError("Δώστε τον 6-ψήφιο κωδικό από την εφαρμογή.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const supabase = createClient();

      // Step 1 — challenge + verify TOTP.
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
        factorId: state.factorId,
      });
      if (chErr || !challenge) {
        setError(chErr?.message ?? "Αποτυχία επικοινωνίας MFA.");
        return;
      }
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: state.factorId,
        challengeId: challenge.id,
        code: cleaned,
      });
      if (vErr) {
        setError(vErr.message ?? "Λάθος κωδικός. Δοκιμάστε ξανά.");
        return;
      }

      // Step 2 — consume the enrollment token so it can't be reused.
      const consumed = await consumeEnrollmentToken({ token: enrollmentToken });
      if (!consumed.success) {
        // The factor is verified but token consumption failed. Surface
        // the error; the user is now at AAL2 and we can let them through
        // even without consuming. But signal the inconsistency.
        console.error("[mfa-enroll] token consume failed:", consumed.error);
      }

      // Step 3 — generate recovery codes (server requires verified factor).
      const codesRes = await generateRecoveryCodes({});
      if (!codesRes.success) {
        setError(
          `Επιτυχής επαλήθευση, αλλά αποτυχία στη δημιουργία recovery codes: ${codesRes.error}. Επικοινωνήστε με τον διαχειριστή.`
        );
        return;
      }

      setState({ phase: "showing-codes", codes: codesRes.data.codes });
    });
  }

  function handleContinue() {
    router.replace("/admin");
    router.refresh();
  }

  if (state.phase === "loading") {
    return <p className="text-sm text-muted-foreground">Φόρτωση...</p>;
  }
  if (state.phase === "error") {
    return <p className="text-sm text-destructive">{state.message}</p>;
  }

  if (state.phase === "showing-codes") {
    return (
      <div className="space-y-4 text-sm">
        <div className="rounded border border-emerald-500 bg-emerald-50 px-4 py-3 text-emerald-900">
          <p className="font-medium">✓ Η εγγραφή MFA ολοκληρώθηκε επιτυχώς.</p>
        </div>

        <div className="rounded border border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-2">
          <p className="font-medium">⚠ Κωδικοί ανάκτησης — αποθηκεύστε τους ΤΩΡΑ.</p>
          <p>
            Οι παρακάτω κωδικοί εμφανίζονται μία και μοναδική φορά. Εκτυπώστε
            τους ή αποθηκεύστε τους σε password manager. Αν χάσετε τη συσκευή
            σας, χρησιμοποιήστε έναν από αυτούς στη σελίδα επαλήθευσης για να
            επανεγγραφείτε.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 bg-muted p-3 rounded font-mono text-sm">
          {state.codes.map((c) => (
            <div key={c} className="px-2 py-1 bg-background rounded text-center">
              {c}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const blob = new Blob(
                [
                  "Recovery codes — kids eshop admin MFA\n",
                  `Generated: ${new Date().toLocaleString("el-GR")}\n`,
                  "Each code is single-use. Use one if you lose your authenticator.\n\n",
                  ...state.codes.map((c) => `  ${c}\n`),
                ],
                { type: "text/plain" }
              );
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `mfa-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="rounded border px-3 py-1.5 text-sm"
          >
            ⬇ Λήψη ως .txt
          </button>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(state.codes.join("\n"));
            }}
            className="rounded border px-3 py-1.5 text-sm"
          >
            📋 Αντιγραφή
          </button>
        </div>

        <label className="flex items-start gap-2 pt-2 border-t">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm">
            Έχω αποθηκεύσει τους κωδικούς ανάκτησης σε ασφαλές μέρος. Κατανοώ ότι
            δεν θα εμφανιστούν ξανά.
          </span>
        </label>

        <button
          type="button"
          onClick={handleContinue}
          disabled={!acknowledged}
          className="w-full rounded bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50"
        >
          Συνέχεια στο admin
        </button>
      </div>
    );
  }

  // state.phase === "ready" — QR + verify form.
  return (
    <div className="space-y-4 text-sm">
      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
        <li>Ανοίξτε την εφαρμογή Authenticator (Google Authenticator, Authy, 1Password, κ.λπ.).</li>
        <li>Σαρώστε τον παρακάτω κώδικα QR ή πληκτρολογήστε το secret χειροκίνητα.</li>
        <li>Πληκτρολογήστε τον 6-ψήφιο κωδικό που εμφανίζεται.</li>
      </ol>

      <div className="flex items-start gap-4">
        <img
          src={state.qrCode}
          alt="MFA QR code"
          className="w-44 h-44 border rounded bg-white p-2"
        />
        <div className="text-xs">
          <p className="text-muted-foreground mb-1">Χειροκίνητη εισαγωγή secret:</p>
          <code className="font-mono break-all bg-muted px-2 py-1 rounded inline-block">
            {state.secret}
          </code>
          <p className="text-muted-foreground mt-2">
            Τύπος: TOTP · Ψηφία: 6 · Περίοδος: 30s
          </p>
        </div>
      </div>

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
          disabled={isPending}
          className="rounded bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50"
        >
          {isPending ? "Επαλήθευση..." : "Επαλήθευση και ενεργοποίηση"}
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
