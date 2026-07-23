import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { StaticTableSkeleton } from "@/components/admin/common/static-chrome";

/**
 * Navigation-gap loading state for /admin/inventory.
 *
 * Renders a chrome that matches the live page's structure: header,
 * the static info accordion (collapsed by default to keep the
 * loading frame compact), a filter row placeholder, and a table
 * skeleton with the inventory columns.
 *
 * The full Suspense decomposition (chrome here, table data streaming
 * in separately) is deferred — the inventory page's bulk-selection
 * + draft-toggle state pulls the filter row, action bar, and table
 * into one client subtree that needs careful restructuring. This
 * loading.tsx delivers the navigation-gap win without that refactor.
 */
export default function InventoryLoading() {
  return (
    <>
      <PageHeader
        title="Απόθεμα"
        description="Φιλτράρετε ανά κατάσταση και ενημερώστε ποσότητες ή όρια."
      />

      {/* "How to read this page" info accordion — identical static
          markup to the live page. Renders collapsed by default; the
          static text means there's no reason to wait for data
          before showing it. Class-for-class match with the live
          render so the swap is invisible. */}
      <details className="cms-accordion-details mb-4 rounded-lg border border-foreground/10 bg-muted/20 p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Πώς διαβάζω αυτή τη σελίδα; — εξήγηση των στηλών αποθέματος
        </summary>
        <div className="cms-accordion-body">
          <div className="mt-3 space-y-2 text-muted-foreground">
            <p>
              Η εφαρμογή χωρίζει το απόθεμα σε τέσσερα «κουτιά» για να
              παρακολουθεί τα ενεργά καλάθια και τις παραγγελίες:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong className="text-foreground">Διαθέσιμα</strong> —
                τεμάχια ελεύθερα προς πώληση αυτή τη στιγμή. Αυτή είναι η
                στήλη που αλλάζετε όταν κάνετε καταμέτρηση αποθέματος.
              </li>
              <li>
                <strong className="text-foreground">Δεσμευμένα</strong> —
                τεμάχια που χρωστάτε σε εκκρεμείς παραγγελίες (έχουν
                παραγγελθεί από πελάτες, περιμένουν εκπλήρωση).
              </li>
              <li>
                <strong className="text-foreground">Σε ενεργή αγορά</strong>{" "}
                — τεμάχια που έχουν ήδη ξεκινήσει checkout από πελάτη και
                βρίσκονται σε διαδικασία πληρωμής αυτή τη στιγμή (όχι όσα
                απλώς κάθονται σε καλάθια — αυτά δεν δεσμεύουν απόθεμα). Θα
                ολοκληρωθούν ή θα ακυρωθούν αυτόματα εντός 15&nbsp;λεπτών.
              </li>
              <li>
                <strong className="text-foreground">Όριο</strong> — όταν τα
                διαθέσιμα πέσουν σε ή κάτω από αυτόν τον αριθμό, η
                παραλλαγή σημαδεύεται «Χαμηλό απόθεμα».
              </li>
            </ul>
            <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
              ⚠ <strong>Προσοχή:</strong> όταν αλλάζετε τα «Διαθέσιμα» ενώ
              η στήλη «Σε ενεργή αγορά» δείχνει αριθμό &gt; 0, μπορεί να
              δημιουργηθούν φανταστικά τεμάχια στη λογιστική. Η εφαρμογή
              θα σας προειδοποιήσει πριν αποθηκεύσετε, αλλά σιγουρευτείτε
              ότι ο νέος αριθμός αντικατοπτρίζει τα τεμάχια που έχετε
              πραγματικά.
            </p>
          </div>
        </div>
      </details>

      {/* Filter bar placeholder — class-for-class match with
          CatalogFilterBar. Five labeled slots (search + 4 selects)
          plus the Εφαρμογή submit button. Class structure matches
          the live form so the swap is invisible. */}
      <form className="flex flex-wrap items-end gap-2 mb-4 text-sm">
        <label className="flex flex-col gap-1 min-w-[220px] flex-1">
          <input
            type="search"
            disabled
            placeholder="Αναζήτηση SKU..."
            className="cms-input"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
            Κατάσταση
          </span>
          <select disabled className="cms-input min-w-[140px]">
            <option value="">Όλα</option>
            <option value="ok">Διαθέσιμο</option>
            <option value="low">Χαμηλό</option>
            <option value="out">Άδειο</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
            Κατηγορία
          </span>
          <select disabled className="cms-input min-w-[140px]">
            <option value="">— όλα —</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
            Προμηθευτής
          </span>
          <select disabled className="cms-input min-w-[140px]">
            <option value="">— όλα —</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
            Παρακολούθηση
          </span>
          <select disabled className="cms-input min-w-[140px]">
            <option value="">Όλα</option>
            <option value="yes">Ναι</option>
            <option value="no">Όχι</option>
          </select>
        </label>
        <div className="flex items-center gap-2 self-end">
          <button
            type="submit"
            disabled
            className="btn btn-secondary btn-md"
          >
            Εφαρμογή
          </button>
        </div>
      </form>

      <StaticTableSkeleton
        columns={[
          { label: "", thClassName: "py-2 pl-3 pr-2 w-10 align-middle" },
          { label: "Εικόνα", thClassName: "py-2 px-2 w-16 align-middle" },
          { label: "Προϊόν", thClassName: "py-2 px-3 align-middle text-left" },
          { label: "Παραλλαγή", thClassName: "py-2 px-3 align-middle" },
          { label: "SKU", thClassName: "py-2 px-3 align-middle" },
          {
            label: "Διαθέσιμα",
            thClassName: "py-2 px-3 w-24 text-center align-middle",
          },
          {
            label: "Δεσμευμένα",
            thClassName: "py-2 px-3 w-24 text-center align-middle",
          },
          {
            label: "Σε ενεργή αγορά",
            thClassName: "py-2 px-3 w-24 text-center align-middle",
          },
          {
            label: "Όριο",
            thClassName: "py-2 px-3 w-24 text-center align-middle",
          },
          {
            label: "Κατάσταση",
            thClassName: "py-2 px-3 w-24 text-center align-middle",
          },
          {
            label: "Ενέργειες",
            thClassName: "py-2 px-3 w-48 text-center align-middle",
          },
          { label: "", thClassName: "py-2 pl-3 pr-3 w-12 align-middle" },
        ]}
        rowCount={12}
      />
    </>
  );
}
