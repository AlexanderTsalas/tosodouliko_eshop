import Link from "next/link";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { StaticTableSkeleton } from "@/components/admin/common/static-chrome";

export default function SeoLoading() {
  return (
    <>
      <PageHeader
        title="SEO metadata"
        description="Εξατομικευμένο meta-content ανά resource (προϊόν, κατηγορία, σελίδα)."
        actions={
          <Link href="/admin/seo/new" className="btn btn-primary btn-md">
            <span className="text-base leading-none">+</span> Νέο record
          </Link>
        }
      />
      <StaticTableSkeleton
        columns={[
          { label: "Resource" },
          { label: "Title" },
          { label: "No-index" },
          { label: "Updated" },
          { label: "Ενέργειες", thClassName: "text-center" },
        ]}
        rowCount={10}
      />
    </>
  );
}
