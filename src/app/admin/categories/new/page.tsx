import { createClient } from "@/lib/supabase/server";
import CategoryForm from "@/components/admin/categories/CategoryForm";
import type { Category } from "@/types/category-navigation";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";
import type { VatRate } from "@/types/vat-rates";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Νέα κατηγορία — Admin" };
export const dynamic = "force-dynamic";

export default async function NewCategoryPage() {
  await requirePermission("manage:categories");
  const supabase = await createClient();
  const [{ data: cats }, { data: attrs }, { data: vals }, { data: rates }] =
    await Promise.all([
      supabase.from("categories").select("*").order("name"),
      supabase.from("attributes").select("*").order("name"),
      supabase.from("attribute_values").select("*").order("display_order"),
      supabase.from("vat_rates").select("*").order("rate"),
    ]);

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Νέα κατηγορία</h1>
      <CategoryForm
        mode="create"
        parents={(cats ?? []) as Category[]}
        attributes={(attrs ?? []) as Attribute[]}
        attributeValues={(vals ?? []) as AttributeValue[]}
        vatRates={(rates ?? []) as VatRate[]}
      />
    </>
  );
}
