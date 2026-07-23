import Link from "next/link";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { StaticTableSkeleton } from "@/components/admin/common/static-chrome";
import { CUSTOMERS_TABLE_COLUMNS, CustomersFilterForm } from "./_chrome";

/**
 * Navigation-gap loading state for /admin/customers. Renders the same
 * chrome as the page handler (header + filter form + table skeleton)
 * so the transition from loading.tsx to page.tsx render is invisible.
 */
export default function CustomersLoading() {
  return (
    <>
      <PageHeader
        title="Πελάτες"
        description="Αναζήτηση, στατιστικά παραγγελιών και επεξεργασία στοιχείων."
        actions={
          <Link href="/admin/customers/new" className="btn btn-primary btn-md">
            <span className="text-base leading-none">+</span> Νέος πελάτης
          </Link>
        }
      />
      <CustomersFilterForm />
      <StaticTableSkeleton columns={CUSTOMERS_TABLE_COLUMNS} rowCount={10} />
    </>
  );
}
