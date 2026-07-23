import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { bytesFromSupabase, decryptCarrierSecret } from "./encryption";
import { AcsProvider } from "./providers/acs";
import { BoxNowProvider } from "./providers/boxnow";
import { GenikiProvider } from "./providers/geniki";
import type { CarrierProvider } from "./provider";
import type {
  AcsConfig,
  AcsSecrets,
  BoxNowConfig,
  BoxNowSecrets,
  CarrierProviderConfig,
  GenikiConfig,
  GenikiSecrets,
} from "@/types/carrier-provider";
import type { Carrier } from "@/types/order-history";

/**
 * Loads the active provider for the requested carrier.
 *
 * Returns null when:
 *   - no row exists for this carrier
 *   - the row is is_active=false (admin disabled it)
 *   - the row has no credentials stored yet
 *   - decryption fails (key missing / rotated / tampered)
 *
 * Callers in the order flow MUST treat null as "fall back to custom rules"
 * — never throw on missing/unconfigured carriers, since the per-order carrier
 * is chosen by the customer and a carrier may legitimately be uninstalled.
 */
export async function loadCarrierProvider(
  carrier: Carrier
): Promise<CarrierProvider | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("carrier_provider_configs")
    .select("*")
    .eq("carrier", carrier)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as CarrierProviderConfig;
  if (!row.secrets_encrypted) return null;

  let secretsJson: string;
  try {
    const blob = bytesFromSupabase(row.secrets_encrypted);
    if (!blob) return null;
    secretsJson = decryptCarrierSecret(blob);
  } catch (e) {
    console.error(
      `[carrier] failed to decrypt secrets for ${carrier} (id ${row.id}):`,
      (e as Error).message
    );
    return null;
  }

  switch (carrier) {
    case "acs": {
      const secrets = JSON.parse(secretsJson) as AcsSecrets;
      const config = row.config as unknown as AcsConfig;
      return new AcsProvider(config, secrets);
    }
    case "box_now": {
      const secrets = JSON.parse(secretsJson) as BoxNowSecrets;
      const config = row.config as unknown as BoxNowConfig;
      return new BoxNowProvider(config, secrets);
    }
    case "geniki": {
      const secrets = JSON.parse(secretsJson) as GenikiSecrets;
      const config = row.config as unknown as GenikiConfig;
      return new GenikiProvider(config, secrets);
    }
    default:
      // Other carriers land in later phases; until then any unwired carrier
      // resolves to null and the order flow falls back to custom rules.
      return null;
  }
}

/**
 * Convenience for the admin "test connection" button. Loads + tests in one
 * shot. Surfaces decryption failure as a normal failed test so the admin UI
 * can render it consistently.
 */
export async function testCarrierProvider(
  carrier: Carrier
): Promise<{ ok: boolean; message?: string }> {
  const provider = await loadCarrierProvider(carrier);
  if (!provider) {
    return {
      ok: false,
      message:
        "Δεν βρέθηκε ενεργή ρύθμιση ή απέτυχε η αποκρυπτογράφηση. Ελέγξτε το CARRIER_SECRETS_KEY και αποθηκεύστε ξανά τα credentials.",
    };
  }
  return provider.testConnection();
}
