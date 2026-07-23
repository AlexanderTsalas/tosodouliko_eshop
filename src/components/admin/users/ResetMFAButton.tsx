"use client";

import { useState, useTransition } from "react";
import { mintEnrollmentToken } from "@/actions/mfa/mintEnrollmentToken";

interface Props {
  userId: string;
  userEmail: string;
  /** When false (no verified factor yet), copy reads as first-issue rather
   *  than re-issue — the same action serves both. */
  hasVerifiedFactor?: boolean;
}

/**
 * Admin action: mint a fresh MFA enrollment token for the target user
 * and display the plaintext in a modal so the admin can copy + deliver
 * it out-of-band. Used when:
 *
 *   - A new admin couldn't enroll within the token's TTL and needs a new one
 *   - An existing admin lost their authenticator AND their recovery codes
 *   - An admin is being provisioned for the first time (alternative to
 *     the createUser-inline token)
 *
 * The token is shown exactly once. Closing the modal discards it.
 *
 * Permission: requires `manage:users` (enforced server-side).
 */
export default function ResetMFAButton({
  userId,
  userEmail,
  hasVerifiedFactor = false,
}: Props) {
  const [armed, setArmed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function mint() {
    setError(null);
    startTransition(async () => {
      const r = await mintEnrollmentToken({ userId, ttlHours: 24 });
      if (!r.success) {
        setError(r.error);
        setArmed(false);
        return;
      }
      setToken(r.data.token);
      setExpiresAt(r.data.expiresAt);
    });
  }

  if (token) {
    const enrollUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/admin/mfa-enroll?token=${encodeURIComponent(token)}`;
    return (
      <div className="border-2 border-primary rounded p-4 bg-card space-y-3 text-sm">
        <header>
          <h3 className="font-medium">Νέο MFA enrollment token για {userEmail}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Παραδώστε το σύνδεσμο ή το token στον χρήστη εκτός ηλεκτρονικής
            πλατφόρμας. Εμφανίζεται μία φορά.
          </p>
        </header>

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Σύνδεσμος (1-click):</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs bg-muted px-2 py-1 rounded break-all">
              {enrollUrl}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(enrollUrl)}
              className="text-xs rounded border px-2 py-1"
            >
              📋
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Σκέτο token:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs bg-muted px-2 py-1 rounded break-all">
              {token}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(token)}
              className="text-xs rounded border px-2 py-1"
            >
              📋
            </button>
          </div>
        </div>

        {expiresAt && (
          <p className="text-[11px] text-muted-foreground">
            Λήγει: {new Date(expiresAt).toLocaleString("el-GR")}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            setToken(null);
            setExpiresAt(null);
            setArmed(false);
          }}
          className="text-xs underline"
        >
          Κλείσιμο (το token θα διαγραφεί από την οθόνη)
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!armed ? (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="text-sm rounded border px-3 py-1.5"
        >
          {hasVerifiedFactor ? "Επανέκδοση MFA token..." : "Έκδοση MFA token..."}
        </button>
      ) : (
        <div className="rounded border border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-2">
          <p className="font-medium">
            {hasVerifiedFactor
              ? `Επανέκδοση MFA token για ${userEmail};`
              : `Έκδοση MFA token για ${userEmail};`}
          </p>
          <p className="text-xs">
            {hasVerifiedFactor
              ? "Τυχόν υπάρχον token θα ακυρωθεί. Ο χρήστης έχει ήδη ενεργό MFA — ο νέος κωδικός δεν επηρεάζει την τρέχουσα σύνδεση· χρειάζεται μόνο αν έχασε τη συσκευή του."
              : "Δημιουργεί τον κωδικό ενεργοποίησης που χρειάζεται ο χρήστης για να ρυθμίσει MFA για πρώτη φορά. Τυχόν προηγούμενο μη χρησιμοποιημένο token ακυρώνεται."}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={mint}
              disabled={isPending}
              className="rounded bg-primary text-primary-foreground px-3 py-1 text-xs"
            >
              {isPending ? "Δημιουργία..." : "Δημιουργία token"}
            </button>
            <button
              type="button"
              onClick={() => setArmed(false)}
              disabled={isPending}
              className="btn btn-secondary btn-sm"
            >
              Άκυρο
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
