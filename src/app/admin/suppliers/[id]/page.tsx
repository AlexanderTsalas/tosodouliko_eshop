import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SupplierForm from "@/components/admin/suppliers/SupplierForm";
import SupplierDeleteButton from "@/components/admin/suppliers/SupplierDeleteButton";
import type { Supplier } from "@/types/suppliers";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Επεξεργασία προμηθευτή — Admin" };
export const dynamic = "force-dynamic";

export default async function EditSupplierPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  await requirePermission("manage:suppliers");
  const params = await props.params;
  const supabase = await createClient();
  const [{ data: supplier }, { count: orderCount }] = await Promise.all([
    supabase.from("suppliers").select("*").eq("id", params.id).maybeSingle(),
    supabase
      .from("supply_orders")
      .select("id", { count: "exact", head: true })
      .eq("supplier_id", params.id),
  ]);

  if (!supplier) notFound();

  return (
    <>
      <Link href="/admin/suppliers" className="btn btn-secondary btn-sm mb-4">
        ← Όλοι οι προμηθευτές
      </Link>
      <header className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{(supplier as Supplier).name}</h1>
          <p className="text-xs text-muted-foreground">
            {orderCount ?? 0} ιστορικές παραγγελίες
          </p>
        </div>
        <SupplierDeleteButton id={(supplier as Supplier).id} />
      </header>

      <SupplierForm mode="edit" supplier={supplier as Supplier} />
    </>
  );
}
