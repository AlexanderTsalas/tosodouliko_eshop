import "server-only";
import {
  Search,
  Plus,
  ClipboardList,
  Package,
  Link2,
} from "lucide-react";

/**
 * Non-interactive static chrome for the custom-fields library bench.
 *
 * Same structure as the offers bench's static chrome (toolbar + 3
 * columns), with custom-fields-specific labels, icons, and accents.
 * Used by both this page's Suspense fallback and its loading.tsx so
 * the navigation gap and the data gap show identical structure.
 *
 * Every CSS class matches the live CustomFieldsLibraryBench (search
 * input, FilterChip, Column header, DashedAddButton). The only
 * differences between this chrome and the live bench are the
 * `disabled` attributes on interactive controls and the card
 * placeholders inside the columns; visually they're indistinguishable
 * at first paint.
 */
export default function CustomFieldsBenchStaticChrome() {
  return (
    <div className="space-y-4">
      {/* ─── Toolbar — class-for-class match with the live bench ─── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            disabled
            placeholder="Αναζήτηση σε πεδία, ομάδες, συνδέσεις…"
            className="cms-input pl-8"
          />
        </div>
        <div className="flex items-center gap-1 text-sm">
          <StaticFilterChip active>Όλα</StaticFilterChip>
          <StaticFilterChip>Ενεργά</StaticFilterChip>
          <StaticFilterChip>Ανενεργά</StaticFilterChip>
        </div>
      </div>

      {/* ─── 3-column workshop grid — same shape as live bench ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 lg:divide-x-2 divide-foreground/15 min-h-[calc(100vh-220px)]">
        <StaticColumn
          title="Πεδία"
          icon={ClipboardList}
          accent="sky"
          helperText="Επιμέρους πεδία πελάτη — επαναχρησιμοποιούνται σε όσα scope θέλετε."
          newCardLabel="Νέο πεδίο"
        />
        <StaticColumn
          title="Ομάδες"
          icon={Package}
          accent="emerald"
          helperText="Επαναχρησιμοποιήσιμα πακέτα πεδίων — εφαρμόστε όλα μαζί σε ένα scope."
          newCardLabel="Νέα ομάδα"
        />
        <StaticColumn
          title="Συνδέσεις"
          icon={Link2}
          accent="purple"
          helperText="Πού εφαρμόζεται κάθε πεδίο ή ομάδα: κατηγορία, προϊόν, ή παραλλαγή."
          newCardLabel="Νέα σύνδεση"
        />
      </div>
    </div>
  );
}

/**
 * Class-for-class mirror of FilterChip in CustomFieldsLibraryBench.
 * Note: this bench's FilterChip differs from the offers bench's —
 * different padding (`rounded-md` not `rounded-sm`), and the
 * inactive state has an extra `hover:bg-muted` class.
 */
function StaticFilterChip({
  active = false,
  children,
}: {
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled
      className={`px-2.5 py-1 rounded-md text-sm transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Class-for-class mirror of Column + header in the live bench.
 */
function StaticColumn({
  title,
  icon: Icon,
  accent,
  helperText,
  newCardLabel,
}: {
  title: string;
  icon: typeof ClipboardList;
  accent: "emerald" | "sky" | "purple";
  helperText: string;
  newCardLabel: string;
}) {
  const badge = {
    emerald: "bg-emerald-100 text-emerald-700 border-emerald-200",
    sky: "bg-sky-100 text-sky-700 border-sky-200",
    purple: "bg-purple-100 text-purple-700 border-purple-200",
  }[accent];

  return (
    <section className="px-4 first:pl-0 last:pr-0">
      <header className="pb-4 mb-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <span
            className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border ${badge}`}
            aria-hidden
          >
            <Icon className="w-5 h-5" />
          </span>
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          {/* Count placeholder — holds the layout slot but invisible. */}
          <span
            aria-hidden
            className="text-sm font-medium text-foreground/60 tabular-nums ml-auto opacity-0"
          >
            0
          </span>
        </div>
        <p className="text-sm text-foreground/70 mt-2 leading-snug">
          {helperText}
        </p>
      </header>

      {/* Card stack — matches `space-y-3` from CardStack */}
      <div className="space-y-3">
        {/* "+ New X" — class-for-class match with DashedAddButton */}
        <button
          type="button"
          disabled
          className="w-full min-h-[44px] rounded-lg border-2 border-dashed border-foreground/20 flex items-center justify-center gap-1.5 hover:border-foreground/40 hover:bg-muted/30 transition-colors cursor-pointer px-3 py-2 text-muted-foreground hover:text-foreground"
        >
          <Plus className="w-4 h-4" />
          <span className="text-sm font-medium">{newCardLabel}</span>
        </button>

        {/* Card-shaped placeholders for the data the live bench fills
            in. `skeleton-reveal` (globals.css) keeps these invisible
            for 150ms so fast loads finish before the skeleton appears. */}
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 border border-border rounded-md bg-muted/20 animate-pulse skeleton-reveal"
          />
        ))}
      </div>
    </section>
  );
}
