import Link from "next/link";

export default function SupplyOrderDetailLoading() {
  return (
    <Link
      href="/admin/supply-orders?view=tracking"
      className="btn btn-secondary btn-sm mb-4"
    >
      ← Παρακολούθηση παραγγελιών
    </Link>
  );
}
