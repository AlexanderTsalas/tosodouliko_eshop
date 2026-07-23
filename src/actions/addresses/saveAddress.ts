"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { Address } from "@/types/address-book";

const Schema = z.object({
  /** Pass to update an existing address; omit to create. */
  id: z.string().uuid().optional(),
  label: z.string().trim().max(120).nullable().optional(),
  first_name: z.string().trim().min(1).max(120),
  last_name: z.string().trim().min(1).max(120),
  address_line1: z.string().trim().min(1).max(300),
  address_line2: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().max(120).nullable().optional(),
  postal_code: z.string().trim().min(1).max(20),
  country_code: z.string().trim().length(2),
  phone: z.string().trim().max(40).nullable().optional(),
  is_default_shipping: z.boolean().optional(),
  is_default_billing: z.boolean().optional(),
});

type SaveOutcome =
  | { outcome: "created"; address: Address }
  | { outcome: "updated"; address: Address }
  | { outcome: "already_exists"; address: Address };

/**
 * Normalize a string for the dedup comparison. Lowercase, trim, collapse runs
 * of whitespace, strip leading/trailing punctuation. Used app-side only —
 * mirrors how a user would visually consider two addresses "the same".
 */
function norm(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s.,]+|[\s.,]+$/g, "")
    .trim();
}

/**
 * Customer-side address upsert.
 *
 * - When `id` is provided: updates that address (ownership verified). No
 *   dedup check; the customer is editing a known row.
 * - When `id` is omitted: dedup-then-insert. We look at all existing
 *   addresses for the same customer and compare normalized
 *   address_line1 + postal_code + country_code. An exact match (likely the
 *   same physical address) short-circuits to `already_exists` and returns
 *   the existing row — no duplicate inserted. Different normalized fields →
 *   genuine new address → INSERT.
 *
 * The "default shipping" / "default billing" flags are honored on save; the
 * existing DB trigger `ensure_single_default_address` (rewritten to scope by
 * customer_id in the customers migration) flips other rows automatically.
 */
export async function saveAddress(
  input: z.input<typeof Schema>
): Promise<Result<SaveOutcome>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<SaveOutcome>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<SaveOutcome>("Not authenticated", "UNAUTHENTICATED");
  const userId = authData.user.id;

  // Resolve the caller's customer row (auto-created on signup via trigger).
  const admin = createAdminClient();
  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) {
    return fail<SaveOutcome>("Λείπει το προφίλ πελάτη.", "NO_CUSTOMER");
  }

  // -------------------------------------------------------------------------
  // UPDATE path
  // -------------------------------------------------------------------------
  if (parsed.data.id) {
    // Ownership check before update.
    const { data: existingRow } = await admin
      .from("addresses")
      .select("id, customer_id")
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (!existingRow) return fail<SaveOutcome>("Address not found", "NOT_FOUND");
    if ((existingRow as { customer_id: string }).customer_id !== customerId) {
      return fail<SaveOutcome>("Forbidden", "FORBIDDEN");
    }

    const updatePayload = {
      label: parsed.data.label ?? null,
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
      address_line1: parsed.data.address_line1,
      address_line2: parsed.data.address_line2 ?? null,
      city: parsed.data.city,
      state: parsed.data.state ?? null,
      postal_code: parsed.data.postal_code,
      country_code: parsed.data.country_code.toUpperCase(),
      phone: parsed.data.phone ?? null,
      is_default_shipping: parsed.data.is_default_shipping ?? undefined,
      is_default_billing: parsed.data.is_default_billing ?? undefined,
    };

    const { data: updated, error: updateErr } = await admin
      .from("addresses")
      .update(updatePayload)
      .eq("id", parsed.data.id)
      .select("*")
      .single();
    if (updateErr || !updated) {
      return fail<SaveOutcome>(updateErr?.message ?? "Update failed", updateErr?.code);
    }
    await logAuditEvent({
      actor_id: userId,
      actor_type: "user",
      action: "address.updated",
      resource_type: "address",
      resource_id: parsed.data.id,
      metadata: { customer_id: customerId },
    });
    revalidatePath("/account/addresses");
    revalidatePath("/checkout");
    return ok({ outcome: "updated", address: updated as Address });
  }

  // -------------------------------------------------------------------------
  // CREATE path with dedup
  // -------------------------------------------------------------------------

  // Pull all addresses for this customer and check for an existing match
  // BEFORE inserting. Cheap — customers typically have under 10 addresses.
  const { data: existingList } = await admin
    .from("addresses")
    .select("*")
    .eq("customer_id", customerId);
  const existing = (existingList ?? []) as Address[];

  const inputLine1Norm = norm(parsed.data.address_line1);
  const inputPostalNorm = norm(parsed.data.postal_code);
  const inputCountry = parsed.data.country_code.toUpperCase();

  const match = existing.find(
    (a) =>
      norm(a.address_line1) === inputLine1Norm &&
      norm(a.postal_code) === inputPostalNorm &&
      a.country_code === inputCountry
  );

  if (match) {
    // Don't insert; let the caller surface "this address already exists".
    // Optionally still bump the default flags if they were requested and
    // weren't already set — keeps the silent merge useful instead of inert.
    const patch: Record<string, unknown> = {};
    if (parsed.data.is_default_shipping && !match.is_default_shipping) {
      patch.is_default_shipping = true;
    }
    if (parsed.data.is_default_billing && !match.is_default_billing) {
      patch.is_default_billing = true;
    }
    if (Object.keys(patch).length > 0) {
      const { data: bumped } = await admin
        .from("addresses")
        .update(patch)
        .eq("id", match.id)
        .select("*")
        .single();
      if (bumped) {
        await logAuditEvent({
          actor_id: userId,
          actor_type: "user",
          action: "address.dedup_match_updated_defaults",
          resource_type: "address",
          resource_id: match.id,
          metadata: { customer_id: customerId, patch: Object.keys(patch) },
        });
        revalidatePath("/account/addresses");
        revalidatePath("/checkout");
        return ok({ outcome: "already_exists", address: bumped as Address });
      }
    }
    return ok({ outcome: "already_exists", address: match });
  }

  // Genuine new address — insert.
  const insertPayload = {
    customer_id: customerId,
    label: parsed.data.label ?? null,
    first_name: parsed.data.first_name,
    last_name: parsed.data.last_name,
    address_line1: parsed.data.address_line1,
    address_line2: parsed.data.address_line2 ?? null,
    city: parsed.data.city,
    state: parsed.data.state ?? null,
    postal_code: parsed.data.postal_code,
    country_code: parsed.data.country_code.toUpperCase(),
    phone: parsed.data.phone ?? null,
    is_default_shipping: parsed.data.is_default_shipping ?? false,
    is_default_billing: parsed.data.is_default_billing ?? false,
  };
  const { data: created, error: createErr } = await admin
    .from("addresses")
    .insert(insertPayload)
    .select("*")
    .single();
  if (createErr || !created) {
    return fail<SaveOutcome>(createErr?.message ?? "Insert failed", createErr?.code);
  }

  await logAuditEvent({
    actor_id: userId,
    actor_type: "user",
    action: "address.created",
    resource_type: "address",
    resource_id: (created as Address).id,
    metadata: { customer_id: customerId },
  });

  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
  return ok({ outcome: "created", address: created as Address });
}
