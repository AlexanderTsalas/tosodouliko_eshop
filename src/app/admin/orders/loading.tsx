import Link from "next/link";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { StaticTableSkeleton } from "@/components/admin/common/static-chrome";
import { ORDERS_TABLE_COLUMNS, OrdersFilterForm } from "./_chrome";

/**
 * Navigation-gap loading state for /admin/orders.
 *
 * Renders the SAME chrome as the page handler — header, "+ Νέα
 * παραγγελία" action, filter form, and a table skeleton with the
 * same column labels. The only differences vs the live page are
 * empty filter defaults (loading.tsx can't read searchParams) and
 * skeleton rows instead of real data.
 *
 * Because both this file and the page handler import their chrome
 * from _chrome.tsx, the navigation gap and the data gap show the
 * same DOM structure — the user perceives one continuous render.
 */
export default function OrdersLoading() {
  return (
    <>
      <PageHeader
        title="Παραγγελίες"
        description="Φιλτράρετε ανά κατάσταση πληρωμής ή ροή αποστολής."
        actions={
          <Link href="/admin/orders/new" className="btn btn-primary btn-md">
            <span className="text-base leading-none">+</span> Νέα παραγγελία
          </Link>
        }
      />
      <OrdersFilterForm />
      <StaticTableSkeleton columns={ORDERS_TABLE_COLUMNS} rowCount={10} />
    </>
  );
}
