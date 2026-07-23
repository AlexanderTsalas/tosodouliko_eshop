"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEnsureSession } from "@/hooks/useEnsureSession";

/**
 * Phase 9: rendered by /checkout when the visitor has no auth session.
 *
 * In practice CartDrawer already calls `ensureSession()` before redirecting
 * here, so anonymous users arrive with a session intact. This component is
 * the fallback for the edge cases where they don't — direct URL,
 * bookmarked link, cookie cleared mid-flow.
 *
 * Two paths:
 *   - "Σύνδεση / Δημιουργία λογαριασμού" → redirects to /auth/signin with
 *     ?next=/checkout so the auth flow returns the customer here.
 *   - "Συνέχεια ως επισκέπτης" → creates an anonymous Supabase session via
 *     useEnsureSession, then router.refresh() so the page re-renders with
 *     the new auth cookie. The customer continues into the normal checkout
 *     UI without typing an email.
 */
export default function GuestCheckoutPrompt() {
  const router = useRouter();
  const ensureSession = useEnsureSession();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleGuest() {
    setError(null);
    startTransition(async () => {
      const userId = await ensureSession();
      if (!userId) {
        setError(
          "Δεν ήταν δυνατή η δημιουργία συνεδρίας. Ανανεώστε τη σελίδα και δοκιμάστε ξανά."
        );
        return;
      }
      router.refresh();
    });
  }

  return (
    <main className="container mx-auto px-4 py-12 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-3">Ολοκλήρωση παραγγελίας</h1>
      <p className="text-muted-foreground mb-8">
        Για να συνεχίσετε επιλέξτε πώς θέλετε να ολοκληρώσετε την παραγγελία.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/auth/signin?next=/checkout"
          className="rounded-lg border p-6 text-center hover:bg-muted/30 transition"
        >
          <p className="font-medium mb-2">Σύνδεση / Δημιουργία λογαριασμού</p>
          <p className="text-sm text-muted-foreground">
            Παρακολουθείστε τις παραγγελίες σας και αποθηκεύστε διευθύνσεις.
          </p>
        </Link>

        <button
          type="button"
          onClick={handleGuest}
          disabled={isPending}
          className="rounded-lg border p-6 text-center hover:bg-muted/30 transition disabled:opacity-50"
        >
          <p className="font-medium mb-2">Συνέχεια ως επισκέπτης</p>
          <p className="text-sm text-muted-foreground">
            {isPending
              ? "Συνεχίζουμε..."
              : "Γρήγορη ολοκλήρωση χωρίς εγγραφή. Η λίστα επιθυμιών απαιτεί λογαριασμό."}
          </p>
        </button>
      </div>

      {error && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
