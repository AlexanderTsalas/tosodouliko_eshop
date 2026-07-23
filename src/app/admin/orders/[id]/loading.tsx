import Link from "next/link";

export default function OrderDetailLoading() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-6">
      <div className="min-w-0">
        <Link href="/admin/orders" className="btn btn-secondary btn-sm mb-4">
          ← Πίσω στις παραγγελίες
        </Link>
      </div>
    </div>
  );
}
