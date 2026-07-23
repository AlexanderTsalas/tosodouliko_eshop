import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import RoleDeleteButton from "@/components/admin/rbac/RoleDeleteButton";
import { Pencil } from "@/components/admin/common/icons";
import type { Role } from "@/types/rbac";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Ρόλοι — Admin" };
export const dynamic = "force-dynamic";

/**
 * Built-in role names that are referenced by RLS policies + seed
 * migrations. The UI flags these so admins know they can't delete them
 * without breaking the seed data. The list mirrors the names seeded by
 * 20260430000003_rbac_schema.sql.
 */
const SYSTEM_ROLES = new Set(["admin", "customer", "staff"]);

export default async function AdminRolesPage() {
  await requirePermission("manage:roles");
  const admin = createAdminClient();

  const [{ data: roles }, { data: counts }, { data: assignments }] = await Promise.all([
    admin.from("roles").select("*").order("name"),
    admin.from("role_permissions").select("role_id"),
    admin.from("user_roles").select("role_id"),
  ]);

  const permCounts = new Map<string, number>();
  for (const r of (counts ?? []) as { role_id: string }[]) {
    permCounts.set(r.role_id, (permCounts.get(r.role_id) ?? 0) + 1);
  }
  const assignCounts = new Map<string, number>();
  for (const r of (assignments ?? []) as { role_id: string }[]) {
    assignCounts.set(r.role_id, (assignCounts.get(r.role_id) ?? 0) + 1);
  }

  const list = (roles ?? []) as Role[];

  return (
    <>
      <PageHeader
        title="Ρόλοι"
        description={`${list.length.toLocaleString("el-GR")} ρόλ${list.length === 1 ? "ος" : "οι"}. Ορίστε ποια δικαιώματα κατέχει κάθε ρόλος και αναθέστε τους σε χρήστες.`}
        actions={
          <Link href="/admin/roles/new" className="btn btn-primary btn-md">
            <span className="text-base leading-none">+</span> Νέος ρόλος
          </Link>
        }
      />

      {list.length === 0 ? (
        <div className="cms-empty">Δεν υπάρχουν ρόλοι.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((r) => {
            const isSystem = SYSTEM_ROLES.has(r.name);
            const permCount = permCounts.get(r.id) ?? 0;
            const userCount = assignCounts.get(r.id) ?? 0;
            return (
              <article key={r.id} className="cms-card flex flex-col">
                <header className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <h2 className="font-mono font-semibold text-base tracking-tight truncate">
                      {r.name}
                    </h2>
                    {isSystem && (
                      <span className="cms-badge cms-badge-muted mt-1">system</span>
                    )}
                  </div>
                </header>

                <p className="text-sm text-muted-foreground min-h-[2.5rem] line-clamp-2 mb-3">
                  {r.description ?? (
                    <span className="italic">Χωρίς περιγραφή</span>
                  )}
                </p>

                <dl className="grid grid-cols-2 gap-2 text-xs mb-4">
                  <div className="rounded-md border border-foreground/10 px-2.5 py-1.5">
                    <dt className="text-muted-foreground">Δικαιώματα</dt>
                    <dd className="text-lg font-semibold tabular-nums tracking-tight">
                      {permCount}
                    </dd>
                  </div>
                  <div className="rounded-md border border-foreground/10 px-2.5 py-1.5">
                    <dt className="text-muted-foreground">Χρήστες</dt>
                    <dd className="text-lg font-semibold tabular-nums tracking-tight">
                      {userCount}
                    </dd>
                  </div>
                </dl>

                <div className="flex items-center gap-2 mt-auto">
                  <Link
                    href={`/admin/roles/${r.id}/edit`}
                    className="btn btn-secondary btn-sm flex-1 justify-center"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Επεξεργασία
                  </Link>
                  {!isSystem && <RoleDeleteButton id={r.id} name={r.name} />}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
