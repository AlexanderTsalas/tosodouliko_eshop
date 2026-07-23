import { createAdminClient } from "@/lib/supabase/admin";
import CreateUserForm from "@/components/admin/users/CreateUserForm";
import type { Role } from "@/types/rbac";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Νέος χρήστης — Admin" };
export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  await requirePermission("manage:users");
  const admin = createAdminClient();
  const { data } = await admin.from("roles").select("*").order("name");

  return (
    <>
      <h1 className="text-2xl font-semibold mb-2">Πρόσκληση εσωτερικού χρήστη</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Στέλνεται email πρόσκλησης· ο χρήστης ορίζει τον δικό του κωδικό. Για την
        ολοκλήρωση θα του δώσετε ξεχωριστά έναν κωδικό ενεργοποίησης MFA (εμφανίζεται
        μία φορά μετά την αποστολή).
      </p>
      <CreateUserForm allRoles={(data ?? []) as Role[]} />
    </>
  );
}
