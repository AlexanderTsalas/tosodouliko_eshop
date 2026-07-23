import PageHeader from "@/components/features/backoffice-shell/PageHeader";

export default function SupplyOrdersLoading() {
  return (
    <>
      <PageHeader
        eyebrow="Προμηθευτές"
        title="Παραγγελίες προμηθειών"
        description="Διαχειριστείτε drafts προς αποστολή στους προμηθευτές σας και παρακολουθήστε όσες έχουν ήδη παραγγελθεί."
      />
      <nav
        className="border-b border-foreground/10 mb-6 flex flex-wrap gap-1"
        aria-label="Καρτέλες"
      >
        <span
          aria-current="page"
          className="inline-flex items-center gap-2 px-3.5 py-2.5 text-sm border-b-2 -mb-px border-foreground text-foreground font-semibold"
        >
          Drafts
        </span>
        <span className="inline-flex items-center gap-2 px-3.5 py-2.5 text-sm border-b-2 -mb-px border-transparent text-muted-foreground">
          Παρακολούθηση
        </span>
      </nav>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <div className="cms-card">
          <p className="text-xs text-muted-foreground font-medium">
            Ανοιχτά drafts
          </p>
          <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
            <span className="inline-block h-6 w-10 bg-muted/30 rounded animate-pulse skeleton-reveal align-middle" />
          </p>
        </div>
        <div className="cms-card">
          <p className="text-xs text-muted-foreground font-medium">
            Προς προσθήκη
          </p>
          <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
            <span className="inline-block h-6 w-10 bg-muted/30 rounded animate-pulse skeleton-reveal align-middle" />
          </p>
        </div>
        <div className="cms-card">
          <p className="text-xs text-muted-foreground font-medium">
            Χρειάζονται απόφαση
          </p>
          <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
            <span className="inline-block h-6 w-10 bg-muted/30 rounded animate-pulse skeleton-reveal align-middle" />
          </p>
        </div>
      </div>
    </>
  );
}
