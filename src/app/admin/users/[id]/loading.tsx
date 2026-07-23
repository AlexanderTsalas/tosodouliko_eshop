import Link from "next/link";

export default function UserDetailLoading() {
  return (
    <Link href="/admin/users" className="btn btn-secondary btn-sm mb-4">
      ← Πίσω στους χρήστες
    </Link>
  );
}
