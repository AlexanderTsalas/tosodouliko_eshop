"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertEmailProvider } from "@/actions/email-settings/upsertEmailProvider";
import { brand } from "@/config/brand";
import type { EmailProviderConfig, ResendConfig, SmtpConfig } from "@/types/email";

interface Props {
  /** Existing row to edit; omit to create a new one. */
  initial?: EmailProviderConfig;
  onSaved?: () => void;
}

/**
 * Create / edit form for an email provider. Two shapes depending on `kind`:
 * SMTP shows host/port/secure/username/password, Resend shows API key only.
 * Editing an existing row leaves the password / API key blank by default —
 * typing into the field rotates the stored ciphertext; leaving it blank
 * keeps the existing secret untouched.
 */
export default function EmailProviderForm({ initial, onSaved }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<"smtp" | "resend">(initial?.kind ?? "smtp");
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [fromAddress, setFromAddress] = useState(initial?.from_address ?? "");
  const [replyTo, setReplyTo] = useState(initial?.reply_to ?? "");

  // SMTP fields
  const initialSmtp = (initial?.kind === "smtp" ? (initial.config as SmtpConfig) : null) ?? null;
  const [host, setHost] = useState(initialSmtp?.host ?? "smtp.gmail.com");
  const [port, setPort] = useState(String(initialSmtp?.port ?? 587));
  const [secure, setSecure] = useState(initialSmtp?.secure ?? false);
  const [username, setUsername] = useState(initialSmtp?.username ?? "");

  // Resend fields
  const initialResend = (initial?.kind === "resend" ? (initial.config as ResendConfig) : null) ?? null;
  const [resendDomain, setResendDomain] = useState(initialResend?.domain ?? "");

  // Secret (SMTP password OR Resend API key). Blank on edit = keep existing.
  const [secret, setSecret] = useState("");

  const isEdit = !!initial;
  const hasStoredSecret = !!initial?.secrets_encrypted;

  function submit() {
    setError(null);
    if (!displayName.trim()) {
      setError("Δώστε ένα όνομα για να αναγνωρίζετε αυτόν τον πάροχο.");
      return;
    }
    if (!fromAddress.trim()) {
      setError("Συμπληρώστε το from address.");
      return;
    }
    if (!isEdit && !secret.trim()) {
      setError("Για νέο πάροχο, το password / API key είναι υποχρεωτικό.");
      return;
    }

    const config =
      kind === "smtp"
        ? {
            host: host.trim(),
            port: Number(port) || 587,
            secure,
            username: username.trim(),
          }
        : { domain: resendDomain.trim() || undefined };

    startTransition(async () => {
      const r = await upsertEmailProvider({
        id: initial?.id,
        kind,
        display_name: displayName.trim(),
        from_address: fromAddress.trim(),
        reply_to: replyTo.trim() || null,
        config,
        secret: secret.trim() || undefined,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      onSaved?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <label>
          <span className="block text-sm font-medium mb-1.5">Τύπος παρόχου</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "smtp" | "resend")}
            disabled={isEdit}
            className="cms-input disabled:opacity-60"
            title={isEdit ? "Δεν αλλάζει σε υπάρχοντα πάροχο" : ""}
          >
            <option value="smtp">SMTP (Gmail, custom server)</option>
            <option value="resend">Resend (transactional API)</option>
          </select>
        </label>

        <label>
          <span className="block text-sm font-medium mb-1.5">Όνομα διαχείρισης</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={`π.χ. "Gmail SMTP — orders@${brand.email.exampleDomain}"`}
            className="cms-input"
          />
        </label>

        <label>
          <span className="block text-sm font-medium mb-1.5">From address</span>
          <input
            type="email"
            value={fromAddress}
            onChange={(e) => setFromAddress(e.target.value)}
            placeholder={`orders@${brand.email.exampleDomain}`}
            className="cms-input"
          />
        </label>

        <label>
          <span className="block text-sm font-medium mb-1.5">
            Reply-to (προαιρετικό)
          </span>
          <input
            type="email"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            placeholder={`support@${brand.email.exampleDomain}`}
            className="cms-input"
          />
        </label>
      </div>

      {kind === "smtp" ? (
        <fieldset className="rounded-md border border-foreground/15 bg-muted/20 p-4 space-y-3">
          <legend className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-2 -ml-2">SMTP server</legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <label>
              <span className="block text-sm font-medium mb-1.5">Host</span>
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="cms-input font-mono"
              />
            </label>
            <label>
              <span className="block text-sm font-medium mb-1.5">Port</span>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="cms-input font-mono"
              />
            </label>
            <label>
              <span className="block text-sm font-medium mb-1.5">Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={`orders@${brand.email.exampleDomain}`}
                className="cms-input"
              />
            </label>
            <label className="md:col-span-2 flex items-start gap-3 rounded-md border border-foreground/15 bg-background px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
              <input
                type="checkbox"
                checked={secure}
                onChange={(e) => setSecure(e.target.checked)}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium">TLS on connect (port 465)</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Άφησέ το ξεσαρωμένο για STARTTLS (port 587).
                </p>
              </div>
            </label>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            <strong>Gmail tip:</strong> ενεργοποιήστε 2FA στον λογαριασμό και δημιουργήστε έναν App Password
            από{" "}
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              myaccount.google.com/apppasswords
            </a>
            . Χρησιμοποιήστε αυτόν τον 16-ψήφιο κωδικό ως password (όχι τον κανονικό κωδικό σας).
            Host: <code className="font-mono">smtp.gmail.com</code>, Port: <code className="font-mono">587</code>,
            TLS-on-connect: <em>off</em>.
          </p>
        </fieldset>
      ) : (
        <fieldset className="rounded-md border border-foreground/15 bg-muted/20 p-4 space-y-3">
          <legend className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-2 -ml-2">Resend</legend>
          <label className="block text-sm">
            <span className="block text-sm font-medium mb-1.5">
              Domain (προαιρετικό · μόνο για επιβεβαίωση)
            </span>
            <input
              value={resendDomain}
              onChange={(e) => setResendDomain(e.target.value)}
              placeholder={brand.email.exampleDomain}
              className="cms-input font-mono"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Δημιουργήστε έναν API key στη Resend dashboard ({" "}
            <a
              href="https://resend.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              resend.com/api-keys
            </a>
            ) και επικυρώστε το domain σας από{" "}
            <a
              href="https://resend.com/domains"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              resend.com/domains
            </a>
            .
          </p>
        </fieldset>
      )}

      <label className="block text-sm">
        <span className="block text-sm font-medium mb-1.5">
          {kind === "smtp" ? "Password (App Password για Gmail)" : "API key"}
        </span>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={
            hasStoredSecret
              ? "Κρατήστε το άδειο για να μη το αλλάξετε"
              : kind === "smtp"
                ? "Το App Password σας"
                : "re_xxxxxxxxxxxxxxxxxxx"
          }
          className="cms-input font-mono"
          autoComplete="new-password"
        />
        {hasStoredSecret && (
          <p className="text-xs text-muted-foreground mt-1">
            Υπάρχει ήδη αποθηκευμένος κωδικός (encrypted). Πληκτρολογήστε εδώ μόνο αν θέλετε να τον
            αντικαταστήσετε.
          </p>
        )}
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-center gap-2 pt-4 border-t border-foreground/10">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="btn btn-primary btn-md"
        >
          {isPending ? "Αποθήκευση..." : isEdit ? "Αποθήκευση αλλαγών" : "Δημιουργία παρόχου"}
        </button>
      </div>
    </div>
  );
}
