import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { StaticTableSkeleton } from "@/components/admin/common/static-chrome";

export default function MarginsLoading() {
  return (
    <>
      <PageHeader
        eyebrow="Αναφορές"
        title="Περιθώρια Κέρδους"
        description="Καθαρό περιθώριο = τιμή πώλησης μείον ΦΠΑ μείον κόστος μονάδας. Προϊόντα χωρίς κόστος ή με κόστος σε διαφορετικό νόμισμα εμφανίζονται με «—»."
      />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="cms-card">
          <p className="text-xs text-muted-foreground font-medium">
            Μέσο περιθώριο
          </p>
          <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
            <span className="inline-block h-6 w-16 bg-muted/30 rounded animate-pulse skeleton-reveal align-middle" />
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Από προϊόντα με δεδομένα
          </p>
        </div>
        <div className="cms-card">
          <p className="text-xs text-muted-foreground font-medium">
            Χαμηλό περιθώριο
          </p>
          <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
            <span className="inline-block h-6 w-10 bg-muted/30 rounded animate-pulse skeleton-reveal align-middle" />
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Κάτω από 20%
          </p>
        </div>
        <div className="cms-card">
          <p className="text-xs text-muted-foreground font-medium">
            Αρνητικό περιθώριο
          </p>
          <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
            <span className="inline-block h-6 w-10 bg-muted/30 rounded animate-pulse skeleton-reveal align-middle" />
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Προϊόντα με ζημία
          </p>
        </div>
        <div className="cms-card">
          <p className="text-xs text-muted-foreground font-medium">
            Χωρίς δεδομένα
          </p>
          <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
            <span className="inline-block h-6 w-10 bg-muted/30 rounded animate-pulse skeleton-reveal align-middle" />
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Κόστος ή ΦΠΑ λείπει
          </p>
        </div>
      </section>

      <nav className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs uppercase tracking-wider font-medium text-muted-foreground mr-2">
          Ταξινόμηση:
        </span>
        <span className="btn btn-primary btn-sm">Περιθώριο ↑</span>
        <span className="btn btn-secondary btn-sm">Περιθώριο ↓</span>
        <span className="btn btn-secondary btn-sm">Κόστος ↓</span>
        <span className="btn btn-secondary btn-sm">Όνομα</span>
      </nav>

      <StaticTableSkeleton
        columns={[
          { label: "Προϊόν" },
          { label: "Τιμή", thClassName: "text-center" },
          { label: "ΦΠΑ", thClassName: "text-center" },
          { label: "Καθαρή", thClassName: "text-center" },
          { label: "Κόστος", thClassName: "text-center" },
          { label: "Περιθώριο", thClassName: "text-center" },
        ]}
        rowCount={10}
      />
    </>
  );
}
