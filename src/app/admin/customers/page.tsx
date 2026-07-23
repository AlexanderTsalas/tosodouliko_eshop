import { Suspense } from "react";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { StaticTableSkeleton } from "@/components/admin/common/static-chrome";
import type { Customer } from "@/types/customer";
import { requirePermission } from "@/lib/rbac";
import {
  CUSTOMERS_TABLE_COLUMNS,
  CustomersFilterForm,
  PAGE_SIZE,
  SOURCES,
  isSource,
} from "./_chrome";

export const metadata = { title: "Πελάτες — Admin" };
export const dynamic = "force-dynamic";

interface CustomerWithStats extends Customer {
  order_count: number;
  last_order_at: string | null;
}

/**
 * Customers page following the "chrome first, data streams in"
 * pattern. Page handler returns chrome immediately; the heavy
 * customer_summary query + internal-role lookup happens inside
 * <CustomersTableData />, suspended.
 */
export default async function AdminCustomersPage(props: {
  searchParams: Promise<{
    q?: string;
    source?: string;
    auth?: string;
    show_empty?: string;
    page?: string;
  }>;
}) {
  await requirePermission("manage:orders");
  const searchParams = await props.searchParams;
  const q = searchParams.q?.trim() ?? "";
  const source = isSource(searchParams.source) ? searchParams.source : undefined;
  const authFilter =
    searchParams.auth === "with"
      ? "with"
      : searchParams.auth === "without"
        ? "without"
        : "all";
  const showEmpty = searchParams.show_empty === "yes";
  const page = Math.max(1, Number(searchParams.page ?? 1));

  return (
    <>
      <PageHeader
        title="Πελάτες"
        description="Αναζήτηση, στατιστικά παραγγελιών και επεξεργασία στοιχείων."
        actions={
          <Link href="/admin/customers/new" className="btn btn-primary btn-md">
            <span className="text-base leading-none">+</span> Νέος πελάτης
          </Link>
        }
      />

      <CustomersFilterForm
        q={q}
        source={source}
        authFilter={authFilter}
        showEmpty={showEmpty}
      />

      <Suspense
        fallback={
          <StaticTableSkeleton
            columns={CUSTOMERS_TABLE_COLUMNS}
            rowCount={10}
          />
        }
      >
        <CustomersTableData
          q={q}
          source={source}
          authFilter={authFilter}
          showEmpty={showEmpty}
          page={page}
        />
      </Suspense>
    </>
  );
}

async function CustomersTableData({
  q,
  source,
  authFilter,
  showEmpty,
  page,
}: {
  q: string;
  source: string | undefined;
  authFilter: string;
  showEmpty: boolean;
  page: number;
}) {
  const admin = createAdminClient();
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Resolve internal-user auth ids in parallel with the customers query.
  // Internal (back-office) users must never appear in this list — resolved
  // authoritatively via user_profiles.account_type (previously derived from
  // role membership, which was fragile and needed two round-trips).
  const internalAuthIdsPromise = (async (): Promise<Set<string>> => {
    const { data: internalProfiles } = await admin
      .from("user_profiles")
      .select("id")
      .eq("account_type", "internal");
    return new Set(
      ((internalProfiles ?? []) as Array<{ id: string }>).map((r) => r.id)
    );
  })();

  let query = admin
    .from("customer_summary")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (q) {
    const term = `%${q.replace(/[%_]/g, "\\$&")}%`;
    query = query.or(
      `email.ilike.${term},first_name.ilike.${term},last_name.ilike.${term},phone.ilike.${term}`
    );
  }
  if (source) query = query.eq("source", source);
  if (authFilter === "with") query = query.not("auth_user_id", "is", null);
  if (authFilter === "without") query = query.is("auth_user_id", null);
  if (!showEmpty) {
    query = query.or(
      "first_name.not.is.null,last_name.not.is.null,email.not.is.null,phone.not.is.null"
    );
  }

  const [internalAuthIds, { data: customerRows, count }] = await Promise.all([
    internalAuthIdsPromise,
    query,
  ]);
  const enrichedAll = (customerRows ?? []) as CustomerWithStats[];
  const enriched = enrichedAll.filter(
    (c) => !c.auth_user_id || !internalAuthIds.has(c.auth_user_id)
  );
  const hiddenStaffCount = enrichedAll.length - enriched.length;
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildQuery = (override: Partial<Record<string, string | number>>) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (source) p.set("source", source);
    if (authFilter !== "all") p.set("auth", authFilter);
    if (showEmpty) p.set("show_empty", "yes");
    for (const [k, v] of Object.entries(override)) p.set(k, String(v));
    return p.toString();
  };

  return (
    <>
      {hiddenStaffCount > 0 && (
        <p className="text-xs text-muted-foreground mb-3">
          {hiddenStaffCount} εσωτερικοί χρήστες αποκλείστηκαν αυτόματα από αυτή
          τη λίστα — διαχειρίζονται από την ενότητα «Χρήστες» στις ρυθμίσεις
          ομάδας.
        </p>
      )}

      {enriched.length === 0 ? (
        <div className="cms-empty">Δεν βρέθηκαν πελάτες.</div>
      ) : (
        <div className="cms-table-wrap">
          <table className="cms-table">
            <thead>
              <tr>
                {CUSTOMERS_TABLE_COLUMNS.map((c, i) => (
                  <th key={i} className={c.thClassName}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="content-reveal">
              {enriched.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">
                    {[c.first_name, c.last_name].filter(Boolean).join(" ") || (
                      <span className="text-muted-foreground italic">
                        (χωρίς όνομα)
                      </span>
                    )}
                  </td>
                  <td className="text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="text-xs">
                    {SOURCES.find((s) => s.value === c.source)?.label ?? c.source}
                  </td>
                  <td>
                    {c.auth_user_id ? (
                      <span className="cms-badge cms-badge-neutral">
                        <span className="cms-badge-dot" aria-hidden />
                        ναι
                      </span>
                    ) : (
                      <span className="cms-badge cms-badge-muted">offline</span>
                    )}
                  </td>
                  <td className="text-center tabular-nums font-mono">
                    {c.order_count}
                  </td>
                  <td className="text-muted-foreground">
                    {c.last_order_at
                      ? new Date(c.last_order_at).toLocaleDateString("el-GR")
                      : "—"}
                  </td>
                  <td>
                    <Link
                      href={`/admin/customers/${c.id}`}
                      className="btn btn-secondary btn-sm"
                    >
                      Λεπτομέρειες
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link
              href={`?${buildQuery({ page: page - 1 })}`}
              className="btn btn-secondary btn-sm"
            >
              ← Προηγούμενη
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Σελίδα {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={`?${buildQuery({ page: page + 1 })}`}
              className="btn btn-secondary btn-sm"
            >
              Επόμενη →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
