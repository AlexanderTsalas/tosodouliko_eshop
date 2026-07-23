import Link from "next/link";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";

export default function CategoriesLoading() {
  return (
    <PageHeader
      title="Κατηγορίες"
      description="Ιεραρχικό δέντρο κατηγοριών. Παιδιά εμφανίζονται με εσοχή. Ανενεργές κατηγορίες είναι αμυδρές."
      actions={
        <Link href="/admin/categories/new" className="btn btn-primary btn-md">
          <span className="text-base leading-none">+</span> Νέα κατηγορία
        </Link>
      }
    />
  );
}
