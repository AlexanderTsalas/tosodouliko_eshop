"use client";

import { useEffect, useState, useTransition } from "react";
import { listPickupPoints } from "@/actions/checkout/listPickupPoints";
import type { PickupPoint } from "@/actions/checkout/listPickupPoints";
import type { CarrierSlug } from "@/config/carrier-slugs";

/**
 * What the customer selected — flows back up to CheckoutForm and lands on
 * orders.pickup_* columns at placement.
 */
export interface PickupSelection {
  carrier: CarrierSlug;
  station_id: string;
  branch_id: number;
  type: "locker" | "branch";
  /** Human-readable summary for confirm displays. */
  display_label: string;
}

interface Props {
  carrier: CarrierSlug | null;
  carrierDisplayName: string | null;
  recipientZip: string;
  recipientCountry: string;
  /**
   * Which delivery method the customer chose. Drives the default tab:
   *   delivery_station_pickup → 'locker'
   *   carrier_pickup          → 'branch'
   */
  deliveryMethod: "delivery_station_pickup" | "carrier_pickup";
  value: PickupSelection | null;
  onSelect: (selection: PickupSelection | null) => void;
}

/**
 * Phase 7 — pickup-point picker at checkout. Used when delivery_method is
 * `delivery_station_pickup` (locker) or `carrier_pickup` (branch).
 *
 * Tabs (locker / branch) let the customer switch between types; default is
 * driven by deliveryMethod. The list shows the top-20 closest points to
 * the recipient zip's serving station, sorted by haversine distance.
 *
 * When the zip can't be anchored (cold cache or carrier without
 * address_validation capability), the list is name-sorted with an
 * explanatory note.
 *
 * Selection is local; the parent CheckoutForm threads it into placeOrder.
 */
export default function LocationPicker({
  carrier,
  carrierDisplayName,
  recipientZip,
  recipientCountry,
  deliveryMethod,
  value,
  onSelect,
}: Props) {
  const [tab, setTab] = useState<"locker" | "branch">(
    deliveryMethod === "delivery_station_pickup" ? "locker" : "branch"
  );
  const [searchZip, setSearchZip] = useState(recipientZip);
  const [points, setPoints] = useState<PickupPoint[] | null>(null);
  const [proximitySorted, setProximitySorted] = useState(false);
  const [deferredAvailable, setDeferredAvailable] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Keep the search-zip input in sync when the recipient zipcode changes
  // upstream (customer edits shipping address while picker is open).
  useEffect(() => {
    setSearchZip(recipientZip);
  }, [recipientZip]);

  // Re-default the tab when the customer switches delivery method between
  // locker and branch upstream.
  useEffect(() => {
    setTab(deliveryMethod === "delivery_station_pickup" ? "locker" : "branch");
  }, [deliveryMethod]);

  // Fetch whenever (carrier, tab, country, zip) changes. Debounce zip so
  // typing doesn't fire a query per keystroke.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    const timer = setTimeout(() => {
      startTransition(async () => {
        const res = await listPickupPoints({
          carrier,
          type: tab,
          country: recipientCountry || "GR",
          recipient_zipcode: searchZip || undefined,
          limit: 20,
        });
        if (cancelled) return;
        if (res.success) {
          setPoints(res.data.points);
          setProximitySorted(res.data.proximity_sorted);
          setDeferredAvailable(res.data.deferred_available);
        } else {
          setError(res.error);
          setPoints([]);
          setDeferredAvailable(false);
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [carrier, tab, recipientCountry, searchZip]);

  // When the customer changes tab or carrier, the prior selection becomes
  // moot. Clear it so the parent's auto-reset doesn't carry over a stale
  // station_id from a different list.
  useEffect(() => {
    if (value && (value.carrier !== carrier || value.type !== tab)) {
      onSelect(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrier, tab]);

  if (!carrier) {
    return (
      <div className="border rounded p-3 text-sm text-muted-foreground">
        Επιλέξτε μεταφορική για να δείτε τα διαθέσιμα σημεία παραλαβής.
      </div>
    );
  }

  return (
    <div className="border rounded p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setTab("locker")}
          className={`rounded border px-3 py-1 text-xs ${
            tab === "locker" ? "bg-primary text-primary-foreground" : ""
          }`}
        >
          Locker / Smart Point
        </button>
        <button
          type="button"
          onClick={() => setTab("branch")}
          className={`rounded border px-3 py-1 text-xs ${
            tab === "branch" ? "bg-primary text-primary-foreground" : ""
          }`}
        >
          Κατάστημα μεταφορικής
        </button>
      </div>

      <label className="block">
        <span className="block text-xs text-muted-foreground mb-1">
          Αναζήτηση με Τ.Κ.
        </span>
        <input
          type="text"
          value={searchZip}
          onChange={(e) => setSearchZip(e.target.value)}
          placeholder="π.χ. 10434"
          className="border rounded px-2 py-1 w-full text-sm"
        />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!proximitySorted && searchZip && !isPending && (points?.length ?? 0) > 0 && (
        <p className="text-xs text-amber-700">
          Δεν εντοπίστηκε γεωθέση για τον Τ.Κ. — η λίστα εμφανίζεται
          αλφαβητικά. Δοκιμάστε άλλο κοντινό Τ.Κ. για ταξινόμηση κατά
          απόσταση.
        </p>
      )}

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {/* Phase 11 — BoxNow "any locker" option. Customer picks the
            specific locker after dispatch via the carrier's SMS flow.
            Rendered only on the locker tab when the carrier's
            defer_locker_selection capability is enabled. */}
        {tab === "locker" && deferredAvailable && (
          <button
            type="button"
            onClick={() =>
              onSelect({
                carrier: carrier as CarrierSlug,
                station_id: "deferred",
                branch_id: 0,
                type: "locker",
                display_label: "Επιλογή locker μετά την αποστολή",
              })
            }
            className={`block w-full text-left border-2 border-dashed rounded p-2 hover:border-primary transition-colors ${
              value?.station_id === "deferred" ? "border-primary bg-primary/5" : "border-muted-foreground/30"
            }`}
          >
            <p className="text-sm font-medium">
              Διαλέξτε locker αργότερα
            </p>
            <p className="text-xs text-muted-foreground">
              Η μεταφορική θα σας στείλει SMS όταν η παραγγελία φτάσει σε locker
              κοντά σας, και επιλέγετε εσείς τη συγκεκριμένη θυρίδα.
            </p>
          </button>
        )}

        {isPending && points === null ? (
          <p className="text-sm text-muted-foreground">Φόρτωση...</p>
        ) : points && points.length === 0 && !deferredAvailable ? (
          <p className="text-sm text-muted-foreground">
            Δεν βρέθηκαν σημεία
            {carrierDisplayName ? ` από την ${carrierDisplayName}` : ""}.
            {tab === "locker"
              ? " Δοκιμάστε άλλη μεταφορική ή το tab «Κατάστημα μεταφορικής»."
              : " Δοκιμάστε άλλη μεταφορική ή το tab «Locker / Smart Point»."}
          </p>
        ) : (
          points?.map((p) => {
            const isSelected =
              value?.station_id === p.station_id &&
              value?.branch_id === p.branch_id &&
              value?.type === tab &&
              value?.carrier === carrier;
            return (
              <button
                type="button"
                key={`${p.station_id}-${p.branch_id}`}
                onClick={() =>
                  onSelect({
                    carrier,
                    station_id: p.station_id,
                    branch_id: p.branch_id,
                    type: tab,
                    display_label: p.name + (p.address ? ` · ${p.address}` : ""),
                  })
                }
                className={`block w-full text-left border rounded p-2 hover:border-primary transition-colors ${
                  isSelected ? "border-primary bg-primary/5" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    {p.address && (
                      <p className="text-xs text-muted-foreground truncate">
                        {p.address}
                        {p.zipcode ? `, ${p.zipcode}` : ""}
                        {p.area ? ` · ${p.area}` : ""}
                      </p>
                    )}
                    {p.working_hours && (
                      <p className="text-xs text-muted-foreground truncate">
                        {p.working_hours}
                      </p>
                    )}
                  </div>
                  {p.distance_km !== null && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {p.distance_km < 1
                        ? `${Math.round(p.distance_km * 1000)} m`
                        : `${p.distance_km.toFixed(1)} km`}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {value && (
        <div className="rounded border border-primary bg-primary/5 p-2 text-sm">
          <p className="font-medium">Επιλεγμένο σημείο παραλαβής</p>
          <p className="text-xs text-muted-foreground mt-0.5">{value.display_label}</p>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="mt-2 text-xs underline"
          >
            Αλλαγή
          </button>
        </div>
      )}
    </div>
  );
}
