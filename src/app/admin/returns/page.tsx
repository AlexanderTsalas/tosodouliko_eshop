import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AdminReturnPanel from "@/components/features/returns-refunds/AdminReturnPanel";
import type { ReturnRequest, ReturnStatus } from "@/types/returns-refunds";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Επιστροφές — Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const STATUS_VALUES: ReturnStatus[] = ["pending", "approved", "rejected", "refunded"];

function isStatus(v: string | undefined): v is ReturnStatus {
  return typeof v === "string" && STATUS_VALUES.includes(v as ReturnStatus);
}

export default async function AdminReturnsPage(
  props: {
    searchParams: Promise<{ status?: string; page?: string }>;
  }
) {
  await requirePermission("manage:returns");
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const status = isStatus(searchParams.status) ? searchParams.status : null;
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE - 1;

  // Server-side pagination + status filter. Previously
  // fetched the entire return_requests table unbounded.
  let query = supabase
    .from("return_requests")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(pageStart, pageEnd);
  if (status) query = query.eq("status", status);

  // Status-tab badge counts via four head-only queries in parallel
  // with the visible page query.
  const [
    rowsRes,
    pendingCountRes,
    approvedCountRes,
    rejectedCountRes,
    refundedCountRes,
  ] = await Promise.all([
    query,
    supabase
      .from("return_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("return_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved"),
    supabase
      .from("return_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "rejected"),
    supabase
      .from("return_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "refunded"),
  ]);

  const counts: Record<ReturnStatus | "all", number> = {
    all:
      (pendingCountRes.count ?? 0) +
      (approvedCountRes.count ?? 0) +
      (rejectedCountRes.count ?? 0) +
      (refundedCountRes.count ?? 0),
    pending: pendingCountRes.count ?? 0,
    approved: approvedCountRes.count ?? 0,
    rejected: rejectedCountRes.count ?? 0,
    refunded: refundedCountRes.count ?? 0,
  };
  const total = rowsRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const tabHref = (s: ReturnStatus | null) => {
    const params = new URLSearchParams();
    if (s) params.set("status", s);
    const q = params.toString();
    return q ? `/admin/returns?${q}` : "/admin/returns";
  };

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Αιτήσεις επιστροφής</h1>

      <nav className="flex flex-wrap gap-2 mb-4 text-sm">
        <Link
          href={tabHref(null)}
          className={`btn btn-sm ${status === null ? "btn-primary" : "btn-secondary"}`}
        >
          Όλες <span className="ml-1 opacity-70">({counts.all})</span>
        </Link>
        {STATUS_VALUES.map((s) => (
          <Link
            key={s}
            href={tabHref(s)}
            className={`btn btn-sm ${status === s ? "btn-primary" : "btn-secondary"}`}
          >
            {labelFor(s)} <span className="ml-1 opacity-70">({counts[s]})</span>
          </Link>
        ))}
      </nav>

      <AdminReturnPanel initialRequests={(rowsRes.data ?? []) as ReturnRequest[]} />

      {totalPages > 1 && (
        <nav className="flex items-center justify-between mt-6 text-sm">
          <span className="text-muted-foreground">
            Σελίδα {page} / {totalPages} — {total.toLocaleString("el-GR")} συνολικά
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/admin/returns?${new URLSearchParams({
                  ...(status ? { status } : {}),
                  page: String(page - 1),
                }).toString()}`}
                className="btn btn-secondary btn-sm"
              >
                ← Προηγούμενη
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/admin/returns?${new URLSearchParams({
                  ...(status ? { status } : {}),
                  page: String(page + 1),
                }).toString()}`}
                className="btn btn-secondary btn-sm"
              >
                Επόμενη →
              </Link>
            )}
          </div>
        </nav>
      )}
    </>
  );
}

function labelFor(s: ReturnStatus): string {
  switch (s) {
    case "pending":
      return "Εκκρεμείς";
    case "approved":
      return "Εγκρ.";
    case "rejected":
      return "Απορ.";
    case "refunded":
      return "Επιστρ.";
  }
}
