"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendTestEmail } from "@/actions/email-settings/sendTestEmail";
import { setActiveProvider } from "@/actions/email-settings/setActiveProvider";
import { deleteEmailProvider } from "@/actions/email-settings/deleteEmailProvider";
import type { EmailProviderConfig } from "@/types/email";

interface Props {
  provider: EmailProviderConfig;
  /** Email to use when the admin clicks "Test send" — defaults to the from_address. */
  testEmailDefault: string;
}

export default function EmailProviderRowActions({ provider, testEmailDefault }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState(testEmailDefault);
  const [showTestInput, setShowTestInput] = useState(false);

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  function runTest() {
    clearMessages();
    if (!testEmail.trim()) {
      setError("Δώστε email για το test.");
      return;
    }
    startTransition(async () => {
      const r = await sendTestEmail({
        provider_id: provider.id,
        to: testEmail.trim(),
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setSuccess(`✓ Στάλθηκε. Provider ID: ${r.data.provider_message_id}`);
      setShowTestInput(false);
      router.refresh();
    });
  }

  function activate() {
    clearMessages();
    if (!confirm(`Ενεργοποίηση παρόχου "${provider.display_name}";`)) return;
    startTransition(async () => {
      const r = await setActiveProvider({ provider_id: provider.id });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function remove() {
    clearMessages();
    if (
      !confirm(
        `Οριστική διαγραφή του "${provider.display_name}";\n\n` +
          "Θα διαγραφούν και τα κρυπτογραφημένα credentials."
      )
    )
      return;
    startTransition(async () => {
      const r = await deleteEmailProvider({ provider_id: provider.id });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {!provider.is_active && (
          <button
            type="button"
            onClick={activate}
            disabled={isPending || !provider.secrets_encrypted}
            title={
              !provider.secrets_encrypted
                ? "Αποθηκεύστε password / API key πρώτα"
                : "Καθιστά αυτόν τον πάροχο τον μοναδικό ενεργό"
            }
            className="rounded border border-emerald-600 text-emerald-700 px-3 py-1 text-xs disabled:opacity-40"
          >
            Ενεργοποίηση
          </button>
        )}

        {showTestInput ? (
          <div className="flex items-center gap-1 text-xs">
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              className="border rounded px-2 py-1 w-56"
              placeholder="δοκιμαστικό email"
            />
            <button
              type="button"
              onClick={runTest}
              disabled={isPending}
              className="rounded bg-primary text-primary-foreground px-2 py-1"
            >
              {isPending ? "..." : "Αποστολή"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowTestInput(false);
                clearMessages();
              }}
              className="btn btn-secondary btn-sm"
            >
              Άκυρο
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              clearMessages();
              setShowTestInput(true);
            }}
            disabled={isPending || !provider.secrets_encrypted}
            title={
              !provider.secrets_encrypted ? "Αποθηκεύστε password / API key πρώτα" : ""
            }
            className="rounded border px-3 py-1 text-xs disabled:opacity-40"
          >
            Test send
          </button>
        )}

        <button
          type="button"
          onClick={remove}
          disabled={isPending || provider.is_active}
          title={
            provider.is_active
              ? "Δεν διαγράφεται ο ενεργός πάροχος. Ενεργοποιήστε άλλον πρώτα."
              : ""
          }
          className="rounded border border-destructive text-destructive px-3 py-1 text-xs disabled:opacity-40"
        >
          Διαγραφή
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {success && <p className="text-xs text-emerald-700">{success}</p>}
    </div>
  );
}
