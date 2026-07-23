import Link from "next/link";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { StaticTableSkeleton } from "@/components/admin/common/static-chrome";

export default function ProductsLoading() {
  return (
    <>
      <PageHeader
        title="Προϊόντα"
        description="Διαχείριση καταλόγου, παραλλαγών και τιμοκαταλόγου."
        actions={
          <Link href="/admin/products/new" className="btn btn-primary btn-md">
            <span className="text-base leading-none">+</span> Νέο προϊόν
          </Link>
        }
      />

      <div className="flex flex-wrap items-end gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <form className="flex flex-wrap items-end gap-2 mb-4 text-sm">
            <label className="flex flex-col gap-1 min-w-[220px] flex-1">
              <input
                type="search"
                disabled
                placeholder="Αναζήτηση name / slug / brand..."
                className="cms-input"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                Ορατότητα
              </span>
              <select disabled className="cms-input min-w-[140px]">
                <option value="">Όλα</option>
                <option value="active">Ενεργά</option>
                <option value="inactive">Ανενεργά</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                Απόθεμα
              </span>
              <select disabled className="cms-input min-w-[140px]">
                <option value="">Όλα</option>
                <option value="ok">Διαθέσιμα</option>
                <option value="low">Χαμηλό</option>
                <option value="out">Άδεια</option>
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
        </div>
        <div className="mb-4">
          <button disabled className="btn btn-secondary btn-md">
            Φίλτρα
          </button>
        </div>
      </div>

      <StaticTableSkeleton
        columns={[
          { label: "", thClassName: "w-8" },
          { label: "", thClassName: "w-[120px]" },
          { label: "Όνομα", thClassName: "text-left" },
          { label: "Base SKU", thClassName: "text-left" },
          { label: "Slug" },
          { label: "Τιμή" },
          { label: "Παραλλαγές" },
          { label: "Απόθεμα" },
          { label: "Απόθεμα · κατάσταση" },
          { label: "Ενεργό" },
          { label: "Ενέργειες" },
        ]}
        rowCount={12}
      />
    </>
  );
}
