import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import AdminPageHeader from "@/components/admin/common/AdminPageHeader";
import CustomFieldsLibraryBench from "@/components/admin/custom-fields/CustomFieldsLibraryBench";
import CustomFieldsBenchStaticChrome from "@/components/admin/custom-fields/CustomFieldsBenchStaticChrome";
import type {
  CustomField,
  CustomFieldValue,
  CustomFieldGroup,
  CustomFieldGroupMember,
  CustomFieldBinding,
  CustomFieldWithValues,
  CustomFieldGroupWithFields,
  ResolvedCustomFieldBinding,
} from "@/types/custom-fields";
import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Πεδία πελάτη — Admin" };
export const dynamic = "force-dynamic";

/**
 * Custom Fields library — three-column bench, refactored to the
 * "chrome first, data streams in" pattern.
 *
 * The page handler runs only the permission check and returns chrome
 * immediately: the AdminPageHeader, and a Suspense boundary whose
 * fallback is <CustomFieldsBenchStaticChrome />. The 8-query bulk
 * fetch + in-memory composite-shape building lives in
 * <CustomFieldsBenchData />.
 *
 * The sibling loading.tsx renders the SAME chrome — header +
 * CustomFieldsBenchStaticChrome — so the navigation gap and data
 * gap both show identical structure. Only the card contents change
 * when data arrives.
 */
export default async function AdminCustomFieldsPage() {
  await requirePermission("manage:products");

  return (
    <>
      <AdminPageHeader
        title="Πεδία πελάτη"
        subtitle={
          <span className="max-w-2xl block">
            Δημιουργήστε επαναχρησιμοποιήσιμα πεδία (μήνυμα δώρου, στυλ
            χάραξης, μέτρα κ.λπ.) που γεμίζει ο πελάτης πριν την αγορά.
            Ομαδοποιήστε τα και συνδέστε τα σε κατηγορίες, προϊόντα ή
            παραλλαγές.
          </span>
        }
      />
      <Suspense fallback={<CustomFieldsBenchStaticChrome />}>
        <CustomFieldsBenchData />
      </Suspense>
    </>
  );
}

async function CustomFieldsBenchData() {
  const admin = createAdminClient();

  // Parallel fetch of the entire library + bindings layer plus the
  // scope-target lookups (categories / products / variants) so the
  // binding modal can render name-based pickers instead of raw UUIDs.
  const [
    fieldsRes,
    valuesRes,
    groupsRes,
    membersRes,
    bindingsRes,
    categoriesRes,
    productsRes,
    variantsRes,
  ] = await Promise.all([
    admin
      .from("custom_fields")
      .select("*")
      .order("created_at", { ascending: false }),
    admin.from("custom_field_values").select("*").order("sort_order"),
    admin
      .from("custom_field_groups")
      .select("*")
      .order("created_at", { ascending: false }),
    admin
      .from("custom_field_group_members")
      .select("*")
      .order("sort_order"),
    admin
      .from("custom_field_bindings")
      .select("*")
      .order("created_at", { ascending: false }),
    admin
      .from("categories")
      .select("id, name")
      .eq("active", true)
      .order("display_order"),
    admin
      .from("products")
      .select("id, name")
      .eq("active", true)
      .order("name"),
    admin
      .from("product_variants")
      .select("id, sku, product_id, products(name)")
      .eq("is_active", true)
      .order("sku"),
  ]);

  const fields = (fieldsRes.data ?? []) as CustomField[];
  const values = (valuesRes.data ?? []) as CustomFieldValue[];
  const groups = (groupsRes.data ?? []) as CustomFieldGroup[];
  const members = (membersRes.data ?? []) as CustomFieldGroupMember[];
  const bindings = (bindingsRes.data ?? []) as CustomFieldBinding[];

  // ─── Build composite shapes for the bench ────────────────────────
  const valuesByField: Record<string, CustomFieldValue[]> = {};
  for (const v of values) {
    (valuesByField[v.field_id] ??= []).push(v);
  }

  const fieldById = new Map<string, CustomFieldWithValues>();
  const fieldsWithValues: CustomFieldWithValues[] = fields.map((f) => {
    const wv: CustomFieldWithValues = {
      ...f,
      values: valuesByField[f.id] ?? [],
    };
    fieldById.set(f.id, wv);
    return wv;
  });

  const membersByGroup: Record<string, CustomFieldGroupMember[]> = {};
  for (const m of members) {
    (membersByGroup[m.group_id] ??= []).push(m);
  }
  const groupsWithFields: CustomFieldGroupWithFields[] = groups.map((g) => ({
    ...g,
    members: (membersByGroup[g.id] ?? [])
      .map((m) => {
        const field = fieldById.get(m.field_id);
        if (!field) return null;
        return { sort_order: m.sort_order, field };
      })
      .filter(
        (x): x is { sort_order: number; field: CustomFieldWithValues } =>
          x !== null
      ),
  }));
  const groupById = new Map(groupsWithFields.map((g) => [g.id, g]));

  // Resolve each binding: attach either field or group (never both).
  const resolvedBindings: ResolvedCustomFieldBinding[] = bindings
    .map((b): ResolvedCustomFieldBinding | null => {
      if (b.field_id) {
        const f = fieldById.get(b.field_id);
        if (!f) return null;
        return { ...b, field: f, group: null };
      }
      if (b.group_id) {
        const g = groupById.get(b.group_id);
        if (!g) return null;
        return { ...b, field: null, group: g };
      }
      return null;
    })
    .filter((x): x is ResolvedCustomFieldBinding => x !== null);

  // No fade-in wrapper here: see /admin/discounts/page.tsx for the
  // same reasoning — the static chrome (CustomFieldsBenchStaticChrome)
  // and the live bench are designed to look visually identical at
  // the swap moment.
  return (
    <CustomFieldsLibraryBench
      fields={fieldsWithValues}
      groups={groupsWithFields}
      bindings={resolvedBindings}
      categories={
        (categoriesRes.data ?? []) as Array<{ id: string; name: string }>
      }
      products={
        (productsRes.data ?? []) as Array<{ id: string; name: string }>
      }
      variants={(
        (variantsRes.data ?? []) as Array<{
          id: string;
          sku: string;
          product_id: string;
          products: { name: string } | { name: string }[] | null;
        }>
      ).map((v) => ({
        id: v.id,
        sku: v.sku,
        product_id: v.product_id,
        product_name:
          (Array.isArray(v.products) ? v.products[0] : v.products)?.name ??
          "(unknown)",
      }))}
    />
  );
}
