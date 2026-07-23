import Link from "next/link";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { StaticTableSkeleton } from "@/components/admin/common/static-chrome";

export default function SuppliersLoading() {
  return (
    <>
      <PageHeader
        title="Προμηθευτές"
        description="Διαχείριση στοιχείων επικοινωνίας, νομίσματος και ανάθεσης σε προϊόντα."
        actions={
          <Link href="/admin/suppliers/new" className="btn btn-primary btn-md">
            <span className="text-base leading-none">+</span> Νέος προμηθευτής
          </Link>
        }
      />

      <StaticTableSkeleton
        columns={[
          { label: "Όνομα" },
          { label: "Email" },
          { label: "Τηλέφωνο" },
          { label: "Νόμισμα" },
          { label: "Χώρα" },
          { label: "Κατάσταση" },
        ]}
        rowCount={10}
      />
    </>
  );
}
