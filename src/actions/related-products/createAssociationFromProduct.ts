"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  product_id: z.string().uuid(),
});

/**
 * Convenience action launched from the product editor's "Συνδέσεις
 * προτεινόμενων" tab. In one transactional shot:
 *
 *   1. Creates an association named "Συσχέτιση για <product>"
 *   2. Creates a source filter group on it
 *   3. Adds a `product` condition pinned to this exact product (the Q4
 *      "EXACT product" lock — admin can broaden later by adding
 *      category/attribute conditions next to it or in OR groups)
 *
 * Returns the new association's id so the caller can redirect to
 * `/admin/related-products?expand=<id>` and the bench auto-opens its
 * inline editor for further configuration.
 */
export async function createAssociationFromProduct(
  input: z.input<typeof Schema>
): Promise<Result<{ association_id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ association_id: string }>(
      "Invalid input",
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<{ association_id: string }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ association_id: string }>(
      "Not authenticated",
      "UNAUTHENTICATED"
    );
  }

  const admin = createAdminClient();

  // Look up the product name so the auto-generated association name
  // is meaningful in the workshop list.
  const { data: prod } = await admin
    .from("products")
    .select("name")
    .eq("id", parsed.data.product_id)
    .maybeSingle();
  const productName = (prod as { name: string } | null)?.name ?? "προϊόν";

  // 1. Create the association (inactive by default — admin completes
  //    the target side before activating).
  const { data: assocRow, error: assocErr } = await admin
    .from("related_products_associations")
    .insert({
      name: `Συσχέτιση για «${productName}»`,
      message_title_translations: {},
      active: false,
      display_order: 1,
      bidirectional: false,
      exclude_oos: true,
      selection_strategy: "random",
      max_results: 6,
      card_granularity: "product",
      created_by: authData.user.id,
    })
    .select("id")
    .single();
  if (assocErr || !assocRow) {
    return fail<{ association_id: string }>(
      "Failed to create association: " + assocErr?.message,
      assocErr?.code
    );
  }
  const associationId = (assocRow as { id: string }).id;

  // 2. Create the source filter group.
  const { data: groupRow, error: groupErr } = await admin
    .from("related_products_filter_groups")
    .insert({
      association_id: associationId,
      side: "source",
      sort_order: 0,
    })
    .select("id")
    .single();
  if (groupErr || !groupRow) {
    // Best-effort cleanup: roll back the association so we don't leak
    // orphaned rows. The bench is keyed off active associations so a
    // dangling inactive one is harmless either way.
    await admin
      .from("related_products_associations")
      .delete()
      .eq("id", associationId);
    return fail<{ association_id: string }>(
      "Failed to create source group: " + groupErr?.message,
      groupErr?.code
    );
  }
  const groupId = (groupRow as { id: string }).id;

  // 3. Add the product condition.
  const { error: condErr } = await admin
    .from("related_products_filter_conditions")
    .insert({
      filter_group_id: groupId,
      kind: "product",
      config: { product_id: parsed.data.product_id },
      negate: false,
      sort_order: 0,
    });
  if (condErr) {
    await admin
      .from("related_products_associations")
      .delete()
      .eq("id", associationId);
    return fail<{ association_id: string }>(
      "Failed to create source condition: " + condErr.message,
      condErr.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "related_products_association.created",
    resource_type: "related_products_association",
    resource_id: associationId,
    metadata: { from_product: parsed.data.product_id },
  });

  revalidatePath("/admin/related-products");
  return ok({ association_id: associationId });
}
