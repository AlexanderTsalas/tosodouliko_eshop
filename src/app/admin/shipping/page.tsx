import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { Pencil } from "@/components/admin/common/icons";
import {
  DeleteZoneButton,
  DeleteRateButton,
} from "@/components/admin/shipping/ShippingDeleteButtons";
import type { ShippingZone, ShippingRate } from "@/types/shipping";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Αποστολή — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminShippingPage() {
  await requirePermission("manage:shipping");
  const supabase = await createClient();

  const [zonesRes, ratesRes] = await Promise.all([
    supabase.from("shipping_zones").select("*").order("name"),
    supabase.from("shipping_rates").select("*").order("carrier"),
  ]);

  const zones = (zonesRes.data ?? []) as ShippingZone[];
  const rates = (ratesRes.data ?? []) as ShippingRate[];

  return (
    <>
      <PageHeader
        title="Αποστολή"
        description="Ζώνες χωρών και χρεώσεις αποστολής που εφαρμόζονται στις παραγγελίες."
      />

      <section className="mb-10">
        <header className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Ζώνες αποστολής
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {zones.length.toLocaleString("el-GR")} συνολικά
            </p>
          </div>
          <Link
            href="/admin/shipping/zones/new"
            className="btn btn-primary btn-md"
          >
            <span className="text-base leading-none">+</span> Νέα ζώνη
          </Link>
        </header>
        {zones.length === 0 ? (
          <div className="cms-empty">Δεν υπάρχουν ζώνες.</div>
        ) : (
          <div className="cms-table-wrap">
            <table className="cms-table">
              <thead>
                <tr>
                  <th>Όνομα</th>
                  <th>Κωδικός</th>
                  <th>Χώρες</th>
                  <th>Ενεργή</th>
                  <th>Ενέργειες</th>
                </tr>
              </thead>
              <tbody className="content-reveal">
                {zones.map((z) => (
                  <tr key={z.id} className={!z.active ? "opacity-60" : ""}>
                    <td className="font-medium">{z.name}</td>
                    <td className="font-mono text-xs">{z.code}</td>
                    <td className="font-mono text-xs text-muted-foreground">
                      {z.country_codes.join(", ")}
                    </td>
                    <td>
                      {z.active ? (
                        <span className="cms-badge cms-badge-neutral">
                          <span className="cms-badge-dot" aria-hidden />
                          Ενεργή
                        </span>
                      ) : (
                        <span className="cms-badge cms-badge-muted">
                          Ανενεργή
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-center gap-1.5">
                        <Link
                          href={`/admin/shipping/zones/${z.id}/edit`}
                          className="btn btn-secondary btn-sm"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Επεξεργασία
                        </Link>
                        <DeleteZoneButton id={z.id} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <header className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Χρεώσεις αποστολής
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {rates.length.toLocaleString("el-GR")} συνολικά
            </p>
          </div>
          <Link
            href="/admin/shipping/rates/new"
            className="btn btn-primary btn-md"
          >
            <span className="text-base leading-none">+</span> Νέα χρέωση
          </Link>
        </header>
        {rates.length === 0 ? (
          <div className="cms-empty">Δεν υπάρχουν χρεώσεις.</div>
        ) : (
          <div className="cms-table-wrap">
            <table className="cms-table">
              <thead>
                <tr>
                  <th>Μεταφορέας</th>
                  <th>Ζώνη</th>
                  <th>Βάρος (g)</th>
                  <th className="text-center">Τιμή</th>
                  <th className="text-center">Δωρεάν πάνω από</th>
                  <th>Ενεργό</th>
                  <th className="text-center">Ενέργειες</th>
                </tr>
              </thead>
              <tbody className="content-reveal">
                {rates.map((r) => (
                  <tr key={r.id} className={!r.active ? "opacity-60" : ""}>
                    <td className="font-medium">{r.carrier}</td>
                    <td className="font-mono text-xs">{r.zone}</td>
                    <td className="font-mono text-xs">
                      {r.min_weight_g}–{r.max_weight_g ?? "∞"}
                    </td>
                    <td className="text-center font-mono tabular-nums">
                      {r.rate}
                    </td>
                    <td className="text-center font-mono tabular-nums text-xs">
                      {r.free_above ?? "—"}
                    </td>
                    <td>
                      {r.active ? (
                        <span className="cms-badge cms-badge-neutral">
                          <span className="cms-badge-dot" aria-hidden />
                          Ενεργό
                        </span>
                      ) : (
                        <span className="cms-badge cms-badge-muted">
                          Ανενεργό
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-center gap-1.5">
                        <Link
                          href={`/admin/shipping/rates/${r.id}/edit`}
                          className="btn btn-secondary btn-sm"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Επεξεργασία
                        </Link>
                        <DeleteRateButton id={r.id} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
