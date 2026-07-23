import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { AcsProvider } from "./providers/acs";
import {
  CAPABILITY_DEPENDS_ON,
  PRESET_CAPABILITIES,
  type Capability,
  type CapabilityConfig,
  type CarrierProviderConfig,
} from "@/types/carrier-provider";
import type { CarrierSlug } from "@/config/carrier-slugs";

/**
 * Phase 4 — resolves the effective capability set for a carrier integration.
 *
 * The final set is determined by:
 *
 *   1. The provider class's supportedCapabilities() — upper bound. Admin
 *      can't enable capabilities the code doesn't implement.
 *   2. The admin's config in carrier_provider_configs.config.capabilities.
 *      Each capability is independently togglable.
 *   3. Fallback when config is absent: the 'full' preset (so a fresh install
 *      with credentials gets a working integration without per-capability
 *      ceremony).
 *   4. Dependency cascade: if a parent capability is off, the child is
 *      forced off regardless of config.
 *
 * Returns an empty set when:
 *   - no row exists for this carrier
 *   - is_active=false (admin disabled the row)
 *   - the carrier isn't a built-in we have a provider class for
 *
 * Callers MUST gracefully handle an empty set — every consumer of a
 * capability (fetchCarrierQuote, resolveFees, LocationPicker, etc.) treats
 * absence as "skip this feature" rather than throwing.
 *
 * Wrapped in React.cache so the carrier-active-config + capability
 * resolution is deduped within a single server request.
 */
export const getCapabilities = cache(
  async (carrier: CarrierSlug): Promise<Set<Capability>> => {
    const supported = supportedCapabilitiesFor(carrier);
    if (supported.size === 0) return new Set();

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("carrier_provider_configs")
      .select("config")
      .eq("carrier", carrier)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !data) return new Set();

    const config = (data as Pick<CarrierProviderConfig, "config">).config as {
      capabilities?: CapabilityConfig;
    };
    return resolveEffectiveCapabilities(supported, config.capabilities);
  }
);

/**
 * Pure resolution function — exported so the admin form can preview the
 * effective set as the user toggles checkboxes without hitting the DB.
 *
 * Order of operations:
 *   1. Start from the candidate set: explicit config values if present,
 *      otherwise the 'full' preset.
 *   2. Intersect with `supported` — drop anything the provider can't do.
 *   3. Cascade dependencies — if a parent is off, force the child off.
 */
export function resolveEffectiveCapabilities(
  supported: Set<Capability>,
  config: CapabilityConfig | undefined
): Set<Capability> {
  // Step 1: pick candidate set
  let candidate: Set<Capability>;
  if (config && Object.keys(config).length > 0) {
    candidate = new Set<Capability>();
    for (const [cap, enabled] of Object.entries(config)) {
      if (enabled) candidate.add(cap as Capability);
    }
  } else {
    // No explicit config → 'full' preset (everything supported is on)
    candidate = new Set(PRESET_CAPABILITIES.full);
  }

  // Step 2: intersect with supported
  const effective = new Set<Capability>();
  for (const cap of candidate) {
    if (supported.has(cap)) effective.add(cap);
  }

  // Step 3: cascade dependencies (multiple passes in case of chains, though
  // our current graph is single-level)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [child, parent] of Object.entries(CAPABILITY_DEPENDS_ON) as Array<
      [Capability, Capability]
    >) {
      if (effective.has(child) && !effective.has(parent)) {
        effective.delete(child);
        changed = true;
      }
    }
  }

  return effective;
}

/**
 * Synchronous lookup of a provider class's structural capability ceiling.
 * Used by getCapabilities() above AND by the admin form to filter the
 * displayed checkboxes (we don't show capabilities the provider can't do).
 *
 * For carriers without a provider class (ELTA / Speedex / Geniki / BoxNow
 * until their phases land, and ALL custom carriers), returns an empty set.
 */
export function supportedCapabilitiesFor(carrier: CarrierSlug): Set<Capability> {
  switch (carrier) {
    case "acs":
      // Instantiating just to call the method is fine — supportedCapabilities()
      // is stateless and doesn't touch credentials.
      return new AcsProvider(
        { sender_name: "", billing_code: "", origin_station: "" },
        { api_key: "", company_id: "", company_password: "", user_id: "", user_password: "" }
      ).supportedCapabilities();
    // ELTA, Speedex, Geniki, BoxNow, Other, and all custom carriers have no
    // provider class today → no capabilities can be enabled.
    default:
      return new Set();
  }
}

/**
 * Convenience: returns true if the given carrier has the named capability
 * effective right now. Use at consumer call sites:
 *
 *   if (await hasCapability(order.carrier_slug, "fetch_price_quote")) {
 *     ...call priceCalculate
 *   }
 */
export async function hasCapability(
  carrier: CarrierSlug,
  capability: Capability
): Promise<boolean> {
  const caps = await getCapabilities(carrier);
  return caps.has(capability);
}
