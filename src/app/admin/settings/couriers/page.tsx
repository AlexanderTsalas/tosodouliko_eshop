import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { Pencil } from "@/components/admin/common/icons";
import CarrierProviderForm from "@/components/admin/courier-settings/CarrierProviderForm";
import CarrierProviderRowActions from "@/components/admin/courier-settings/CarrierProviderRowActions";
import AcsDirectoryRefresh from "@/components/admin/courier-settings/AcsDirectoryRefresh";
import DeliveryCarriersSection, {
  type DeliveryCarrierRow,
} from "@/components/admin/courier-settings/DeliveryCarriersSection";
import CustomDeliveryMethodsSection, {
  type CustomDeliveryMethodRow,
} from "@/components/admin/courier-settings/CustomDeliveryMethodsSection";
import CourierTabs, {
  type CourierTab,
} from "@/components/admin/courier-settings/CourierTabs";
import VolumetricPrefixesSection from "@/components/admin/courier-settings/VolumetricPrefixesSection";
import type { VolumetricPrefix } from "@/types/volumetric";
import type { CarrierProviderConfig } from "@/types/carrier-provider";
import { CARRIER_LABELS } from "@/config/storefront";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Μεταφορές & Couriers — Admin" };
export const dynamic = "force-dynamic";

function resolveTab(raw: string | undefined): CourierTab {
  if (raw === "methods" || raw === "api" || raw === "prefixes") return raw;
  return "carriers";
}

export default async function CourierSettingsPage(
  props: {
    searchParams: Promise<{ edit?: string; tab?: string }>;
  }
) {
  await requirePermission("manage:couriers");
  const searchParams = await props.searchParams;
  const admin = createAdminClient();
  const activeTab = resolveTab(searchParams.tab);

  // Always fetch carriers + provider configs because tab badges show their
  // counts and the carriers list feeds the custom-method form. ACS cache
  // counts only matter for the API tab — fetched conditionally to avoid
  // round-trips on the other tabs.
  const baseFetches = await Promise.all([
    admin
      .from("carrier_provider_configs")
      .select("*")
      .order("carrier", { ascending: true })
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false }),
    admin
      .from("delivery_carriers")
      .select(
        "id, slug, display_name, supported_delivery_methods, display_order, is_active, is_custom, tracking_url_template, timeline_preset"
      )
      .order("display_order", { ascending: true })
      .order("display_name", { ascending: true }),
    admin
      .from("custom_delivery_methods")
      .select(
        "id, slug, display_name, description, base_method, carrier_slug, is_active, display_order"
      )
      .order("display_order", { ascending: true })
      .order("display_name", { ascending: true }),
  ]);
  const [providersRes, deliveryCarriersRes, customMethodsRes] = baseFetches;

  const providers = (providersRes.data ?? []) as CarrierProviderConfig[];
  const deliveryCarriers = (deliveryCarriersRes.data ?? []) as DeliveryCarrierRow[];
  const customMethods = (customMethodsRes.data ?? []) as CustomDeliveryMethodRow[];
  const editing =
    searchParams.edit && providers.find((p) => p.id === searchParams.edit);

  const masterKeyPresent = Boolean(process.env.CARRIER_SECRETS_KEY);

  // ACS directory cache widget data — only relevant when an ACS provider
  // is configured with credentials. We resolve this regardless of the
  // active tab because the API tab queries it, and the cost is two index
  // lookups.
  const acsActiveConfigured = providers.some(
    (p) => p.carrier === "acs" && p.is_active && p.secrets_encrypted
  );

  let acsCacheData: {
    kind1Count: number;
    kind7Count: number;
    kind1Latest: string | null;
    kind7Latest: string | null;
  } | null = null;
  if (activeTab === "api" && acsActiveConfigured) {
    const [kind1Counts, kind7Counts] = await Promise.all([
      admin
        .from("couriers_location_cache")
        .select("cached_at", { count: "exact", head: false })
        .eq("carrier", "acs")
        .eq("country", "GR")
        .eq("kind", "central_store")
        .order("cached_at", { ascending: false })
        .limit(1),
      admin
        .from("couriers_location_cache")
        .select("cached_at", { count: "exact", head: false })
        .eq("carrier", "acs")
        .eq("country", "GR")
        .eq("kind", "smartpoint")
        .order("cached_at", { ascending: false })
        .limit(1),
    ]);
    acsCacheData = {
      kind1Count: kind1Counts.count ?? 0,
      kind7Count: kind7Counts.count ?? 0,
      kind1Latest:
        (kind1Counts.data?.[0] as { cached_at: string } | undefined)?.cached_at ?? null,
      kind7Latest:
        (kind7Counts.data?.[0] as { cached_at: string } | undefined)?.cached_at ?? null,
    };
  }

  // Shape the carrier list once for the custom-method form / section.
  const carrierOptions = deliveryCarriers.map((c) => ({
    slug: c.slug,
    display_name: c.display_name,
    is_active: c.is_active,
  }));

  // Volumetric prefixes — fetched only when the tab is active (the
  // count needs to come from somewhere though, so when on any other
  // tab we fetch just a count-only query that's basically free).
  let volumetricPrefixes: VolumetricPrefix[] = [];
  let volumetricPrefixesCount = 0;
  if (activeTab === "prefixes") {
    const { data: vps, count: vpsCount } = await admin
      .from("volumetric_prefixes")
      .select("*", { count: "exact" })
      .order("display_order", { ascending: true })
      .order("display_name", { ascending: true });
    volumetricPrefixes = (vps ?? []) as VolumetricPrefix[];
    volumetricPrefixesCount = vpsCount ?? volumetricPrefixes.length;
  } else {
    const { count } = await admin
      .from("volumetric_prefixes")
      .select("id", { count: "exact", head: true });
    volumetricPrefixesCount = count ?? 0;
  }

  // Known carrier slugs for the carrier_codes form — distinct carriers
  // that have at least one provider config. These are the slugs that
  // provider classes (AcsProvider, BoxNowProvider…) understand.
  const knownCarrierSlugs = Array.from(
    new Set(providers.map((p) => p.carrier))
  ).sort();

  return (
    <>
      <PageHeader
        eyebrow="Ρυθμίσεις"
        title="Μεταφορές & Couriers"
        description="Διαχειριστείτε ποιες μεταφορικές προσφέρετε στους πελάτες, τους τρόπους παράδοσης, και τα credentials των API integrations."
      />

      {!masterKeyPresent && (
        <div className="rounded-lg border border-foreground bg-background p-4 mb-6 text-sm space-y-2">
          <p className="font-semibold flex items-center gap-2">
            <span className="cms-badge border-foreground bg-foreground text-background">
              SETUP
            </span>
            Λείπει το <code className="font-mono">CARRIER_SECRETS_KEY</code>
          </p>
          <p className="text-muted-foreground">
            Το master key για την κρυπτογράφηση των courier credentials δεν
            είναι ρυθμισμένο. Δημιουργήστε ένα με:
          </p>
          <pre className="text-xs font-mono bg-muted px-3 py-2 rounded border border-foreground/10 overflow-x-auto">
            node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;
          </pre>
          <p className="text-xs text-muted-foreground">
            Προσθέστε τη γραμμή{" "}
            <code className="font-mono">CARRIER_SECRETS_KEY=...</code> στο{" "}
            <code className="font-mono">.env.local</code> (και στο Vercel για
            production).
          </p>
        </div>
      )}

      <CourierTabs
        active={activeTab}
        counts={{
          carriers: deliveryCarriers.length,
          methods: customMethods.length,
          api: providers.length,
          prefixes: volumetricPrefixesCount,
        }}
      />

      {/* --------------------------------------------------------------- *
       *  Tab: Μεταφορικές                                                *
       * --------------------------------------------------------------- */}
      {activeTab === "carriers" && (
        <>
          {deliveryCarriersRes.error && (
            <p className="text-sm text-destructive mb-4">
              Σφάλμα φόρτωσης μεταφορικών: {deliveryCarriersRes.error.message}
            </p>
          )}
          <DeliveryCarriersSection carriers={deliveryCarriers} />
        </>
      )}

      {/* --------------------------------------------------------------- *
       *  Tab: Τρόποι παράδοσης (custom delivery methods)                 *
       * --------------------------------------------------------------- */}
      {activeTab === "methods" && (
        <>
          {customMethodsRes.error && (
            <p className="text-sm text-destructive mb-4">
              Σφάλμα φόρτωσης τρόπων παράδοσης: {customMethodsRes.error.message}
            </p>
          )}
          <CustomDeliveryMethodsSection
            methods={customMethods}
            carriers={carrierOptions}
          />
        </>
      )}

      {/* --------------------------------------------------------------- *
       *  Tab: Μεγέθη πακέτου (volumetric prefixes)                       *
       * --------------------------------------------------------------- */}
      {activeTab === "prefixes" && (
        <VolumetricPrefixesSection
          initial={volumetricPrefixes}
          knownCarrierSlugs={knownCarrierSlugs}
        />
      )}

      {/* --------------------------------------------------------------- *
       *  Tab: API integrations                                            *
       * --------------------------------------------------------------- */}
      {activeTab === "api" && (
        <>
          {providersRes.error && (
            <p className="text-sm text-destructive mb-4">
              Σφάλμα φόρτωσης: {providersRes.error.message}
            </p>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
            {/* ─── Existing API integrations (compact, sticky on xl+) ─── */}
            <section className="space-y-3 xl:sticky xl:top-6 xl:self-start">
              <header className="flex items-baseline justify-between">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Διαμορφωμένες integrations
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Credentials και capabilities ανά μεταφορική με API
                    integration. Οι custom μεταφορικές δεν χρειάζονται ρύθμιση
                    εδώ.
                  </p>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                  {providers.length} συνολικά
                </span>
              </header>

              {providers.length === 0 ? (
                <div className="cms-empty">
                  Δεν έχει ρυθμιστεί κανένας courier. Συμπληρώστε τη φόρμα δεξιά
                  για να ξεκινήσετε με το ACS.
                </div>
              ) : (
                <ul className="space-y-3">
                  {providers.map((p) => (
                    <li
                      key={p.id}
                      className={`cms-card transition-colors ${
                        editing && editing.id === p.id
                          ? "border-foreground"
                          : ""
                      }`}
                    >
                      <header className="flex flex-wrap items-start justify-between gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold tracking-tight">
                            {p.display_name}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {p.is_active ? (
                              <span className="cms-badge cms-badge-neutral">
                                <span className="cms-badge-dot" aria-hidden />
                                Ενεργή
                              </span>
                            ) : (
                              <span className="cms-badge cms-badge-muted">
                                ανενεργή
                              </span>
                            )}
                            <span className="cms-badge cms-badge-muted">
                              {CARRIER_LABELS[p.carrier] ?? p.carrier}
                            </span>
                            {!p.secrets_encrypted && (
                              <span className="cms-badge border-foreground/40 bg-background font-semibold">
                                Χωρίς credentials
                              </span>
                            )}
                          </div>
                        </div>
                      </header>

                      {p.last_test_at && (
                        <div className="rounded-md border border-foreground/10 bg-muted/30 px-2.5 py-1.5 text-xs mb-3">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`inline-block w-1.5 h-1.5 rounded-full ${
                                p.last_test_status === "success"
                                  ? "bg-foreground"
                                  : "bg-destructive"
                              }`}
                              aria-hidden
                            />
                            <span className="font-medium capitalize">
                              {p.last_test_status === "success"
                                ? "Επιτυχημένο test"
                                : "Αποτυχημένο test"}
                            </span>
                            <span className="text-muted-foreground">
                              ·{" "}
                              {new Date(p.last_test_at).toLocaleString("el-GR")}
                            </span>
                          </div>
                          {p.last_test_message && (
                            <p className="text-muted-foreground mt-0.5 truncate">
                              {p.last_test_message}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link
                          href={`/admin/settings/couriers?tab=api&edit=${p.id}`}
                          className="btn btn-secondary btn-sm"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Επεξεργασία
                        </Link>
                        <CarrierProviderRowActions provider={p} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* ACS directory cache widget — only rendered when an ACS row
                  with credentials exists. Without that, the widget can't
                  actually refresh anything. */}
              {acsActiveConfigured && acsCacheData && (
                <AcsDirectoryRefresh
                  initialCounts={{
                    centralStores: acsCacheData.kind1Count,
                    smartPoints: acsCacheData.kind7Count,
                  }}
                  initialLastRefreshed={{
                    centralStores: acsCacheData.kind1Latest,
                    smartPoints: acsCacheData.kind7Latest,
                  }}
                  acsConfigured={acsActiveConfigured}
                />
              )}
            </section>

            {/* ─── Form panel — takes the wider column ─── */}
            <section className="cms-card">
              <header className="flex items-center justify-between mb-4 pb-4 border-b border-foreground/10">
                <div className="flex items-baseline gap-3 min-w-0">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {editing ? "Επεξεργασία ρύθμισης" : "Νέα ρύθμιση"}
                  </h2>
                  {editing && (
                    <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded truncate">
                      {editing.display_name}
                    </span>
                  )}
                </div>
                {editing && (
                  <Link
                    href="/admin/settings/couriers?tab=api"
                    className="text-xs text-muted-foreground hover:text-foreground underline whitespace-nowrap"
                  >
                    ← Νέα
                  </Link>
                )}
              </header>
              <CarrierProviderForm initial={editing || undefined} />
            </section>
          </div>
        </>
      )}
    </>
  );
}
