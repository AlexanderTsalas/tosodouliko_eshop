import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ShippingRateForm from "@/components/admin/shipping/ShippingRateForm";
import type { ShippingRate, ShippingZone } from "@/types/shipping";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Επεξεργασία χρέωσης αποστολής — Admin" };
export const dynamic = "force-dynamic";

export default async function EditShippingRatePage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  await requirePermission("manage:shipping");
  const params = await props.params;
  const supabase = await createClient();
  const [{ data: rate }, { data: zones }] = await Promise.all([
    supabase.from("shipping_rates").select("*").eq("id", params.id).maybeSingle(),
    supabase.from("shipping_zones").select("*").order("name"),
  ]);

  if (!rate) notFound();

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Επεξεργασία χρέωσης αποστολής</h1>
      <ShippingRateForm
        mode="edit"
        rate={rate as ShippingRate}
        zones={(zones ?? []) as ShippingZone[]}
      />
    </>
  );
}
