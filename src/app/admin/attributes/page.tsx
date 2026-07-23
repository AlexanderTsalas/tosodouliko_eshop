import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import AttributesManager from "@/components/admin/attributes/AttributesManager";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Χαρακτηριστικά — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminAttributesPage() {
  await requirePermission("manage:attributes");
  const admin = createAdminClient();

  // Fetch attributes + values + the usage data needed to split them
  // into "variant attributes" vs "spec-only attributes":
  // The attribute_usage view computes is_variant_axis +
  // is_spec per attribute in SQL via EXISTS subqueries — replaces a
  // full table scan of product_variants.attribute_combo + a full scan
  // of product_specifications. Two queries instead of four; aggregates
  // happen on the DB side.
  const [usageRes, valsRes] = await Promise.all([
    admin
      .from("attribute_usage")
      .select("attribute_id, name, slug, type, created_at, is_variant_axis, is_spec, value_count")
      .order("name"),
    admin.from("attribute_values").select("*").order("display_order"),
  ]);

  const allValues = (valsRes.data ?? []) as AttributeValue[];

  type UsageRow = {
    attribute_id: string;
    name: string;
    slug: string;
    type: string;
    created_at: string;
    is_variant_axis: boolean;
    is_spec: boolean;
    value_count: number;
  };
  const usage = (usageRes.data ?? []) as UsageRow[];

  // Map view rows back into the Attribute shape the AttributesManager
  // consumes. The view's attribute_id maps to Attribute.id.
  const toAttribute = (u: UsageRow): Attribute =>
    ({
      id: u.attribute_id,
      name: u.name,
      slug: u.slug,
      type: u.type,
      created_at: u.created_at,
    }) as Attribute;

  // Split: variant attributes = anything used as an axis. Spec-only =
  // attributes that have NEVER been used as a variant axis. We don't
  // hide unused attributes from the spec-only list because they're
  // available candidates for specs going forward.
  const variantAttributes = usage.filter((u) => u.is_variant_axis).map(toAttribute);
  const specOnlyAttributes = usage.filter((u) => !u.is_variant_axis).map(toAttribute);

  return (
    <>
      <PageHeader
        title="Χαρακτηριστικά"
        description="Ορίστε τύπους χαρακτηριστικών (π.χ. Colour, Size, Flavour) και τις τιμές τους. Οι παραλλαγές προϊόντων επιλέγουν από τα χαρακτηριστικά παραλλαγών· οι προδιαγραφές προϊόντος από όλα τα υπόλοιπα."
      />

      {/* The AttributesManager component renders its own cms-card-section
          wrapper with header (variant or spec depending on `scope`), so
          no outer wrappers needed here — just stack the two sections. */}
      <div className="space-y-6">
        <AttributesManager
          initialAttributes={variantAttributes}
          initialValues={allValues}
          scope="variant"
        />
        <AttributesManager
          initialAttributes={specOnlyAttributes}
          initialValues={allValues}
          scope="spec"
        />
      </div>
    </>
  );
}
