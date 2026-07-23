import PageHeader from "@/components/features/backoffice-shell/PageHeader";

export default function EmailSettingsLoading() {
  return (
    <>
      <PageHeader
        eyebrow="Ρυθμίσεις"
        title="Πάροχος email"
        description="Διαχείριση του παρόχου που στέλνει τα emails του eshop (επιβεβαιώσεις παραγγελιών, ειδοποιήσεις αποστολής, password reset). Ένας πάροχος είναι ενεργός κάθε φορά."
      />

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
        <section className="space-y-3 xl:sticky xl:top-6 xl:self-start">
          <header className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Διαμορφωμένοι πάροχοι
            </h2>
          </header>
        </section>

        <section className="cms-card">
          <header className="flex items-center justify-between mb-4 pb-4 border-b border-foreground/10">
            <div className="flex items-baseline gap-3 min-w-0">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Νέος πάροχος
              </h2>
            </div>
          </header>
        </section>
      </div>
    </>
  );
}
