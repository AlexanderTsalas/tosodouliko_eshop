import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import DailyHandoffCard from "@/components/admin/operations/DailyHandoffCard";
import { getCapabilities } from "@/lib/courier/getCapabilities";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Καθημερινό κλείσιμο — Admin" };
export const dynamic = "force-dynamic";

/**
 * Phase 8b — daily handoff. Lists each integrated carrier with the
 * batch_finalize capability ON, shows how many vouchers are awaiting
 * pickup-list closure (orders with tracking_number set + status
 * label_created), and gives the admin a one-click "Κλείσιμο παρτίδας"
 * button per carrier.
 *
 * The "last batch closed" reference comes from audit_events
 * (action='courier.batch_finalized') so the admin can verify what was sent
 * and when — useful when reconciling with the carrier's daily pickup
 * receipt.
 */
export default async function DailyHandoffPage() {
  await requirePermission("manage:couriers");
  const admin = createAdminClient();

  // 1. All active built-in carriers. (Custom carriers can't have batch_finalize
  //    on because they have no provider class.)
  const { data: carrierRows } = await admin
    .from("delivery_carriers")
    .select("slug, display_name")
    .eq("is_active", true)
    .eq("is_custom", false)
    .order("display_order", { ascending: true });
  const carriers = (carrierRows ?? []) as Array<{
    slug: string;
    display_name: string;
  }>;

  // 2. Filter to carriers whose capability set includes batch_finalize.
  const eligible: typeof carriers = [];
  for (const c of carriers) {
    const caps = await getCapabilities(c.slug);
    if (caps.has("batch_finalize")) eligible.push(c);
  }

  // 3. For each eligible carrier: how many orders are pending closure?
  //    We use the heuristic: tracking_number IS NOT NULL AND
  //    fulfillment_status='label_created'. Once the voucher progresses
  //    (in_transit, etc.) we assume the carrier has picked it up and the
  //    batch was closed (manually or automatically).
  const pendingByCarrier = new Map<string, number>();
  if (eligible.length > 0) {
    // One query per carrier — small N (at most 6 built-ins), parallelisable
    // but Postgres can serve all of them in a few ms each.
    await Promise.all(
      eligible.map(async (c) => {
        const { count } = await admin
          .from("orders")
          .select("id", { count: "exact", head: true })
          .or(`carrier_slug.eq.${c.slug},carrier.eq.${c.slug}`)
          .not("tracking_number", "is", null)
          .eq("fulfillment_status", "label_created");
        pendingByCarrier.set(c.slug, count ?? 0);
      })
    );
  }

  // 4. Last batch closing per carrier — read most recent successful audit
  //    event so the admin can cross-reference with the carrier's records.
  const lastByCarrier = new Map<
    string,
    { batchId: string | null; finalizedAt: string | null }
  >();
  if (eligible.length > 0) {
    await Promise.all(
      eligible.map(async (c) => {
        const { data: auditRow } = await admin
          .from("audit_events")
          .select("created_at, metadata")
          .eq("action", "courier.batch_finalized")
          .eq("resource_type", "carrier_provider")
          .eq("resource_id", c.slug)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const row = auditRow as {
          created_at: string;
          metadata: { batch_id?: string | null } | null;
        } | null;
        lastByCarrier.set(c.slug, {
          batchId: row?.metadata?.batch_id ?? null,
          finalizedAt: row?.created_at ?? null,
        });
      })
    );
  }

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Καθημερινό κλείσιμο παρτίδας</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Κλείστε τα ημερήσια voucher batches πριν ο courier παραλάβει. Κάθε
          μεταφορική έχει δικό της κουμπί · απαιτείται μία φορά την ημέρα.
        </p>
      </header>

      {eligible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Καμία μεταφορική δεν έχει ενεργοποιημένο το capability «Κλείσιμο
          παρτίδας».{" "}
          <Link href="/admin/settings/couriers" className="underline">
            Ρυθμίσεις μεταφορικών
          </Link>
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {eligible.map((c) => {
            const last = lastByCarrier.get(c.slug);
            return (
              <DailyHandoffCard
                key={c.slug}
                carrierSlug={c.slug}
                carrierDisplayName={c.display_name}
                pendingCount={pendingByCarrier.get(c.slug) ?? 0}
                lastBatchId={last?.batchId ?? null}
                lastFinalizedAt={last?.finalizedAt ?? null}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
