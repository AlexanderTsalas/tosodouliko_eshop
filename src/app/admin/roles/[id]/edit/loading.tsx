import Link from "next/link";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";

export default function EditRoleLoading() {
  return (
    <>
      <Link href="/admin/roles" className="btn btn-secondary btn-sm mb-4">
        ← Ρόλοι
      </Link>
      <PageHeader
        title={
          <span className="flex items-baseline gap-3">
            <span>Ρόλος</span>
            <span className="font-mono text-xl text-muted-foreground">
              <span className="inline-block h-5 w-32 bg-muted/30 rounded animate-pulse skeleton-reveal align-middle" />
            </span>
          </span>
        }
        description="Επεξεργαστείτε τα βασικά στοιχεία και επιλέξτε τα δικαιώματα που κατέχει ο ρόλος."
      />
    </>
  );
}
