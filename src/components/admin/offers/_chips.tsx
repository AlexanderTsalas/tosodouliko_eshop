import { Plus } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shared chip primitives used by both RuleSentence and OfferSentence.
 *
 * Visual language:
 *   - Each chip carries an `accent` (color family) that hints at the
 *     KIND of configuration it represents (action / time / user / scope
 *     / code / muted).
 *   - `interactive=true` adds a hover state — used when the chip is a
 *     popover trigger. Static chips skip the hover state to make the
 *     editable/read-only distinction visually clear.
 */
export type ChipAccent =
  | "default"
  | "discount"
  | "time"
  | "user"
  | "scope"
  | "code"
  | "rule"
  | "muted";

export function Chip({
  children,
  accent = "default",
  interactive = false,
}: {
  children: ReactNode;
  accent?: ChipAccent;
  interactive?: boolean;
}) {
  const base =
    "inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 rounded border text-sm font-medium align-baseline transition-colors";
  const accentClass = {
    default: "bg-background border-foreground/20 text-foreground",
    discount: "bg-emerald-50 border-emerald-200 text-emerald-800",
    time: "bg-blue-50 border-blue-200 text-blue-800",
    user: "bg-violet-50 border-violet-200 text-violet-800",
    scope: "bg-amber-50 border-amber-200 text-amber-800",
    code: "bg-purple-50 border-purple-200 text-purple-800 font-mono",
    rule: "bg-sky-50 border-sky-200 text-sky-800",
    muted: "bg-muted/40 border-border text-muted-foreground italic",
  }[accent];
  const interactiveClass = interactive
    ? "hover:border-foreground/40 hover:shadow-sm cursor-pointer"
    : "";

  return (
    <span className={`${base} ${accentClass} ${interactiveClass}`}>
      {children}
    </span>
  );
}

export function AddChipButton({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 rounded border border-dashed border-foreground/30 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/60 cursor-pointer transition-colors align-baseline">
      <Plus className="w-3 h-3" />
      {label}
    </span>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

export function truncateUuid(id: string | null | undefined): string {
  if (!id) return "—";
  return id.slice(0, 8) + "…";
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const months = [
    "Ιαν",
    "Φεβ",
    "Μαρ",
    "Απρ",
    "Μαΐ",
    "Ιουν",
    "Ιουλ",
    "Αυγ",
    "Σεπ",
    "Οκτ",
    "Νοε",
    "Δεκ",
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}
