import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import type { UserProfile } from "@/types/user-profile";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Χρήστες — Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface UserWithRoles extends UserProfile {
  roles: string[];
}

export default async function AdminUsersPage(
  props: {
    searchParams: Promise<{ q?: string; page?: string }>;
  }
) {
  await requirePermission("manage:users");
  const searchParams = await props.searchParams;
  const admin = createAdminClient();
  const q = searchParams.q?.trim() ?? "";
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // HARD separation: this page lists ONLY internal (back-office) users,
  // authoritatively via user_profiles.account_type = 'internal'. Pure
  // customers are managed in /admin/customers and never appear here. This
  // replaces the previous derivation from role membership, which was fragile
  // (a stray role assignment leaked a customer into this list) and required
  // three round-trips.
  let query = admin
    .from("user_profiles")
    .select("*", { count: "exact" })
    .eq("account_type", "internal")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (q) {
    const term = `%${q.replace(/[%_]/g, "\\$&")}%`;
    query = query.or(`email.ilike.${term},first_name.ilike.${term},last_name.ilike.${term}`);
  }

  const { data, count } = await query;
  const baseUsers = (data ?? []) as UserProfile[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Fetch roles for visible users in one query.
  const userIds = baseUsers.map((u) => u.id);
  const roleMap = new Map<string, string[]>();
  if (userIds.length > 0) {
    const { data: rolesData } = await admin
      .from("user_roles")
      .select("user_id, roles!inner(name)")
      .in("user_id", userIds);

    for (const row of (rolesData ?? []) as unknown as {
      user_id: string;
      roles: { name: string } | { name: string }[] | null;
    }[]) {
      const list = roleMap.get(row.user_id) ?? [];
      const r = row.roles;
      if (Array.isArray(r)) {
        for (const item of r) if (item?.name) list.push(item.name);
      } else if (r?.name) {
        list.push(r.name);
      }
      roleMap.set(row.user_id, list);
    }
  }

  const users: UserWithRoles[] = baseUsers.map((u) => ({
    ...u,
    roles: roleMap.get(u.id) ?? [],
  }));

  return (
    <>
      <PageHeader
        title="Χρήστες"
        description={`${total.toLocaleString(
          "el-GR"
        )} εσωτερικοί χρήστες με ανατεθειμένο ρόλο. Οι πελάτες διαχειρίζονται από την καρτέλα «Πελάτες».`}
        actions={
          <Link href="/admin/users/new" className="btn btn-primary btn-md">
            <span className="text-base leading-none">+</span> Νέος χρήστης
          </Link>
        }
      />

      <form className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Αναζήτηση email / όνομα..."
          className="cms-input flex-1 min-w-[220px]"
        />
        <button type="submit" className="btn btn-secondary btn-md">
          Εφαρμογή
        </button>
      </form>

      {users.length === 0 ? (
        <div className="cms-empty">Δεν βρέθηκαν εσωτερικοί χρήστες.</div>
      ) : (
        <div className="cms-table-wrap">
          <table className="cms-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Όνομα</th>
                <th>Ρόλοι</th>
                <th>Δημιουργία</th>
                <th>Ενέργειες</th>
              </tr>
            </thead>
            <tbody className="content-reveal">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.email}</td>
                  <td>
                    {u.first_name} {u.last_name}
                  </td>
                  <td>
                    {u.roles.length === 0 ? (
                      <span className="text-muted-foreground text-xs">—</span>
                    ) : (
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        {u.roles.map((r) => (
                          <span
                            key={r}
                            className="cms-badge cms-badge-muted font-mono"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString("el-GR")}
                  </td>
                  <td className="text-center">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="btn btn-secondary btn-sm"
                    >
                      Διαχείριση
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 &&
        (() => {
          const buildHref = (p: number) => {
            const params = new URLSearchParams();
            if (q) params.set("q", q);
            params.set("page", String(p));
            return `?${params.toString()}`;
          };
          return (
            <nav className="mt-4 flex items-center justify-between text-sm">
              {page > 1 ? (
                <Link
                  href={buildHref(page - 1)}
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
                  href={buildHref(page + 1)}
                  className="btn btn-secondary btn-sm"
                >
                  Επόμενη →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          );
        })()}
    </>
  );
}
