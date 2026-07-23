import { createAdminClient } from "@/lib/supabase/admin";
import StorefrontSettingsForm from "@/components/admin/settings/StorefrontSettingsForm";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Ρυθμίσεις καταστήματος — Admin" };
export const dynamic = "force-dynamic";

export default async function StorefrontSettingsPage() {
  await requirePermission("manage:settings");
  const admin = createAdminClient();
  const { data } = await admin
    .from("storefront_settings")
    .select("show_when_oos_default")
    .eq("id", 1)
    .maybeSingle();

  const showWhenOosDefault = Boolean(
    (data as { show_when_oos_default: boolean } | null)?.show_when_oos_default
  );

  return (
    <>
      <h1 className="text-2xl font-semibold mb-2">Ρυθμίσεις καταστήματος</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Καθολικές ρυθμίσεις για τη συμπεριφορά του front-end. Παρακάμπτονται από
        ρυθμίσεις προϊόντος και παραλλαγής όπου υπάρχουν.
      </p>
      <StorefrontSettingsForm
        initialShowWhenOosDefault={showWhenOosDefault}
      />
    </>
  );
}
