import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { StaticTableSkeleton } from "@/components/admin/common/static-chrome";

export default function NewsletterLoading() {
  return (
    <>
      <PageHeader
        title="Newsletter"
        description="Διαχείριση συνδρομητών και κατάστασης συναίνεσης."
      />

      <form className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <select disabled className="cms-input w-auto">
          <option value="all">Όλα</option>
          <option value="subscribed">Subscribed</option>
          <option value="unsubscribed">Unsubscribed</option>
          <option value="pending">Pending</option>
        </select>
        <button type="submit" disabled className="btn btn-secondary btn-md">
          Φιλτράρισμα
        </button>
      </form>

      <StaticTableSkeleton
        columns={[
          { label: "Email" },
          { label: "Status" },
          { label: "Consent" },
          { label: "Ενέργειες" },
        ]}
        rowCount={10}
      />
    </>
  );
}
