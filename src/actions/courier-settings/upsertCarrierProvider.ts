"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { encryptCarrierSecret } from "@/lib/courier/encryption";
import { fail, ok, type Result } from "@/types/result";
import type { CarrierProviderConfig } from "@/types/carrier-provider";

const AcsConfigSchema = z.object({
  base_url: z.string().url().optional(),
  sender_name: z.string().trim().min(1).max(120),
  billing_code: z.string().trim().min(1).max(40),
  origin_station: z
    .string()
    .trim()
    .min(1)
    .max(8)
    .transform((s) => s.toUpperCase()),
  default_charge_type: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  language: z.enum(["EN", "GR"]).optional(),
});

const AcsSecretsSchema = z.object({
  api_key: z.string().min(1).max(500),
  company_id: z.string().min(1).max(100),
  company_password: z.string().min(1).max(200),
  user_id: z.string().min(1).max(100),
  user_password: z.string().min(1).max(200),
});

const BoxNowConfigSchema = z.object({
  base_url: z.string().url().optional(),
  partner_id: z.string().trim().min(1).max(100),
  origin_location_id: z.string().trim().min(1).max(100),
  default_parcel_size: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .optional(),
});

const BoxNowSecretsSchema = z.object({
  client_id: z.string().min(1).max(200),
  client_secret: z.string().min(1).max(500),
});

const GenikiConfigSchema = z.object({
  base_url: z.string().url().optional(),
  language: z.enum(["GR", "EN"]).optional(),
});

const GenikiSecretsSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

const Schema = z.object({
  id: z.string().uuid().optional(),
  carrier: z.enum(["acs", "elta", "box_now", "speedex", "geniki", "other"]),
  display_name: z.string().trim().min(1).max(120),
  config: z.record(z.unknown()),
  /**
   * Plaintext secrets (JSON-serializable object). Optional on update — when
   * absent, the existing ciphertext is preserved. Always required on insert.
   */
  secrets: z.record(z.unknown()).optional(),
  is_active: z.boolean().optional(),
});

/**
 * Create-or-update a carrier provider configuration. ACS config and secrets
 * are validated against AcsConfigSchema / AcsSecretsSchema; other carriers
 * pass through (their schemas land in later phases). Activating a row in the
 * same call is supported via `is_active=true`; the unique partial index in
 * the migration enforces at-most-one-active-per-carrier.
 */
export async function upsertCarrierProvider(
  input: z.input<typeof Schema>
): Promise<Result<CarrierProviderConfig>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<CarrierProviderConfig>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:couriers"))) {
    return fail<CarrierProviderConfig>("Forbidden", "FORBIDDEN");
  }

  // Carrier-specific config validation.
  if (parsed.data.carrier === "acs") {
    const cfg = AcsConfigSchema.safeParse(parsed.data.config);
    if (!cfg.success) {
      return fail<CarrierProviderConfig>(
        "ACS config invalid: " + cfg.error.issues[0].message,
        "INVALID_INPUT"
      );
    }
  } else if (parsed.data.carrier === "box_now") {
    const cfg = BoxNowConfigSchema.safeParse(parsed.data.config);
    if (!cfg.success) {
      return fail<CarrierProviderConfig>(
        "BoxNow config invalid: " + cfg.error.issues[0].message,
        "INVALID_INPUT"
      );
    }
  } else if (parsed.data.carrier === "geniki") {
    const cfg = GenikiConfigSchema.safeParse(parsed.data.config);
    if (!cfg.success) {
      return fail<CarrierProviderConfig>(
        "Geniki config invalid: " + cfg.error.issues[0].message,
        "INVALID_INPUT"
      );
    }
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user)
    return fail<CarrierProviderConfig>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const isInsert = !parsed.data.id;
  if (isInsert && !parsed.data.secrets) {
    return fail<CarrierProviderConfig>(
      "Συμπληρώστε τα credentials του courier για τη νέα ρύθμιση.",
      "MISSING_SECRETS"
    );
  }

  // Validate + encrypt secrets.
  let secretBytes: Buffer | undefined;
  if (parsed.data.secrets) {
    if (parsed.data.carrier === "acs") {
      const s = AcsSecretsSchema.safeParse(parsed.data.secrets);
      if (!s.success) {
        return fail<CarrierProviderConfig>(
          "ACS secrets invalid: " + s.error.issues[0].message,
          "INVALID_INPUT"
        );
      }
    } else if (parsed.data.carrier === "box_now") {
      const s = BoxNowSecretsSchema.safeParse(parsed.data.secrets);
      if (!s.success) {
        return fail<CarrierProviderConfig>(
          "BoxNow secrets invalid: " + s.error.issues[0].message,
          "INVALID_INPUT"
        );
      }
    } else if (parsed.data.carrier === "geniki") {
      const s = GenikiSecretsSchema.safeParse(parsed.data.secrets);
      if (!s.success) {
        return fail<CarrierProviderConfig>(
          "Geniki secrets invalid: " + s.error.issues[0].message,
          "INVALID_INPUT"
        );
      }
    }
    try {
      secretBytes = encryptCarrierSecret(JSON.stringify(parsed.data.secrets));
    } catch (e) {
      return fail<CarrierProviderConfig>(
        "Encryption setup error: " + (e as Error).message,
        "CRYPTO_SETUP"
      );
    }
  }

  const basePayload: Record<string, unknown> = {
    carrier: parsed.data.carrier,
    display_name: parsed.data.display_name,
    config: parsed.data.config,
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.is_active !== undefined) basePayload.is_active = parsed.data.is_active;

  let row: CarrierProviderConfig | null;
  if (isInsert) {
    const { data, error } = await admin
      .from("carrier_provider_configs")
      .insert({
        ...basePayload,
        secrets_encrypted: secretBytes,
        created_by: authData.user.id,
      })
      .select("*")
      .single();
    if (error || !data) {
      if (error?.code === "23505") {
        return fail<CarrierProviderConfig>(
          "Υπάρχει ήδη ενεργή ρύθμιση γι' αυτόν τον courier. Απενεργοποιήστε τη παλιά πρώτα.",
          "DUPLICATE_ACTIVE"
        );
      }
      return fail<CarrierProviderConfig>(error?.message ?? "Insert failed", error?.code);
    }
    row = data as CarrierProviderConfig;
  } else {
    const update: Record<string, unknown> = { ...basePayload };
    if (secretBytes) update.secrets_encrypted = secretBytes;
    const { data, error } = await admin
      .from("carrier_provider_configs")
      .update(update)
      .eq("id", parsed.data.id!)
      .select("*")
      .single();
    if (error || !data) {
      if (error?.code === "23505") {
        return fail<CarrierProviderConfig>(
          "Υπάρχει ήδη ενεργή ρύθμιση γι' αυτόν τον courier. Απενεργοποιήστε τη άλλη πρώτα.",
          "DUPLICATE_ACTIVE"
        );
      }
      return fail<CarrierProviderConfig>(error?.message ?? "Update failed", error?.code);
    }
    row = data as CarrierProviderConfig;
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: isInsert ? "carrier_provider.created" : "carrier_provider.updated",
    resource_type: "carrier_provider_config",
    resource_id: row.id,
    metadata: {
      carrier: row.carrier,
      display_name: row.display_name,
      is_active: row.is_active,
      secret_rotated: !!secretBytes && !isInsert,
    },
  });

  revalidatePath("/admin/settings/couriers");
  return ok(row);
}
