import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import PermissionsManager from "@/components/admin/rbac/PermissionsManager";
import type { Permission } from "@/types/rbac";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Δικαιώματα — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPermissionsPage() {
  await requirePermission("manage:roles");
  const admin = createAdminClient();
  const { data } = await admin
    .from("permissions")
    .select("*")
    .order("resource")
    .order("action");

  return (
    <>
      <PageHeader
        title="Δικαιώματα"
        description={
          <>
            Custom δικαιώματα. Τα built-in (manage:*, read:*) χρησιμοποιούνται
            από RLS policies και δεν διαγράφονται. Νέα δικαιώματα ισχύουν μόλις
            τα αναθέσετε σε ρόλο και τα ελέγξετε στον κώδικα με{" "}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              has_permission(&apos;action:resource&apos;)
            </code>
            .
          </>
        }
      />
      <PermissionsManager initial={(data ?? []) as Permission[]} />
    </>
  );
}
