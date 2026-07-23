"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertCarrierProvider } from "@/actions/courier-settings";
import type {
  AcsConfig,
  BoxNowConfig,
  Capability,
  CapabilityConfig,
  CapabilityPreset,
  CarrierProviderConfig,
  GenikiConfig,
} from "@/types/carrier-provider";
import {
  CAPABILITY_DEPENDS_ON,
  PRESET_CAPABILITIES,
} from "@/types/carrier-provider";
import type { Carrier } from "@/types/order-history";
import { CARRIERS as CARRIER_OPTIONS } from "@/config/storefront";

/** Carriers with a working provider class. Others stay disabled in the picker. */
const SUPPORTED_CARRIERS: ReadonlySet<Carrier> = new Set(["acs", "box_now", "geniki"]);
const CARRIERS = CARRIER_OPTIONS.map((c) => ({
  v: c.value,
  label: c.label,
  supported: SUPPORTED_CARRIERS.has(c.value as Carrier),
}));

/**
 * Per-carrier list of capabilities the provider class supports (its upper
 * bound). Mirrors AcsProvider.supportedCapabilities() etc. — we duplicate
 * here because the form is client-side and can't call server-only provider
 * methods. When BoxNow/Geniki ship, add their sets to this map.
 */
const SUPPORTED_CAPABILITIES_BY_CARRIER: Partial<Record<Carrier, Capability[]>> = {
  acs: [
    "address_validation",
    "surface_inaccessibility",
    "fetch_price_quote",
    "apply_remote_surcharge",
    "list_smartpoints",
    "list_branches",
    "store_api_quote_for_audit",
    // Phase 8 / 8b — voucher creation, cancellation, tracking, batch close.
    "create_voucher",
    "cancel_voucher",
    "fetch_tracking",
    "batch_finalize",
  ],
  // BoxNow's supported set. Mirrors BoxNowProvider.supportedCapabilities().
  // Notably no apply_remote_surcharge (BoxNow flat-rate), no list_branches
  // (lockers only), no batch_finalize (auto-dispatch), but YES
  // defer_locker_selection (BoxNow's "any-apm" mode).
  box_now: [
    "address_validation",
    "fetch_price_quote",
    "list_smartpoints",
    "defer_locker_selection",
    "store_api_quote_for_audit",
    "create_voucher",
    "cancel_voucher",
    "fetch_tracking",
  ],
  // Geniki's supported set. Mirrors GenikiProvider.supportedCapabilities().
  // No fetch_price_quote (Geniki SOAP pricing is contract-specific and not
  // wired). No defer_locker_selection (Geniki has no any-locker mode). YES
  // batch_finalize via ClosePendingJobs.
  geniki: [
    "address_validation",
    "list_smartpoints",
    "list_branches",
    "store_api_quote_for_audit",
    "create_voucher",
    "cancel_voucher",
    "fetch_tracking",
    "batch_finalize",
  ],
};

/** Greek labels for each capability — displayed next to the checkbox. */
const CAPABILITY_LABELS: Record<Capability, { title: string; help: string }> = {
  address_validation: {
    title: "Επικύρωση διεύθυνσης",
    help: "Αναζήτηση Τ.Κ. → σταθμό + αν είναι απομακρυσμένη περιοχή.",
  },
  surface_inaccessibility: {
    title: "Ειδοποίηση απομακρυσμένης περιοχής",
    help: "Εμφάνιση banner στο checkout όταν η διεύθυνση είναι απομακρυσμένη.",
  },
  fetch_price_quote: {
    title: "Λήψη κόστους από API",
    help: "Κλήση του ACS pricing — αλλιώς ισχύουν μόνο τα custom rules.",
  },
  apply_remote_surcharge: {
    title: "Επιπλέον χρέωση απομακρυσμένων περιοχών (REM)",
    help: "Προσθήκη της επίσημης επιβάρυνσης ΔΠ στο quote.",
  },
  list_smartpoints: {
    title: "Λίστα Smart Point lockers",
    help: "Εμφάνιση επιλογών locker στον picker του πελάτη.",
  },
  list_branches: {
    title: "Λίστα καταστημάτων",
    help: "Εμφάνιση καταστημάτων μεταφορικής στον picker.",
  },
  defer_locker_selection: {
    title: "Επιλογή locker αργότερα",
    help: "Επιτρέπει στον πελάτη να διαλέξει locker μετά την αποστολή (BoxNow).",
  },
  create_voucher: {
    title: "Δημιουργία voucher",
    help: "Αυτόματη δημιουργία voucher στο API μετά την παραγγελία.",
  },
  fetch_tracking: {
    title: "Αυτόματο tracking",
    help: "Λήψη ενημερώσεων κατάστασης από το API και αυτόματη προώθηση status.",
  },
  batch_finalize: {
    title: "Καθημερινό κλείσιμο παρτίδας",
    help: "Issue_Pickup_List για το τελικό κλείσιμο πριν την παραλαβή.",
  },
  cancel_voucher: {
    title: "Ακύρωση voucher",
    help: "Δυνατότητα ακύρωσης μέσω API.",
  },
  store_api_quote_for_audit: {
    title: "Καταγραφή quote για audit",
    help: "Αποθήκευση του τι θα χρέωνε το API παράλληλα με τα custom rules.",
  },
};

const PRESET_LABELS: Record<CapabilityPreset, string> = {
  full: "Πλήρης ενσωμάτωση — όλα ενεργά",
  validation: "Επικύρωση + operations — όχι pricing API",
  manual: "Manual — credentials μόνο, καμία κλήση",
  custom: "Custom — επιλογή ανά capability",
};

/**
 * Build a capabilities config from a preset name, intersected with the
 * carrier's supported set. Returns explicit true/false for every supported
 * capability so the saved config is fully determined (no implicit defaults).
 */
function capabilitiesFromPreset(
  presetName: Exclude<CapabilityPreset, "custom">,
  carrier: Carrier
): CapabilityConfig {
  const supported = SUPPORTED_CAPABILITIES_BY_CARRIER[carrier] ?? [];
  const presetSet = new Set<Capability>(PRESET_CAPABILITIES[presetName]);
  const config: CapabilityConfig = {};
  for (const cap of supported) {
    config[cap] = presetSet.has(cap);
  }
  return config;
}

interface Props {
  initial?: CarrierProviderConfig;
  onSaved?: () => void;
}

/**
 * Create / edit form for a carrier provider. Phase 2 only ships the ACS
 * shape — other carriers are listed but disabled in the picker until their
 * integration phases land.
 *
 * Editing an existing row leaves all secret fields blank by default; typing
 * into any of them re-encrypts the whole secrets bundle. Leave them all
 * blank to keep the stored credentials untouched.
 */
export default function CarrierProviderForm({ initial, onSaved }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!initial;
  const [carrier, setCarrier] = useState<Carrier>(initial?.carrier ?? "acs");
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? false);

  // ACS config (only meaningful when carrier === 'acs')
  const initAcs =
    initial?.carrier === "acs"
      ? ((initial?.config as unknown) as AcsConfig | undefined)
      : undefined;
  const [baseUrl, setBaseUrl] = useState(initAcs?.base_url ?? "");
  const [senderName, setSenderName] = useState(initAcs?.sender_name ?? "");
  const [billingCode, setBillingCode] = useState(initAcs?.billing_code ?? "");
  const [originStation, setOriginStation] = useState(initAcs?.origin_station ?? "");
  const [chargeType, setChargeType] = useState(String(initAcs?.default_charge_type ?? 2));
  const [language, setLanguage] = useState(initAcs?.language ?? "EN");

  // ACS secrets (always blank on edit; type to rotate)
  const [apiKey, setApiKey] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companyPassword, setCompanyPassword] = useState("");
  const [userId, setUserId] = useState("");
  const [userPassword, setUserPassword] = useState("");

  // BoxNow config (only meaningful when carrier === 'box_now')
  const initBoxNow =
    initial?.carrier === "box_now"
      ? ((initial?.config as unknown) as BoxNowConfig | undefined)
      : undefined;
  const [boxNowBaseUrl, setBoxNowBaseUrl] = useState(initBoxNow?.base_url ?? "");
  const [boxNowPartnerId, setBoxNowPartnerId] = useState(initBoxNow?.partner_id ?? "");
  const [boxNowOriginLocationId, setBoxNowOriginLocationId] = useState(
    initBoxNow?.origin_location_id ?? ""
  );
  const [boxNowDefaultSize, setBoxNowDefaultSize] = useState(
    String(initBoxNow?.default_parcel_size ?? 1)
  );

  // BoxNow secrets (always blank on edit; type to rotate)
  const [boxNowClientId, setBoxNowClientId] = useState("");
  const [boxNowClientSecret, setBoxNowClientSecret] = useState("");

  // Geniki config (only meaningful when carrier === 'geniki')
  const initGeniki =
    initial?.carrier === "geniki"
      ? ((initial?.config as unknown) as GenikiConfig | undefined)
      : undefined;
  const [genikiBaseUrl, setGenikiBaseUrl] = useState(initGeniki?.base_url ?? "");
  const [genikiLanguage, setGenikiLanguage] = useState(initGeniki?.language ?? "GR");

  // Geniki secrets (always blank on edit; type to rotate)
  const [genikiUsername, setGenikiUsername] = useState("");
  const [genikiPassword, setGenikiPassword] = useState("");

  // Phase 4 — capability config. Reads from whichever carrier-specific config
  // the row carries. On a fresh row, defaults to "full" preset intersected
  // with the carrier's supported set.
  const initConfig = (initial?.config as
    | { capabilities?: CapabilityConfig; preset?: CapabilityPreset }
    | undefined) ?? undefined;
  const [preset, setPreset] = useState<CapabilityPreset>(
    initConfig?.preset ?? "full"
  );
  const [capabilities, setCapabilities] = useState<CapabilityConfig>(() => {
    if (
      initConfig?.capabilities &&
      Object.keys(initConfig.capabilities).length > 0
    ) {
      return { ...initConfig.capabilities };
    }
    return capabilitiesFromPreset("full", carrier);
  });

  /** Apply a preset's capability subset, intersected with carrier's supported set. */
  function applyPreset(name: CapabilityPreset) {
    setPreset(name);
    if (name === "custom") return; // keep current toggles
    setCapabilities(capabilitiesFromPreset(name, carrier));
  }

  /**
   * Switching carriers (only possible on insert — disabled on edit) resets
   * the capability set to the new carrier's 'full' preset. Otherwise the
   * form would visually display capabilities the new carrier doesn't
   * support, which is confusing even though the server-side intersection
   * would silently drop them at save.
   */
  function handleCarrierChange(next: Carrier) {
    setCarrier(next);
    if (SUPPORTED_CARRIERS.has(next)) {
      setPreset("full");
      setCapabilities(capabilitiesFromPreset("full", next));
    }
  }

  /** Toggle a single capability + apply dependency cascade. */
  function toggleCapability(cap: Capability, enabled: boolean) {
    setPreset("custom"); // any manual toggle moves to custom
    setCapabilities((prev) => {
      const next: CapabilityConfig = { ...prev, [cap]: enabled };
      // Cascade: turning off a parent forces all dependents off.
      if (!enabled) {
        for (const [child, parent] of Object.entries(CAPABILITY_DEPENDS_ON) as Array<
          [Capability, Capability]
        >) {
          if (parent === cap) next[child] = false;
        }
      }
      return next;
    });
  }

  const supportedCapsForCarrier =
    SUPPORTED_CAPABILITIES_BY_CARRIER[carrier] ?? [];

  const hasStoredSecrets = !!initial?.secrets_encrypted;
  const anyAcsSecretEntered =
    apiKey || companyId || companyPassword || userId || userPassword;
  const anyBoxNowSecretEntered = boxNowClientId || boxNowClientSecret;
  const anyGenikiSecretEntered = genikiUsername || genikiPassword;

  function submit() {
    setError(null);
    if (!displayName.trim()) {
      setError("Δώστε ένα όνομα για να αναγνωρίζετε αυτή τη ρύθμιση.");
      return;
    }
    if (!SUPPORTED_CARRIERS.has(carrier)) {
      setError("Αυτός ο courier δεν υποστηρίζεται ακόμη.");
      return;
    }

    let config: Record<string, unknown>;
    let secrets: Record<string, unknown> | undefined;

    if (carrier === "acs") {
      if (!senderName.trim() || !billingCode.trim() || !originStation.trim()) {
        setError("Συμπληρώστε sender name, billing code και origin station.");
        return;
      }
      if (!isEdit && !anyAcsSecretEntered) {
        setError("Για νέα ρύθμιση συμπληρώστε όλα τα ACS credentials.");
        return;
      }
      if (anyAcsSecretEntered) {
        if (!apiKey || !companyId || !companyPassword || !userId || !userPassword) {
          setError(
            "Όταν ανανεώνετε credentials, συμπληρώστε και τα 5 πεδία (api key + Company_ID/Password + User_ID/Password)."
          );
          return;
        }
      }
      const acsConfig: AcsConfig = {
        sender_name: senderName.trim(),
        billing_code: billingCode.trim(),
        origin_station: originStation.trim().toUpperCase(),
        default_charge_type: (Number(chargeType) || 2) as 0 | 1 | 2,
        language: language as "EN" | "GR",
        capabilities,
        preset,
      };
      if (baseUrl.trim()) acsConfig.base_url = baseUrl.trim();
      config = acsConfig as unknown as Record<string, unknown>;
      secrets = anyAcsSecretEntered
        ? {
            api_key: apiKey.trim(),
            company_id: companyId.trim(),
            company_password: companyPassword.trim(),
            user_id: userId.trim(),
            user_password: userPassword.trim(),
          }
        : undefined;
    } else if (carrier === "geniki") {
      if (!isEdit && !anyGenikiSecretEntered) {
        setError("Για νέα ρύθμιση συμπληρώστε τα Geniki credentials.");
        return;
      }
      if (anyGenikiSecretEntered) {
        if (!genikiUsername || !genikiPassword) {
          setError(
            "Όταν ανανεώνετε credentials, συμπληρώστε και τα 2 πεδία (Username + Password)."
          );
          return;
        }
      }
      const genikiConfig: GenikiConfig = {
        language: genikiLanguage as "GR" | "EN",
        capabilities,
        preset,
      };
      if (genikiBaseUrl.trim()) genikiConfig.base_url = genikiBaseUrl.trim();
      config = genikiConfig as unknown as Record<string, unknown>;
      secrets = anyGenikiSecretEntered
        ? {
            username: genikiUsername.trim(),
            password: genikiPassword.trim(),
          }
        : undefined;
    } else if (carrier === "box_now") {
      if (!boxNowPartnerId.trim() || !boxNowOriginLocationId.trim()) {
        setError("Συμπληρώστε Partner ID και Origin Location ID.");
        return;
      }
      if (!isEdit && !anyBoxNowSecretEntered) {
        setError("Για νέα ρύθμιση συμπληρώστε τα BoxNow credentials.");
        return;
      }
      if (anyBoxNowSecretEntered) {
        if (!boxNowClientId || !boxNowClientSecret) {
          setError(
            "Όταν ανανεώνετε credentials, συμπληρώστε και τα 2 πεδία (Client ID + Client Secret)."
          );
          return;
        }
      }
      const boxNowConfig: BoxNowConfig = {
        partner_id: boxNowPartnerId.trim(),
        origin_location_id: boxNowOriginLocationId.trim(),
        default_parcel_size: (Number(boxNowDefaultSize) || 1) as 1 | 2 | 3,
        capabilities,
        preset,
      };
      if (boxNowBaseUrl.trim()) boxNowConfig.base_url = boxNowBaseUrl.trim();
      config = boxNowConfig as unknown as Record<string, unknown>;
      secrets = anyBoxNowSecretEntered
        ? {
            client_id: boxNowClientId.trim(),
            client_secret: boxNowClientSecret.trim(),
          }
        : undefined;
    } else {
      setError("Αυτός ο courier δεν υποστηρίζεται ακόμη.");
      return;
    }

    startTransition(async () => {
      const r = await upsertCarrierProvider({
        id: initial?.id,
        carrier,
        display_name: displayName.trim(),
        config,
        secrets,
        is_active: isActive,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      onSaved?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 max-w-2xl text-sm">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label>
          <span className="block text-sm font-medium mb-1.5">Courier</span>
          <select
            value={carrier}
            onChange={(e) => handleCarrierChange(e.target.value as Carrier)}
            disabled={isEdit}
            className="cms-input disabled:opacity-60"
            title={isEdit ? "Δεν αλλάζει σε υπάρχουσα ρύθμιση" : ""}
          >
            {CARRIERS.map((c) => (
              <option key={c.v} value={c.v} disabled={!c.supported}>
                {c.label}
                {!c.supported ? " — coming soon" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-sm font-medium mb-1.5">Όνομα διαχείρισης</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder='π.χ. "ACS production"'
            className="cms-input"
          />
        </label>
        <label className="md:col-span-2 flex items-start gap-3 rounded-md border border-foreground/15 bg-muted/20 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="mt-0.5"
          />
          <div>
            <p className="text-sm font-medium">Ενεργή ρύθμιση</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Μόνο μία ρύθμιση ανά courier μπορεί να είναι ενεργή κάθε φορά.
            </p>
          </div>
        </label>
      </div>

      {carrier === "box_now" && (
        <>
          <fieldset className="rounded-md border border-foreground/15 bg-muted/20 p-4 space-y-3">
            <legend className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-2 -ml-2">BoxNow settings</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <span className="block text-sm font-medium mb-1.5">Partner ID</span>
                <input
                  value={boxNowPartnerId}
                  onChange={(e) => setBoxNowPartnerId(e.target.value)}
                  placeholder="merchant-partner-id"
                  className="cms-input font-mono"
                />
              </label>
              <label>
                <span className="block text-sm font-medium mb-1.5">Origin Location ID</span>
                <input
                  value={boxNowOriginLocationId}
                  onChange={(e) => setBoxNowOriginLocationId(e.target.value)}
                  placeholder="merchant drop-off locker UUID"
                  className="cms-input font-mono"
                />
                <span className="block text-xs text-muted-foreground mt-1">
                  Το APM/warehouse από όπου ξεκινά κάθε αποστολή. Βρίσκεται στο
                  BoxNow merchant dashboard ή μέσω /origins endpoint.
                </span>
              </label>
              <label>
                <span className="block text-sm font-medium mb-1.5">Default parcel size</span>
                <select
                  value={boxNowDefaultSize}
                  onChange={(e) => setBoxNowDefaultSize(e.target.value)}
                  className="cms-input"
                >
                  <option value="1">1 — Small (≤2 kg, 45×35×18 cm)</option>
                  <option value="2">2 — Medium (≤5 kg, 45×35×36 cm)</option>
                  <option value="3">3 — Large (≤10 kg, 45×35×68 cm)</option>
                </select>
                <span className="block text-xs text-muted-foreground mt-1">
                  Fallback όταν δεν υπολογίζεται μέγεθος από το βάρος του cart.
                </span>
              </label>
              <label className="md:col-span-2">
                <span className="block text-sm font-medium mb-1.5">
                  Base URL override (sandbox = https://stage-api.boxnow.gr)
                </span>
                <input
                  value={boxNowBaseUrl}
                  onChange={(e) => setBoxNowBaseUrl(e.target.value)}
                  placeholder="https://production-api.boxnow.gr"
                  className="cms-input font-mono"
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="rounded-md border border-foreground/15 bg-muted/20 p-4 space-y-3">
            <legend className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-2 -ml-2">
              BoxNow credentials {hasStoredSecrets && "(πληκτρολογήστε για ανανέωση)"}
            </legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <span className="block text-sm font-medium mb-1.5">Client ID</span>
                <input
                  type="password"
                  value={boxNowClientId}
                  onChange={(e) => setBoxNowClientId(e.target.value)}
                  placeholder={hasStoredSecrets ? "—" : "OAuth client ID"}
                  autoComplete="new-password"
                  className="cms-input font-mono"
                />
              </label>
              <label>
                <span className="block text-sm font-medium mb-1.5">Client Secret</span>
                <input
                  type="password"
                  value={boxNowClientSecret}
                  onChange={(e) => setBoxNowClientSecret(e.target.value)}
                  placeholder={hasStoredSecrets ? "—" : "OAuth client secret"}
                  autoComplete="new-password"
                  className="cms-input font-mono"
                />
              </label>
            </div>
            {hasStoredSecrets && (
              <p className="text-xs text-muted-foreground">
                Υπάρχουν ήδη αποθηκευμένα credentials (encrypted). Συμπληρώστε
                και τα 2 πεδία ταυτόχρονα για ανανέωση, ή αφήστε τα κενά για να
                διατηρηθούν.
              </p>
            )}
          </fieldset>
        </>
      )}

      {carrier === "geniki" && (
        <>
          <fieldset className="rounded-md border border-foreground/15 bg-muted/20 p-4 space-y-3">
            <legend className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-2 -ml-2">Geniki settings</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <span className="block text-sm font-medium mb-1.5">Voucher language</span>
                <select
                  value={genikiLanguage}
                  onChange={(e) => setGenikiLanguage(e.target.value as "GR" | "EN")}
                  className="cms-input"
                >
                  <option value="GR">GR</option>
                  <option value="EN">EN</option>
                </select>
              </label>
              <label className="md:col-span-2">
                <span className="block text-sm font-medium mb-1.5">
                  Base URL override (προαιρετικό — άφησέ το άδειο για production)
                </span>
                <input
                  value={genikiBaseUrl}
                  onChange={(e) => setGenikiBaseUrl(e.target.value)}
                  placeholder="https://services.taxydromiki.com/web2/web2.asmx"
                  className="cms-input font-mono"
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="rounded-md border border-foreground/15 bg-muted/20 p-4 space-y-3">
            <legend className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-2 -ml-2">
              Geniki credentials {hasStoredSecrets && "(πληκτρολογήστε για ανανέωση)"}
            </legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <span className="block text-sm font-medium mb-1.5">Username</span>
                <input
                  type="password"
                  value={genikiUsername}
                  onChange={(e) => setGenikiUsername(e.target.value)}
                  placeholder={hasStoredSecrets ? "—" : "Geniki SOAP username"}
                  autoComplete="new-password"
                  className="cms-input font-mono"
                />
              </label>
              <label>
                <span className="block text-sm font-medium mb-1.5">Password</span>
                <input
                  type="password"
                  value={genikiPassword}
                  onChange={(e) => setGenikiPassword(e.target.value)}
                  placeholder={hasStoredSecrets ? "—" : "Geniki SOAP password"}
                  autoComplete="new-password"
                  className="cms-input font-mono"
                />
              </label>
            </div>
            {hasStoredSecrets && (
              <p className="text-xs text-muted-foreground">
                Υπάρχουν ήδη αποθηκευμένα credentials (encrypted). Συμπληρώστε
                και τα 2 πεδία ταυτόχρονα για ανανέωση, ή αφήστε τα κενά για να
                διατηρηθούν.
              </p>
            )}
          </fieldset>
        </>
      )}

      {carrier === "acs" && (
        <>
          <fieldset className="rounded-md border border-foreground/15 bg-muted/20 p-4 space-y-3">
            <legend className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-2 -ml-2">ACS settings</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <span className="block text-sm font-medium mb-1.5">Sender name</span>
                <input
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="ESHOP"
                  className="cms-input"
                />
              </label>
              <label>
                <span className="block text-sm font-medium mb-1.5">Billing code</span>
                <input
                  value={billingCode}
                  onChange={(e) => setBillingCode(e.target.value)}
                  placeholder="2ΑΘ999999"
                  className="cms-input font-mono"
                />
              </label>
              <label>
                <span className="block text-sm font-medium mb-1.5">Origin station (Greek code)</span>
                <input
                  value={originStation}
                  onChange={(e) => setOriginStation(e.target.value.toUpperCase())}
                  placeholder="ΑΘ"
                  className="cms-input font-mono uppercase"
                />
                <span className="block text-xs text-muted-foreground mt-1">
                  Ο κωδικός σταθμού ACS του σημείου παράδοσης (π.χ. ΑΘ για Αθήνα).
                  Χρησιμοποιείται ως origin σε όλα τα ACS_Price_Calculation.
                </span>
              </label>
              <label>
                <span className="block text-sm font-medium mb-1.5">Charge type</span>
                <select
                  value={chargeType}
                  onChange={(e) => setChargeType(e.target.value)}
                  className="cms-input"
                >
                  <option value="0">0 — Recipient pays</option>
                  <option value="1">1 — Pre-paid</option>
                  <option value="2">2 — Sender pays (εμείς)</option>
                </select>
              </label>
              <label>
                <span className="block text-sm font-medium mb-1.5">Voucher language</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as "EN" | "GR")}
                  className="cms-input"
                >
                  <option value="EN">EN</option>
                  <option value="GR">GR</option>
                </select>
              </label>
              <label className="md:col-span-2">
                <span className="block text-sm font-medium mb-1.5">
                  Base URL override (προαιρετικό — άφησέ το άδειο για production)
                </span>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest"
                  className="cms-input font-mono"
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="rounded-md border border-foreground/15 bg-muted/20 p-4 space-y-3">
            <legend className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-2 -ml-2">
              ACS credentials {hasStoredSecrets && "(πληκτρολογήστε για ανανέωση)"}
            </legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <span className="block text-sm font-medium mb-1.5">AcsApiKey (header)</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasStoredSecrets ? "—" : "uuid από το ACS"}
                  autoComplete="new-password"
                  className="cms-input font-mono"
                />
              </label>
              <label>
                <span className="block text-sm font-medium mb-1.5">Company_ID</span>
                <input
                  type="password"
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  placeholder={hasStoredSecrets ? "—" : ""}
                  autoComplete="new-password"
                  className="cms-input font-mono"
                />
              </label>
              <label>
                <span className="block text-sm font-medium mb-1.5">Company_Password</span>
                <input
                  type="password"
                  value={companyPassword}
                  onChange={(e) => setCompanyPassword(e.target.value)}
                  placeholder={hasStoredSecrets ? "—" : ""}
                  autoComplete="new-password"
                  className="cms-input font-mono"
                />
              </label>
              <label>
                <span className="block text-sm font-medium mb-1.5">User_ID</span>
                <input
                  type="password"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder={hasStoredSecrets ? "—" : ""}
                  autoComplete="new-password"
                  className="cms-input font-mono"
                />
              </label>
              <label>
                <span className="block text-sm font-medium mb-1.5">User_Password</span>
                <input
                  type="password"
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  placeholder={hasStoredSecrets ? "—" : ""}
                  autoComplete="new-password"
                  className="cms-input font-mono"
                />
              </label>
            </div>
            {hasStoredSecrets && (
              <p className="text-xs text-muted-foreground">
                Υπάρχουν ήδη αποθηκευμένα credentials (encrypted). Συμπληρώστε
                και τα 5 πεδία ταυτόχρονα για ανανέωση, ή αφήστε τα κενά για να
                διατηρηθούν.
              </p>
            )}
          </fieldset>
        </>
      )}

      {SUPPORTED_CARRIERS.has(carrier) && (
        <fieldset className="border rounded p-3 space-y-3">
          <legend className="text-xs text-muted-foreground px-1">
            Capability scope — τι θα κάνει η ενσωμάτωση
          </legend>
          <p className="text-xs text-muted-foreground">
            Ενεργοποιήστε μόνο τα κομμάτια του API που θέλετε να καλεί το shop.
            Π.χ. αν προτιμάτε δικά σας custom rules για κόστος, αφήστε το
            «Λήψη κόστους από API» ανενεργό αλλά κρατήστε «Επικύρωση
            διεύθυνσης» για να ξέρετε ποιες περιοχές δεν εξυπηρετούνται.
          </p>

          <label className="block">
            <span className="block text-sm font-medium mb-1.5">Preset</span>
            <select
              value={preset}
              onChange={(e) => applyPreset(e.target.value as CapabilityPreset)}
              className="cms-input"
            >
              {(["full", "validation", "manual", "custom"] as CapabilityPreset[]).map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABELS[p]}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-2">
            {supportedCapsForCarrier.map((cap) => {
              const enabled = capabilities[cap] === true;
              const parent = CAPABILITY_DEPENDS_ON[cap];
              const parentOff = parent !== undefined && capabilities[parent] !== true;
              return (
                <label
                  key={cap}
                  className={`flex items-start gap-2 rounded border p-2 ${
                    parentOff ? "opacity-50" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={enabled && !parentOff}
                    disabled={parentOff}
                    onChange={(e) => toggleCapability(cap, e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-sm">
                    <span className="font-medium">{CAPABILITY_LABELS[cap].title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {CAPABILITY_LABELS[cap].help}
                      {parent && (
                        <span className="block italic mt-0.5">
                          Απαιτεί: {CAPABILITY_LABELS[parent].title}
                        </span>
                      )}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-center gap-2 pt-4 border-t border-foreground/10">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="btn btn-primary btn-md"
        >
          {isPending ? "Αποθήκευση..." : isEdit ? "Αποθήκευση αλλαγών" : "Δημιουργία"}
        </button>
      </div>
    </div>
  );
}
