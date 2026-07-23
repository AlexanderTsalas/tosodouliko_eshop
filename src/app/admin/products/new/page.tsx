import AdminPageHeader from "@/components/admin/common/AdminPageHeader";
import ProductCreateClient from "@/components/admin/products/ProductCreateClient";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Category } from "@/types/category-navigation";
import type { VolumetricPrefix } from "@/types/volumetric";
import type { VatRate } from "@/types/vat-rates";
import type { Supplier } from "@/types/suppliers";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Νέο προϊόν — Admin" };
export const dynamic = "force-dynamic";

/**
 * Product create page. The form mirrors the edit page section-by-section
 * (Βασικά, Τιμολόγηση, Logistics, Ορατότητα, Κατηγορίες) so admins see
 * exactly the same fields in the same order — no surprises after they
 * land on the edit page post-creation. Same data sources too:
 * categories + volumetric prefixes + the global show_when_oos default.
 */
export default async function NewProductPage() {
  await requirePermission("manage:products");
  const admin = createAdminClient();
  // Parallel fetch — same sources the edit page uses for the same
  // sections, so the form has identical option sets / fallbacks.
  const [catRes, vpRes, settingsRes, vatRes, supRes, attrRes, attrValRes] =
    await Promise.all([
    admin
      .from("categories")
      .select("*")
      .eq("active", true)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true }),
    admin
      .from("volumetric_prefixes")
      .select("*")
      .eq("active", true)
      .order("display_order", { ascending: true })
      .order("display_name", { ascending: true }),
    admin
      .from("storefront_settings")
      .select("show_when_oos_default")
      .eq("id", 1)
      .maybeSingle(),
    // Mirror the edit page's vat_rates fetch — the create form's
    // pricing section now exposes the same VAT picker so admins can
    // categorize at creation time instead of waiting until edit.
    admin.from("vat_rates").select("*").order("rate"),
    // Active suppliers — surfaced in the "Initial supplier" section
    // so the admin can link a supplier + unit cost at creation time.
    // Empty array = the section is hidden (admin assigns suppliers
    // post-creation via the Suppliers section in edit).
    admin.from("suppliers").select("*").eq("active", true).order("name"),
    // Attributes + attribute_values catalog — feeds the Variants
    // section's axis picker. Without these the admin can't stage
    // any axes (Color, Size, etc.) at create time. New attributes/
    // values can also be created inline; the local mirrors inside
    // ProductForm append them so subsequent picks see the updated
    // catalog without a router.refresh.
    admin.from("attributes").select("*").order("name"),
    admin
      .from("attribute_values")
      .select("*")
      .order("display_order", { ascending: true })
      .order("value", { ascending: true }),
  ]);
  const categories = (catRes.data ?? []) as Category[];
  const volumetricPrefixes = (vpRes.data ?? []) as VolumetricPrefix[];
  const vatRates = (vatRes.data ?? []) as VatRate[];
  const suppliers = (supRes.data ?? []) as Supplier[];
  const attributes = (attrRes.data ?? []) as Attribute[];
  const attributeValues = (attrValRes.data ?? []) as AttributeValue[];
  const globalShowWhenOosDefault = Boolean(
    (settingsRes.data as { show_when_oos_default: boolean } | null)
      ?.show_when_oos_default
  );

  return (
    <>
      <AdminPageHeader
        backHref="/admin/products"
        backLabel="Όλα τα προϊόντα"
        title="Νέο προϊόν"
        subtitle={
          <span className="max-w-2xl block">
            Όλα τα βασικά στοιχεία σε ένα βήμα — οι ίδιες ενότητες με τη
            σελίδα επεξεργασίας. Μετά τη δημιουργία θα μεταφερθείτε στις
            παραλλαγές για να ορίσετε άξονες (χρώμα, μέγεθος κ.λπ.) και να
            αναθέσετε προμηθευτές με κόστος.
          </span>
        }
      />
      <ProductCreateClient
        categories={categories}
        suppliers={suppliers}
        attributes={attributes}
        attributeValues={attributeValues}
        volumetricPrefixes={volumetricPrefixes}
        vatRates={vatRates}
        globalShowWhenOosDefault={globalShowWhenOosDefault}
      />
    </>
  );
}
