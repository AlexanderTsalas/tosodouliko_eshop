import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { Layers, ClipboardList } from "@/components/admin/common/icons";

export default function AttributesLoading() {
  return (
    <>
      <PageHeader
        title="Χαρακτηριστικά"
        description="Ορίστε τύπους χαρακτηριστικών (π.χ. Colour, Size, Flavour) και τις τιμές τους. Οι παραλλαγές προϊόντων επιλέγουν από τα χαρακτηριστικά παραλλαγών· οι προδιαγραφές προϊόντος από όλα τα υπόλοιπα."
      />

      <div className="space-y-6">
        <section className="cms-card-section space-y-5">
          <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Χαρακτηριστικά παραλλαγών
              </h2>
              <p className="text-sm text-foreground/70 mt-1.5 max-w-3xl">
                Χρησιμοποιούνται ως άξονες παραλλαγής (επιλέξιμα από τον πελάτη).
              </p>
            </div>
            <form className="flex items-end gap-2 shrink-0">
              <label className="block">
                <span className="block text-xs font-medium mb-1 text-muted-foreground">
                  Νέος τύπος
                </span>
                <input
                  placeholder="π.χ. Χρώμα, Υλικό…"
                  className="cms-input min-w-[220px]"
                  disabled
                />
              </label>
              <button type="submit" disabled className="btn btn-primary btn-md">
                <span className="text-base leading-none">+</span> Δημιουργία
              </button>
            </form>
          </header>
        </section>

        <section className="cms-card-section space-y-5">
          <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />
                Χαρακτηριστικά προδιαγραφών
              </h2>
              <p className="text-sm text-foreground/70 mt-1.5 max-w-3xl">
                Χρησιμοποιούνται μόνο ως προδιαγραφές προϊόντος ή δεν είναι ακόμη σε χρήση.
              </p>
            </div>
            <form className="flex items-end gap-2 shrink-0">
              <label className="block">
                <span className="block text-xs font-medium mb-1 text-muted-foreground">
                  Νέος τύπος
                </span>
                <input
                  placeholder="π.χ. Χρώμα, Υλικό…"
                  className="cms-input min-w-[220px]"
                  disabled
                />
              </label>
              <button type="submit" disabled className="btn btn-primary btn-md">
                <span className="text-base leading-none">+</span> Δημιουργία
              </button>
            </form>
          </header>
        </section>
      </div>
    </>
  );
}
