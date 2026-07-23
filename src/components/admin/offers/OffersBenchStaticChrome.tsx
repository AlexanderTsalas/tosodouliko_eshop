import "server-only";
import {
  Search,
  Plus,
  BadgePercent,
  Wand2,
  Ticket,
} from "lucide-react";

/**
 * Non-interactive static chrome for the offers workshop bench. Used as
 * the Suspense fallback for the data-bearing <OffersBenchData /> AND
 * by the route's loading.tsx so the navigation gap and the data gap
 * show the same chrome.
 *
 * Design intent: this component renders the EXACT visual structure
 * the live bench will render once data arrives — same toolbar, same
 * three columns with their titles, helper text, icons, and "+ New"
 * dashed cards — using the IDENTICAL Tailwind classes as the live
 * components. The only difference between this chrome and the live
 * bench is the `disabled` attribute on interactive controls; visually
 * they're indistinguishable. When data resolves, the live bench
 * replaces this chrome in place with zero visual jump — only the
 * `disabled` attributes lift and the card placeholders fill in.
 */
export default function OffersBenchStaticChrome() {
  return (
    <div className="space-y-6">
      {/* ─── Toolbar — class-for-class match with OffersLabBench's toolbar ─── */}
      <div className="flex flex-wrap items-center gap-3 sticky top-0 z-10 bg-background py-2 -mx-2 px-2 border-b border-border">
        {/* Search input — same classes, `disabled` is the only difference */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            disabled
            placeholder="Αναζήτηση σε προσφορές, κανόνες, κωδικούς…"
            className="cms-input pl-8"
          />
        </div>

        {/* Filter chips — same classes; "Όλα" gets the active style to
            match the live bench's initial state, so the swap doesn't
            visually re-select. */}
        <div className="flex gap-0.5 border border-border rounded-md p-0.5 text-sm">
          <StaticFilterChip active>Όλα</StaticFilterChip>
          <StaticFilterChip>Ενεργά</StaticFilterChip>
          <StaticFilterChip>Ανενεργά</StaticFilterChip>
        </div>
      </div>

      {/* ─── 3-column workshop grid — same shape as live bench ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 lg:divide-x-2 divide-foreground/15 min-h-[calc(100vh-220px)]">
        <StaticColumn
          title="Προσφορές"
          icon={BadgePercent}
          accent="emerald"
          helperText="Ομάδες κανόνων — ενεργοποιούνται/απενεργοποιούνται μαζί."
          newCardLabel="Νέα προσφορά"
        />
        <StaticColumn
          title="Αυτοτελείς κανόνες"
          icon={Wand2}
          accent="sky"
          helperText="Κανόνες χωρίς γονική προσφορά — εφαρμόζονται μόνοι τους."
          newCardLabel="Νέος κανόνας"
        />
        <StaticColumn
          title="Κωδικοί"
          icon={Ticket}
          accent="purple"
          helperText="Συνδέονται με κανόνες ή προσφορές για κατά παραγγελία ενεργοποίηση."
          newCardLabel="Νέος κωδικός"
        />
      </div>
    </div>
  );
}

/**
 * Class-for-class mirror of FilterChip in OffersLabBench. The ONLY
 * difference is `disabled` on the button. The CSS (including the
 * hover state on inactive chips) is identical so the DOM produced
 * here matches what the live bench will produce on first paint.
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
      className={`px-2.5 py-1 rounded-sm transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Class-for-class mirror of Column + header in OffersLabBench, with
 * the live DashedAddButton's "+ New X" button inline. The icon badge,
 * title, helper text, and dashed-add button render identically to the
 * live bench. The count placeholder is positioned where the real
 * count will appear so the title doesn't shift when data lands; it
 * holds zero visible content via `opacity-0`.
 */
function StaticColumn({
  title,
  icon: Icon,
  accent,
  helperText,
  newCardLabel,
}: {
  title: string;
  icon: typeof BadgePercent;
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
          {/* Count placeholder — holds the layout slot but is invisible.
              When the live bench paints with the real count, no shift. */}
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

        {/* Card-shaped placeholders for the data the live bench will
            fill in. These are the only elements that visually signal
            "loading" — everything above them is the actual page
            chrome rendered with its real CSS. `skeleton-reveal`
            (globals.css) keeps these invisible for 150ms so fast
            loads finish before the skeleton appears at all. */}
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
