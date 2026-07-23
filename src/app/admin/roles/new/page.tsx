import RoleForm from "@/components/admin/rbac/RoleForm";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Νέος ρόλος — Admin" };
export const dynamic = "force-dynamic";

export default async function NewRolePage() {
  await requirePermission("manage:roles");
  return (
    <>
      <h1 className="text-2xl font-semibold mb-2">Νέος ρόλος</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Μετά τη δημιουργία θα μπορείτε να αναθέσετε δικαιώματα.
      </p>
      <RoleForm mode="create" />
    </>
  );
}
