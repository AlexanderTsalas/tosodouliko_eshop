"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import CenteredModal from "@/components/admin/common/CenteredModal";

/**
 * Inline bulk-propagation confirmation.
 *
 * When an admin inline-edits a field on a row that's part of a multi-row
 * selection, the editing cell calls `confirmPropagate` to surface a modal
 * showing how many products the change will hit. Confirm → apply to all
 * selected; "only this one" → the caller falls back to its single-row
 * save. Centralised here so all four inline cells share one modal.
 */

type ApplyResult = { success: boolean; error?: string };

interface ConfirmOptions {
  /** How many products the propagation would affect. */
  count: number;
  /** Human description of the change, e.g. 'τιμή σε 5,00 €'. */
  message: string;
  /** Runs the bulk write. Resolves with success/error. */
  apply: () => Promise<ApplyResult>;
}

interface PendingRequest extends ConfirmOptions {
  resolve: (applied: boolean) => void;
}

interface BulkPropagationValue {
  /** Returns true if the bulk apply ran (confirmed + succeeded), false if
   *  the admin chose "only this one" (caller should do its single save). */
  confirmPropagate: (opts: ConfirmOptions) => Promise<boolean>;
}

const Ctx = createContext<BulkPropagationValue | null>(null);

export function useBulkPropagation(): BulkPropagationValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useBulkPropagation must be used inside <BulkPropagationProvider>"
    );
  }
  return v;
}

export default function BulkPropagationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmPropagate = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setError(null);
      setBusy(false);
      setPending({ ...opts, resolve });
    });
  }, []);

  async function onConfirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const r = await pending.apply();
    setBusy(false);
    if (!r.success) {
      setError(r.error ?? "Η ομαδική εφαρμογή απέτυχε.");
      return;
    }
    pending.resolve(true);
    setPending(null);
  }

  function onlyThisOne() {
    if (busy || !pending) return;
    pending.resolve(false);
    setPending(null);
  }

  return (
    <Ctx.Provider value={{ confirmPropagate }}>
      {children}
      {pending && (
        <CenteredModal
          title="Ομαδική εφαρμογή"
          subtitle={`${pending.count} επιλεγμένα προϊόντα`}
          z="z-[70]"
          onCancel={onlyThisOne}
          footer={
            <>
              <button
                type="button"
                onClick={onlyThisOne}
                disabled={busy}
                className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Μόνο σε αυτό
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {busy ? "Εφαρμογή…" : `Εφαρμογή σε ${pending.count}`}
              </button>
            </>
          }
        >
          <p className="text-sm text-foreground">
            Εφαρμογή {pending.message} σε{" "}
            <strong>{pending.count}</strong> επιλεγμένα προϊόντα;
          </p>
          <p className="text-xs text-muted-foreground">
            Δεν αναιρείται αυτόματα. «Μόνο σε αυτό» αλλάζει μόνο τη γραμμή που
            επεξεργαστήκατε.
          </p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </CenteredModal>
      )}
    </Ctx.Provider>
  );
}
