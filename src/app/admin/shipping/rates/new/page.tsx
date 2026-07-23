import { createClient } from "@/lib/supabase/server";
import ShippingRateForm from "@/components/admin/shipping/ShippingRateForm";
import type { ShippingZone } from "@/types/shipping";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Νέα χρέωση αποστολής — Admin" };
export const dynamic = "force-dynamic";

export default async function NewShippingRatePage() {
  await requirePermission("manage:shipping");
  const supabase = await createClient();
  const { data } = await supabase.from("shipping_zones").select("*").order("name");

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Νέα χρέωση αποστολής</h1>
      <ShippingRateForm mode="create" zones={(data ?? []) as ShippingZone[]} />
    </>
  );
}
