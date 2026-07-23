"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { mergeCustomers } from "@/actions/customers/mergeCustomers";
import { Users } from "@/components/admin/common/icons";
import type { Customer } from "@/types/customer";
import type { MatchConfidence } from "@/lib/customers/matchSignals";

/**
 * Surface for "Πιθανά διπλότυπα" on the customer detail page.
 *
 * Candidates are pre-computed server-side (the page passes them in)
 * via the weighted matcher in src/lib/customers/matchSignals.ts. We
 * only render UI here — no client-side matcher invocation.
 *
 * Confidence vocabulary mirrors the matcher:
 *   HIGH   — phone+name combo, email+phone, email+name. Auto-merge
 *            already happened at order-placement time for HIGH offline
 *            matches; HIGH matches surfaced HERE are the leftover
 *            cases (e.g. both customers have auth, or admin disabled
 *            auto-merge in some path).
 *   MEDIUM — phone+address, phone+last_name, email alone. Genuine
 *            judgment call; admin reviews and decides.
 *   LOW    — informational only (phone alone, weak name). Shown so
 *            admin sees the full picture, but never highlighted.
 */
export interface DuplicateSuggestion {
  customer: Customer;
  score: number;
  confidence: MatchConfidence;
  reasons: string[];
  order_count: number;
}

interface Props {
  /** The customer whose page is being viewed — the merge TARGET. */
  currentCustomer: Customer;
  /** Pre-computed candidates from the server. */
  suggestions: DuplicateSuggestion[];
}

const CONFIDENCE_LABELS: Record<MatchConfidence, string> = {
  high: "Υψηλή",
  medium: "Μέτρια",
  low: "Χαμηλή",
};

const CONFIDENCE_BADGE_CLASSES: Record<MatchConfidence, string> = {
  high: "bg-emerald-100 text-emerald-900 border border-emerald-300",
  medium: "bg-amber-100 text-amber-900 border border-amber-300",
  low: "bg-muted text-muted-foreground border border-foreground/15",
};

export default function CustomerDuplicatesSection({
  currentCustomer,
  suggestions,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Filter out dismissed candidates (admin clicked "Δεν είναι ο ίδιος").
  // Dismissals are CLIENT-ONLY for now — refreshing the page brings
  // them back. If you want server-side dismissal persistence, that's
  // a separate `customer_duplicates_dismissed` table; out of scope.
  const visible = suggestions.filter((s) => !dismissed.has(s.customer.id));

  if (suggestions.length === 0) return null;

  function handleMerge(candidate: DuplicateSuggestion) {
    const candidateName =
      [candidate.customer.first_name, candidate.customer.last_name]
        .filter(Boolean)
        .join(" ") ||
      candidate.customer.email ||
      candidate.customer.phone ||
      "(χωρίς όνομα)";
    const ok = window.confirm(
      `Συγχώνευση «${candidateName}» στον τρέχοντα πελάτη;\n\n` +
        `• ${candidate.order_count} ${
          candidate.order_count === 1 ? "παραγγελία" : "παραγγελίες"
        } θα μεταφερθούν.\n` +
        `• Οι διευθύνσεις τους θα μεταφερθούν.\n` +
        `• Η εγγραφή του υποψηφίου θα διαγραφεί.\n\n` +
        `Η ενέργεια δεν αναιρείται.`
    );
    if (!ok) return;
    setError(null);
    setSuccessMessage(null);
    startTransition(async () => {
      const r = await mergeCustomers({
        source_id: candidate.customer.id,
        target_id: currentCustomer.id,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setSuccessMessage(
        `Συγχωνεύτηκε «${candidateName}» — ${r.data.orders_moved} ${
          r.data.orders_moved === 1 ? "παραγγελία" : "παραγγελίες"
        } μετακινήθηκαν.`
      );
      router.refresh();
    });
  }

  return (
    <section className="cms-card-section space-y-4 border-amber-400/40">
      <header className="pb-3 -mt-1 mb-1 border-b border-amber-400/30">
        <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
          <Users className="w-4 h-4" />
          Πιθανά διπλότυπα
          <span className="cms-badge cms-badge-muted text-[10px] normal-case">
            {visible.length} {visible.length === 1 ? "υποψήφιος" : "υποψήφιοι"}
          </span>
        </h2>
        <p className="text-sm text-foreground/70 mt-1.5">
          Άλλες εγγραφές πελάτη με κοινά στοιχεία (τηλέφωνο + όνομα ή email ή
          διεύθυνση). Ελέγξτε αν είναι το ίδιο άτομο και συγχωνεύστε —
          οι παραγγελίες, οι διευθύνσεις και τα στοιχεία τους θα μεταφερθούν
          στον τρέχοντα πελάτη.
        </p>
      </header>

      {successMessage && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
          {successMessage}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive bg-destructive/5 border border-destructive/30 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Όλοι οι υποψήφιοι έχουν απορριφθεί από αυτή την προβολή.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((s) => {
            const c = s.customer;
            const displayName =
              [c.first_name, c.last_name].filter(Boolean).join(" ") ||
              c.email ||
              c.phone ||
              "(χωρίς όνομα)";
            return (
              <li
                key={c.id}
                className="rounded-md border border-foreground/15 bg-background px-4 py-3 flex items-start justify-between gap-3 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="font-medium">{displayName}</p>
                    <span
                      className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 ${CONFIDENCE_BADGE_CLASSES[s.confidence]}`}
                      title={`Πόντοι αντιστοίχισης: ${s.score}`}
                    >
                      {CONFIDENCE_LABELS[s.confidence]}
                    </span>
                    {c.auth_user_id && (
                      <span className="cms-badge cms-badge-neutral text-[10px]">
                        με λογαριασμό
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {c.email && <span>{c.email}</span>}
                    {c.email && c.phone && <span> · </span>}
                    {c.phone && <span className="font-mono">{c.phone}</span>}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Σήματα αντιστοίχισης: {s.reasons.join(" + ") || "—"} ·{" "}
                    {s.order_count}{" "}
                    {s.order_count === 1 ? "παραγγελία" : "παραγγελίες"} ·{" "}
                    <Link
                      href={`/admin/customers/${c.id}`}
                      className="underline hover:text-foreground"
                    >
                      Άνοιγμα καρτέλας →
                    </Link>
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setDismissed((cur) => new Set(cur).add(c.id))
                    }
                    disabled={isPending}
                    className="btn btn-secondary btn-sm"
                  >
                    Δεν είναι ο ίδιος
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMerge(s)}
                    disabled={isPending}
                    className="btn btn-primary btn-sm"
                    title="Μετακίνηση παραγγελιών + διαγραφή υποψηφίου"
                  >
                    {isPending ? "..." : "Συγχώνευση"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
