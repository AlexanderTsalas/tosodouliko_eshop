import Link from "next/link";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";

export default function ShippingLoading() {
  return (
    <>
      <PageHeader
        title="Αποστολή"
        description="Ζώνες χωρών και χρεώσεις αποστολής που εφαρμόζονται στις παραγγελίες."
      />

      <section className="mb-10">
        <header className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Ζώνες αποστολής
            </h2>
          </div>
          <Link
            href="/admin/shipping/zones/new"
            className="btn btn-primary btn-md"
          >
            <span className="text-base leading-none">+</span> Νέα ζώνη
          </Link>
        </header>
      </section>

      <section>
        <header className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Χρεώσεις αποστολής
            </h2>
          </div>
          <Link
            href="/admin/shipping/rates/new"
            className="btn btn-primary btn-md"
          >
            <span className="text-base leading-none">+</span> Νέα χρέωση
          </Link>
        </header>
      </section>
    </>
  );
}
