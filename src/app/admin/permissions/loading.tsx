import PageHeader from "@/components/features/backoffice-shell/PageHeader";

export default function PermissionsLoading() {
  return (
    <>
      <PageHeader
        title="Δικαιώματα"
        description={
          <>
            Custom δικαιώματα. Τα built-in (manage:*, read:*) χρησιμοποιούνται
            από RLS policies και δεν διαγράφονται. Νέα δικαιώματα ισχύουν μόλις
            τα αναθέσετε σε ρόλο και τα ελέγξετε στον κώδικα με{" "}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              has_permission(&apos;action:resource&apos;)
            </code>
            .
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <form className="cms-card space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Νέο δικαίωμα
            </h3>
            <label className="block">
              <span className="block text-xs font-medium mb-1">Resource</span>
              <input
                placeholder="π.χ. reports"
                className="cms-input font-mono"
                disabled
              />
              <span className="text-[11px] text-muted-foreground mt-1 block">
                Πεζά γράμματα, αριθμοί ή παύλα.
              </span>
            </label>
            <label className="block">
              <span className="block text-xs font-medium mb-1">Action</span>
              <input
                placeholder="π.χ. read, export"
                className="cms-input font-mono"
                disabled
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium mb-1">
                Περιγραφή{" "}
                <span className="text-muted-foreground">(προαιρετικό)</span>
              </span>
              <input
                placeholder="Σύντομη περιγραφή"
                className="cms-input"
                disabled
              />
            </label>
            <button
              type="submit"
              disabled
              className="btn btn-primary btn-md w-full"
            >
              Δημιουργία δικαιώματος
            </button>
            <p className="text-[11px] text-muted-foreground border-t pt-3">
              Το πλήρες όνομα γίνεται{" "}
              <code className="font-mono">action:resource</code>. Χρήση στον
              κώδικα ως{" "}
              <code className="font-mono">has_permission(&apos;...&apos;)</code>.
            </p>
          </form>
        </aside>
        <div />
      </div>
    </>
  );
}
