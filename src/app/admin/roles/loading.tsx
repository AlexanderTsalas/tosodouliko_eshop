import Link from "next/link";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";

export default function RolesLoading() {
  return (
    <PageHeader
      title="Ρόλοι"
      description="Ορίστε ποια δικαιώματα κατέχει κάθε ρόλος και αναθέστε τους σε χρήστες."
      actions={
        <Link href="/admin/roles/new" className="btn btn-primary btn-md">
          <span className="text-base leading-none">+</span> Νέος ρόλος
        </Link>
      }
    />
  );
}
