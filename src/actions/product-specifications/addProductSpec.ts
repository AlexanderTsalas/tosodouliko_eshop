"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { slugifyValue } from "@/lib/variants-helpers";
import { fail, ok, type Result } from "@/types/result";
import type { ProductSpecification } from "@/types/product-specifications";

const Schema = z.object({
  productId: z.string().uuid(),
  attributeId: z.string().uuid(),
  value: z.string().min(1).max(500),
  displayOrder: z.number().int().nonnegative().default(0),
});

/**
 * Adds a spec (attribute_id, value) to a product. Refuses if the same
 * attribute is already in use as a VARIANT attribute on any of the
 * product's variants — preventing the "Colour is both on the picker and
 * in the spec sheet" confusion.
 */
export async function addProductSpec(
  input: z.input<typeof Schema>
): Promise<Result<ProductSpecification>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<ProductSpecification>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<ProductSpecification>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // Resolve the attribute's slug — we'll use it to check for variant-attribute collision.
  const { data: attrRow } = await supabase
    .from("attributes")
    .select("id, slug, name")
    .eq("id", parsed.data.attributeId)
    .maybeSingle();
  if (!attrRow) {
    return fail<ProductSpecification>("Attribute not found", "NOT_FOUND");
  }
  const attr = attrRow as { id: string; slug: string; name: string };

  // Collision guard: if ANY variant of this product uses this attribute in
  // its attribute_combo, refuse — the admin should pick one role per
  // (product, attribute).
  const { data: variants } = await supabase
    .from("product_variants")
    .select("attribute_combo")
    .eq("product_id", parsed.data.productId);

  const collides = ((variants ?? []) as Array<{ attribute_combo: Record<string, string> | null }>).some(
    (v) => v.attribute_combo && v.attribute_combo[attr.slug] !== undefined
  );
  if (collides) {
    return fail<ProductSpecification>(
      `«${attr.name}» χρησιμοποιείται ήδη ως χαρακτηριστικό παραλλαγής σε αυτό το προϊόν. Δεν μπορεί να είναι ταυτόχρονα και προδιαγραφή.`,
      "VARIANT_ATTRIBUTE_COLLISION"
    );
  }

  const { data, error } = await supabase
    .from("product_specifications")
    .insert({
      product_id: parsed.data.productId,
      attribute_id: parsed.data.attributeId,
      value: parsed.data.value,
      display_order: parsed.data.displayOrder,
    })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return fail<ProductSpecification>(
        "Αυτή η προδιαγραφή υπάρχει ήδη — διορθώστε την υπάρχουσα τιμή αντί να προσθέσετε νέα.",
        "DUPLICATE_SPEC"
      );
    }
    return fail<ProductSpecification>(error?.message ?? "Insert failed", error?.code);
  }

  // Side-effect: ensure the value exists in attribute_values too. Specs
  // store their value as plain text on product_specifications, but for
  // the value to ALSO appear on /admin/attributes (so admins can see
  // and reuse it across products) it needs a row in attribute_values.
  // We upsert by (attribute_id, slug) — if the value already exists,
  // this is a no-op; otherwise it's created with display_order = next.
  // Failure here is non-fatal: the spec itself was saved successfully,
  // we just won't have populated the attribute_values mirror. The
  // log_audit_event below records both outcomes.
  // Race-safe upsert (Phase 9 of the data-layer remediation). The
  // pre-Phase-9 pattern did "SELECT exists?" then INSERT, which let
  // two concurrent admins both see "doesn't exist" then race on the
  // INSERT (one got UNIQUE violation). Now: single UPSERT against the
  // uq_attribute_values_slug_per_attribute index with
  // ignoreDuplicates — concurrent attempts both succeed but only one
  // creates the row, the other is a silent no-op.
  //
  // Display_order is computed from the current max via a separate
  // SELECT before the upsert. A race here can still produce two
  // values sharing a display_order (UI sort hint only, not a
  // correctness invariant) — admins can fix via the order field on
  // the attribute_values surface.
  const valueSlug = slugifyValue(parsed.data.value) || "value";
  const { data: maxRow } = await supabase
    .from("attribute_values")
    .select("display_order")
    .eq("attribute_id", parsed.data.attributeId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = maxRow
    ? Number((maxRow as { display_order: number }).display_order) + 1
    : 0;
  const { data: avData, error: avErr } = await supabase
    .from("attribute_values")
    .upsert(
      {
        attribute_id: parsed.data.attributeId,
        value: parsed.data.value,
        slug: valueSlug,
        display_order: nextOrder,
      },
      { onConflict: "attribute_id,slug", ignoreDuplicates: true }
    )
    .select("id");
  const attrValueCreated = !avErr && (avData ?? []).length > 0;

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "product_spec.added",
      resource_type: "product",
      resource_id: parsed.data.productId,
      metadata: {
        attribute_slug: attr.slug,
        value: parsed.data.value,
        attribute_value_created: attrValueCreated,
      },
    });
  }

  revalidatePath("/admin/products");
  revalidatePath("/admin/attributes");
  revalidatePath("/products");
  // Cache tag used by storefront facets — value list changes invalidate it.
  if (attrValueCreated) updateTag("catalog-facets");
  return ok(data as unknown as ProductSpecification);
}
