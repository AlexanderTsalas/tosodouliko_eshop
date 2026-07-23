import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CategoryForm from "@/components/admin/categories/CategoryForm";
import type { Category } from "@/types/category-navigation";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";
import type { VatRate } from "@/types/vat-rates";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Επεξεργασία κατηγορίας — Admin" };
export const dynamic = "force-dynamic";

export default async function EditCategoryPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  await requirePermission("manage:categories");
  const params = await props.params;
  const supabase = await createClient();
  const [
    { data: category },
    { data: all },
    { data: attrs },
    { data: vals },
    { data: rates },
  ] = await Promise.all([
    supabase.from("categories").select("*").eq("id", params.id).maybeSingle(),
    supabase.from("categories").select("*").order("name"),
    supabase.from("attributes").select("*").order("name"),
    supabase.from("attribute_values").select("*").order("display_order"),
    supabase.from("vat_rates").select("*").order("rate"),
  ]);

  if (!category) notFound();

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Επεξεργασία κατηγορίας</h1>
      <CategoryForm
        mode="edit"
        category={category as Category}
        parents={(all ?? []) as Category[]}
        attributes={(attrs ?? []) as Attribute[]}
        attributeValues={(vals ?? []) as AttributeValue[]}
        vatRates={(rates ?? []) as VatRate[]}
      />
    </>
  );
}
