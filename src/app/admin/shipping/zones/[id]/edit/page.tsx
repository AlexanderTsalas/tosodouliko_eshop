import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ShippingZoneForm from "@/components/admin/shipping/ShippingZoneForm";
import type { ShippingZone } from "@/types/shipping";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Επεξεργασία ζώνης — Admin" };
export const dynamic = "force-dynamic";

export default async function EditShippingZonePage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  await requirePermission("manage:shipping");
  const params = await props.params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("shipping_zones")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (!data) notFound();

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Επεξεργασία ζώνης</h1>
      <ShippingZoneForm mode="edit" zone={data as ShippingZone} />
    </>
  );
}
