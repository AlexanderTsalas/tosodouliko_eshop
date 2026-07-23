"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { listAcsStations } from "@/actions/courier-settings";

interface Props {
  /**
   * Snapshot of how many rows are cached per ACS_SHOP_KIND, captured at
   * server-render time. Updated optimistically after a successful refresh
   * without a hard page reload.
   */
  initialCounts: { centralStores: number; smartPoints: number };
  /**
   * Most recent cached_at across each kind (max), for the "Τελευταία ανανέωση"
   * display. Null when the cache is empty for that kind.
   */
  initialLastRefreshed: {
    centralStores: string | null;
    smartPoints: string | null;
  };
  /**
   * Whether ACS has an active provider config (credentials saved + is_active).
   * When false, refresh buttons are disabled with an explanatory note —
   * listAcsStations would fall back to the empty cache without ACS to call.
   */
  acsConfigured: boolean;
}

/**
 * Phase 6 — admin Couriers page widget for refreshing the ACS directory
 * caches (central stores + Smart Points). Hits listAcsStations with
 * force_refresh=true; the action handles ACS API errors gracefully (returns
 * the stale cache when the live call fails).
 *
 * Smart Points specifically: KIND=7 in ACS_SHOP_KIND. The Phase 7
 * LocationPicker reads from these cached rows to render the locker tab.
 * Until Phase 10 wires a weekly cron, the admin clicks this button to keep
 * the cache fresh (or it ages out via the 30-day TTL).
 */
export default function AcsDirectoryRefresh({
  initialCounts,
  initialLastRefreshed,
  acsConfigured,
}: Props) {
  const router = useRouter();
  const [counts, setCounts] = useState(initialCounts);
  const [lastRefreshed, setLastRefreshed] = useState(initialLastRefreshed);
  const [isPending, startTransition] = useTransition();
  const [busyKind, setBusyKind] = useState<1 | 7 | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh(kind: 1 | 7) {
    setError(null);
    setBusyKind(kind);
    startTransition(async () => {
      const res = await listAcsStations({
        country: "GR",
        shop_kind: kind,
        force_refresh: true,
      });
      setBusyKind(null);
      if (!res.success) {
        setError(res.error);
        return;
      }
      const now = new Date().toISOString();
      if (kind === 1) {
        setCounts((c) => ({ ...c, centralStores: res.data.length }));
        setLastRefreshed((p) => ({ ...p, centralStores: now }));
      } else {
        setCounts((c) => ({ ...c, smartPoints: res.data.length }));
        setLastRefreshed((p) => ({ ...p, smartPoints: now }));
      }
      // Refresh the page in the background so other sections (e.g., last_test_at
      // on a provider row) pick up any related updates. Doesn't block the UI.
      router.refresh();
    });
  }

  return (
    <section className="border rounded p-4">
      <h2 className="text-lg font-semibold mb-1">ACS directory cache</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Λίστα καταστημάτων + Smart Point lockers που εμφανίζονται στον
        location picker του πελάτη. Ανανεώνεται αυτόματα ανά 30 ημέρες · κλικ
        για άμεση ανανέωση.
      </p>

      {!acsConfigured && (
        <div className="rounded border border-amber-500 bg-amber-50 px-3 py-2 mb-3 text-xs text-amber-900">
          Δεν έχει ενεργοποιημένη ρύθμιση ACS. Συμπληρώστε credentials στο
          παρακάτω form και ενεργοποιήστε τη ρύθμιση για να γίνει εφικτή η
          ανανέωση.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <DirectoryRow
          title="Κεντρικά καταστήματα (KIND=1)"
          count={counts.centralStores}
          lastRefreshed={lastRefreshed.centralStores}
          isBusy={busyKind === 1}
          disabled={!acsConfigured || isPending}
          onRefresh={() => refresh(1)}
        />
        <DirectoryRow
          title="Smart Points / Lockers (KIND=7)"
          count={counts.smartPoints}
          lastRefreshed={lastRefreshed.smartPoints}
          isBusy={busyKind === 7}
          disabled={!acsConfigured || isPending}
          onRefresh={() => refresh(7)}
        />
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  );
}

function DirectoryRow({
  title,
  count,
  lastRefreshed,
  isBusy,
  disabled,
  onRefresh,
}: {
  title: string;
  count: number;
  lastRefreshed: string | null;
  isBusy: boolean;
  disabled: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="border rounded p-3">
      <p className="font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mt-0.5">
        {count > 0
          ? `${count.toLocaleString("el-GR")} εγγραφές · `
          : "Καμία εγγραφή — "}
        {lastRefreshed
          ? `τελευταία ανανέωση: ${new Date(lastRefreshed).toLocaleString("el-GR")}`
          : "δεν έχει ανανεωθεί ποτέ"}
      </p>
      <button
        type="button"
        onClick={onRefresh}
        disabled={disabled}
        className="mt-2 rounded border px-3 py-1 text-xs disabled:opacity-50"
      >
        {isBusy ? "Ανανέωση..." : "Ανανέωση τώρα"}
      </button>
    </div>
  );
}
