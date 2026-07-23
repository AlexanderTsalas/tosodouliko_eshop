import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { StaticTableSkeleton } from "@/components/admin/common/static-chrome";

export default function ErrorsLoading() {
  return (
    <>
      <PageHeader
        eyebrow="Λειτουργία"
        title="Σφάλματα"
        description="Παρακολούθηση application errors, με δυνατότητα φιλτραρίσματος ανά severity και κατάσταση."
      />

      <form className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <select disabled className="cms-input w-auto">
          <option value="">Όλα τα severity</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="critical">critical</option>
        </select>
        <select disabled className="cms-input w-auto">
          <option value="">Όλα</option>
          <option value="false">Ανοιχτά</option>
          <option value="true">Επιλυμένα</option>
        </select>
        <button type="submit" disabled className="btn btn-secondary btn-md">
          Φιλτράρισμα
        </button>
      </form>

      <StaticTableSkeleton
        columns={[
          { label: "Last seen" },
          { label: "Severity" },
          { label: "Type" },
          { label: "Message" },
          { label: "Count", thClassName: "text-center" },
          { label: "Status" },
          { label: "Ενέργειες", thClassName: "text-center" },
        ]}
        rowCount={10}
      />
    </>
  );
}
