"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { slugifyValue } from "@/lib/variants-helpers";
import { fail, ok, type Result } from "@/types/result";
import type { AttributeValue } from "@/types/attribute-facets";

const Schema = z.object({
  attributeId: z.string().uuid(),
  /**
   * Free-form input — the action splits on commas AND newlines, trims
   * each entry, drops blanks. Lets admins paste "Red, Blue\nGreen" or
   * type "Red, Blue, Green" with the same result.
   */
  raw: z.string().min(1).max(5000),
});

interface BulkResult {
  /** Successfully created rows in the order the user typed them. */
  created: AttributeValue[];
  /** Values that were skipped because they already existed (matched by
   *  slug under this attribute). Reported back so the admin sees what
   *  was a no-op vs. what was new. */
  skipped: string[];
  /** Values that failed to insert for reasons other than "exists". */
  failed: Array<{ value: string; error: string }>;
}

/**
 * Bulk-create attribute values from a single comma/newline-separated
 * input. Why a dedicated action vs. looping createAttributeValue from
 * the client:
 *   - Single round-trip for the whole batch (N inserts in one server call)
 *   - Atomic slug-conflict resolution: we resolve display_order ONCE
 *     based on the current max, then increment locally as we insert.
 *     The client-loop approach would re-fetch max for every value.
 *   - Single audit-log entry (or summary) instead of N
 *
 * Conflict semantics: a value whose slug already exists under this
 * attribute is reported in `skipped`, not `failed`. The "bulk paste a
 * known list, ignore duplicates" UX is the dominant use case.
 */
export async function createAttributeValuesBulk(
  input: z.input<typeof Schema>
): Promise<Result<BulkResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<BulkResult>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:attributes"))) {
    return fail<BulkResult>("Forbidden", "FORBIDDEN");
  }

  // Split + trim + dedup-preserving-order. We keep the FIRST occurrence
  // of each visually distinct value the admin typed; subsequent dupes
  // in the same input fall away silently (no point reporting them).
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const piece of parsed.data.raw.split(/[,\n]+/)) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const lowerKey = trimmed.toLowerCase();
    if (seen.has(lowerKey)) continue;
    seen.add(lowerKey);
    candidates.push(trimmed);
  }
  if (candidates.length === 0) {
    return fail<BulkResult>(
      "Δώστε τουλάχιστον μία τιμή.",
      "EMPTY_INPUT"
    );
  }

  const admin = createAdminClient();

  // Resolve current max display_order for this attribute so the new
  // batch slots at the END of the existing list (preserves manual
  // ordering when admins have already curated the value list).
  const { data: maxRow } = await admin
    .from("attribute_values")
    .select("display_order")
    .eq("attribute_id", parsed.data.attributeId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextOrder =
    maxRow && typeof (maxRow as { display_order: number }).display_order === "number"
      ? Number((maxRow as { display_order: number }).display_order) + 1
      : 0;

  // Pre-fetch existing slugs under this attribute so duplicate-detection
  // doesn't need a per-value round-trip.
  const { data: existingRows } = await admin
    .from("attribute_values")
    .select("slug")
    .eq("attribute_id", parsed.data.attributeId);
  const existingSlugs = new Set(
    ((existingRows ?? []) as Array<{ slug: string }>).map((r) => r.slug)
  );

  const created: AttributeValue[] = [];
  const skipped: string[] = [];
  const failed: Array<{ value: string; error: string }> = [];

  for (const value of candidates) {
    const slug = slugifyValue(value) || "value";
    if (existingSlugs.has(slug)) {
      skipped.push(value);
      continue;
    }
    const { data: inserted, error } = await admin
      .from("attribute_values")
      .insert({
        attribute_id: parsed.data.attributeId,
        value,
        slug,
        display_order: nextOrder,
      })
      .select()
      .single();
    if (error || !inserted) {
      // 23505 = unique violation — race with another writer. Treat as skipped.
      if (error?.code === "23505") {
        skipped.push(value);
      } else {
        failed.push({ value, error: error?.message ?? "Insert failed" });
      }
      continue;
    }
    created.push(inserted as unknown as AttributeValue);
    existingSlugs.add(slug); // track within this batch to dedup against itself
    nextOrder += 1;
  }

  if (created.length > 0) {
    revalidatePath("/admin/attributes");
    updateTag("catalog-facets");
  }

  return ok({ created, skipped, failed });
}
