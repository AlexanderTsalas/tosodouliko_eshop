import ShippingZoneForm from "@/components/admin/shipping/ShippingZoneForm";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Νέα ζώνη — Admin" };
export const dynamic = "force-dynamic";

export default async function NewShippingZonePage() {
  await requirePermission("manage:shipping");
  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Νέα ζώνη αποστολής</h1>
      <ShippingZoneForm mode="create" />
    </>
  );
}
