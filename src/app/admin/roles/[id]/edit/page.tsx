import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import RoleForm from "@/components/admin/rbac/RoleForm";
import RolePermissionsGrid from "@/components/admin/rbac/RolePermissionsGrid";
import type { Role, Permission } from "@/types/rbac";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Επεξεργασία ρόλου — Admin" };
export const dynamic = "force-dynamic";

export default async function EditRolePage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  await requirePermission("manage:roles");
  const params = await props.params;
  const admin = createAdminClient();

  const [roleRes, allPermsRes, rolePermsRes] = await Promise.all([
    admin.from("roles").select("*").eq("id", params.id).maybeSingle(),
    admin.from("permissions").select("*").order("resource").order("action"),
    admin
      .from("role_permissions")
      .select("permission_id")
      .eq("role_id", params.id),
  ]);

  if (!roleRes.data) notFound();

  const role = roleRes.data as Role;
  const allPermissions = (allPermsRes.data ?? []) as Permission[];
  const initialIds = ((rolePermsRes.data ?? []) as { permission_id: string }[]).map(
    (r) => r.permission_id
  );

  return (
    <>
      <Link href="/admin/roles" className="btn btn-secondary btn-sm mb-4">
        ← Ρόλοι
      </Link>
      <PageHeader
        title={
          <span className="flex items-baseline gap-3">
            <span>Ρόλος</span>
            <span className="font-mono text-xl text-muted-foreground">
              {role.name}
            </span>
          </span>
        }
        description={
          role.description ??
          "Επεξεργαστείτε τα βασικά στοιχεία και επιλέξτε τα δικαιώματα που κατέχει ο ρόλος."
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <aside>
          <section className="cms-card">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Βασικά
            </h2>
            <RoleForm mode="edit" role={role} />
          </section>
        </aside>

        <section>
          <RolePermissionsGrid
            roleId={role.id}
            allPermissions={allPermissions}
            initialPermissionIds={initialIds}
          />
        </section>
      </div>
    </>
  );
}
