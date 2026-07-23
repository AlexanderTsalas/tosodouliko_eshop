import Link from "next/link";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { StaticTableSkeleton } from "@/components/admin/common/static-chrome";

export default function UsersLoading() {
  return (
    <>
      <PageHeader
        title="Χρήστες"
        description="Εσωτερικοί χρήστες με ανατεθειμένο ρόλο. Οι πελάτες διαχειρίζονται από την καρτέλα «Πελάτες»."
        actions={
          <Link href="/admin/users/new" className="btn btn-primary btn-md">
            <span className="text-base leading-none">+</span> Νέος χρήστης
          </Link>
        }
      />

      <form className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <input
          type="search"
          name="q"
          disabled
          placeholder="Αναζήτηση email / όνομα..."
          className="cms-input flex-1 min-w-[220px]"
        />
        <button type="submit" disabled className="btn btn-secondary btn-md">
          Εφαρμογή
        </button>
      </form>

      <StaticTableSkeleton
        columns={[
          { label: "Email" },
          { label: "Όνομα" },
          { label: "Ρόλοι" },
          { label: "Δημιουργία" },
          { label: "Ενέργειες" },
        ]}
        rowCount={10}
      />
    </>
  );
}
