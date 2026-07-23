"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { RelatedProductsAssociation } from "@/types/related-products";

const Schema = z.object({
  name: z.string().min(1).max(200),
  message_title_translations: z
    .record(z.string(), z.string().max(200))
    .default({}),
  active: z.boolean().default(true),
  /** 1 = topmost on the page. Resolver sorts ASC. */
  display_order: z.number().int().min(1).default(1),
  /** When true, also fire the association from the reverse direction. */
  bidirectional: z.boolean().default(false),
  exclude_oos: z.boolean().default(true),
  selection_strategy: z
    .enum(["random", "recent", "manual"])
    .default("random"),
  max_results: z.number().int().min(1).max(24).default(6),
  card_granularity: z.enum(["product", "variant"]).default("product"),
});

/**
 * Creates a related-products association — the carousel definition.
 * Filter groups + conditions are added separately via the 9c actions;
 * a brand-new association renders nothing on the storefront until at
 * least one source-side condition exists.
 */
export async function createRelatedProductsAssociation(
  input: z.input<typeof Schema>
): Promise<Result<RelatedProductsAssociation>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<RelatedProductsAssociation>(
      "Invalid input: " + parsed.error.issues[0]?.message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<RelatedProductsAssociation>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<RelatedProductsAssociation>(
      "Not authenticated",
      "UNAUTHENTICATED"
    );
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("related_products_associations")
    .insert({
      name: parsed.data.name,
      message_title_translations: parsed.data.message_title_translations,
      active: parsed.data.active,
      display_order: parsed.data.display_order,
      bidirectional: parsed.data.bidirectional,
      exclude_oos: parsed.data.exclude_oos,
      selection_strategy: parsed.data.selection_strategy,
      max_results: parsed.data.max_results,
      card_granularity: parsed.data.card_granularity,
      created_by: authData.user.id,
    })
    .select()
    .single();

  if (error || !row) {
    return fail<RelatedProductsAssociation>(
      "Failed to create association: " + error?.message,
      error?.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "related_products_association.created",
    resource_type: "related_products_association",
    resource_id: (row as RelatedProductsAssociation).id,
    metadata: {
      name: parsed.data.name,
      strategy: parsed.data.selection_strategy,
    },
  });

  revalidatePath("/admin/related-products");
  return ok(row as RelatedProductsAssociation);
}
