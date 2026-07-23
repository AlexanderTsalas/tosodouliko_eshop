import SupplierForm from "@/components/admin/suppliers/SupplierForm";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Νέος προμηθευτής — Admin" };
export const dynamic = "force-dynamic";

export default async function NewSupplierPage(
  props: {
    searchParams: Promise<{ returnTo?: string }>;
  }
) {
  await requirePermission("manage:suppliers");
  const searchParams = await props.searchParams;
  // Deep-link return URL — e.g. when the admin clicks "+ Νέος προμηθευτής"
  // from a product page, returnTo carries the product's edit URL so we
  // can redirect back after the supplier is created. SupplierForm
  // sanity-checks the value (relative URLs only) before redirecting.
  const returnTo = searchParams.returnTo;

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Νέος προμηθευτής</h1>
      <SupplierForm mode="create" returnTo={returnTo} />
    </>
  );
}
