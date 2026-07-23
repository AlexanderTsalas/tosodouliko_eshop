import Link from "next/link";

export default function CustomerDetailLoading() {
  return (
    <Link href="/admin/customers" className="btn btn-secondary btn-sm mb-4">
      ← Πίσω στους πελάτες
    </Link>
  );
}
