"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteInternalUser } from "@/actions/users";
import type { Role } from "@/types/rbac";

interface Props {
  allRoles: Role[];
}

interface InviteOutcome {
  userId: string;
  setPasswordUrl: string;
  emailDelivered: boolean;
  enrollmentToken?: string;
  enrollmentTokenExpiresAt?: string;
}

/**
 * Invite a new internal (back-office) user. On success the account exists with
 * NO password; the user sets their own via the emailed invite link. Two
 * secrets are surfaced to the inviting admin:
 *   - the set-password link (also emailed — shown here as a copy fallback for
 *     when no email provider is configured), and
 *   - the one-time MFA enrollment token, which the admin delivers OUT-OF-BAND
 *     on a separate channel.
 */
export default function CreateUserForm({ allRoles }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);

    const roleIds = allRoles
      .filter((r) => formData.get(`role_${r.id}`) === "on")
      .map((r) => r.id);

    startTransition(async () => {
      const r = await inviteInternalUser({
        email: String(formData.get("email") ?? ""),
        firstName: String(formData.get("firstName") ?? ""),
        lastName: String(formData.get("lastName") ?? ""),
        marketingOptIn: formData.get("marketingOptIn") === "on",
        roleIds,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setOutcome({
        userId: r.data.userId,
        setPasswordUrl: r.data.setPasswordUrl,
        emailDelivered: r.data.emailDelivered,
        enrollmentToken: r.data.enrollmentToken,
        enrollmentTokenExpiresAt: r.data.enrollmentTokenExpiresAt,
      });
    });
  }

  if (outcome) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const enrollUrl = outcome.enrollmentToken
      ? `${origin}/admin/mfa-enroll?token=${encodeURIComponent(outcome.enrollmentToken)}`
      : null;
    return (
      <div className="max-w-2xl space-y-4">
        <div className="rounded border border-emerald-500 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <p className="font-medium">✓ Η πρόσκληση δημιουργήθηκε.</p>
          <p className="text-xs mt-1">
            {outcome.emailDelivered
              ? "Το email πρόσκλησης στάλθηκε. Ο χρήστης ορίζει τον δικό του κωδικό μέσω του συνδέσμου."
              : "⚠ Δεν έχει ρυθμιστεί πάροχος email — αντιγράψτε και στείλτε τον σύνδεσμο ορισμού κωδικού χειροκίνητα."}
          </p>
        </div>

        {/* Channel 1 — set-password link (emailed; copy is a fallback). */}
        <div className="rounded border px-4 py-3 space-y-2 text-sm">
          <p className="text-xs font-medium mb-1">
            Σύνδεσμος ορισμού κωδικού {outcome.emailDelivered ? "(εφεδρικό)" : "(στείλτε το)"}:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs bg-muted px-2 py-1 rounded break-all">
              {outcome.setPasswordUrl}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(outcome.setPasswordUrl)}
              className="text-xs rounded border px-2 py-1"
            >
              📋
            </button>
          </div>
        </div>

        {/* Channel 2 — MFA enrollment token, delivered OUT-OF-BAND. */}
        {enrollUrl ? (
          <div className="rounded border border-amber-500 bg-amber-50 px-4 py-3 space-y-3 text-sm text-amber-900">
            <p className="font-medium">
              ⚠ Κωδικός ενεργοποίησης MFA — παραδώστε ΧΩΡΙΣΤΑ (όχι μέσω email)
            </p>
            <p className="text-xs">
              Αφού ο χρήστης ορίσει κωδικό, χρειάζεται αυτόν τον σύνδεσμο για να
              ολοκληρώσει την εγγραφή MFA. Εμφανίζεται μία και μοναδική φορά.
            </p>
            <div>
              <p className="text-xs font-medium mb-1">Σύνδεσμος MFA (1-click):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-xs bg-white px-2 py-1 rounded break-all">
                  {enrollUrl}
                </code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(enrollUrl)}
                  className="text-xs rounded border px-2 py-1 bg-white"
                >
                  📋
                </button>
              </div>
            </div>
            {outcome.enrollmentTokenExpiresAt && (
              <p className="text-[11px]">
                Λήγει:{" "}
                {new Date(outcome.enrollmentTokenExpiresAt).toLocaleString("el-GR")}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
            ⚠ Δεν εκδόθηκε κωδικός MFA (ελέγξτε το MFA_TOKEN_PEPPER). Εκδώστε τον
            από τη σελίδα του χρήστη πριν ολοκληρώσει την εγγραφή.
          </div>
        )}

        <button
          type="button"
          onClick={() => router.push(`/admin/users/${outcome.userId}`)}
          className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm"
        >
          Συνέχεια στον χρήστη
        </button>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="grid grid-cols-2 gap-4 max-w-2xl">
      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-sm font-medium">Email *</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="off"
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Όνομα *</span>
        <input name="firstName" required className="border rounded px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Επώνυμο *</span>
        <input name="lastName" required className="border rounded px-3 py-2" />
      </label>

      <fieldset className="col-span-2 border rounded p-3">
        <legend className="text-sm font-medium px-2">Ρόλοι</legend>
        <p className="text-xs text-muted-foreground mb-2">
          Ο ρόλος <code>customer</code> ανατίθεται αυτόματα. Επιλέξτε ρόλους back-office όπως χρειάζεται.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {allRoles
            .filter((r) => r.name !== "customer")
            .map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`role_${r.id}`} />
                <span className="font-mono">{r.name}</span>
              </label>
            ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-2 col-span-2">
        <input type="checkbox" name="marketingOptIn" />
        <span className="text-sm">Συγκατάθεση marketing</span>
      </label>

      {error && (
        <p role="alert" className="col-span-2 text-sm text-destructive">{error}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="col-span-2 rounded bg-primary text-primary-foreground py-2 disabled:opacity-50"
      >
        {isPending ? "Αποστολή..." : "Αποστολή πρόσκλησης"}
      </button>
    </form>
  );
}
