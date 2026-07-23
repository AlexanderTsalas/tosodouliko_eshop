"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  forceReleaseSoftSession,
  forceReleasePriorityHold,
} from "@/actions/inventory-debug";

interface SoftSession {
  id: string;
  customer_id: string;
  customer_email: string | null;
  customer_name: string | null;
  state: string;
  expires_at: string;
  last_heartbeat_at: string | null;
  cart_quantity: number;
}
interface PriorityHold {
  id: string;
  customer_id: string;
  customer_email: string | null;
  customer_name: string | null;
  source: "soft_wait_promotion" | "wishlist_notification";
  quantity: number;
  expires_at: string;
}
interface SoftWait {
  id: string;
  customer_id: string;
  customer_email: string | null;
  customer_name: string | null;
  checkout_session_id: string;
  quantity: number;
  promoted_at: string | null;
  created_at: string;
}

interface Snapshot {
  variant: {
    id: string;
    sku: string;
    label: string | null;
    product_name: string;
    product_slug: string;
  } | null;
  inventory: {
    quantity_available: number;
    quantity_reserved: number;
    quantity_soft_held: number;
    quantity_priority_held: number;
  } | null;
  soft_sessions: SoftSession[];
  priority_holds: PriorityHold[];
  soft_waits: SoftWait[];
  notify_subscriber_count: number;
}

interface Props {
  query: string;
  snapshot: Snapshot | null;
}

export default function InventoryDebugView({ query, snapshot }: Props) {
  const router = useRouter();
  const [input, setInput] = useState(query);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    router.push(
      trimmed ? `/admin/inventory-debug?variant=${encodeURIComponent(trimmed)}` : "/admin/inventory-debug"
    );
  }

  function handleReleaseSession(id: string) {
    if (!window.confirm("Force-release αυτής της soft session;")) return;
    setError(null);
    startTransition(async () => {
      const r = await forceReleaseSoftSession({ session_id: id });
      if (!r.success) setError(r.error);
    });
  }

  function handleReleaseHold(id: string) {
    if (!window.confirm("Force-release αυτού του priority hold;")) return;
    setError(null);
    startTransition(async () => {
      const r = await forceReleasePriorityHold({ hold_id: id });
      if (!r.success) setError(r.error);
    });
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Inventory debug</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Επισκόπηση και χειροκίνητη απελευθέρωση κρατήσεων ανά παραλλαγή.
        </p>
      </header>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Variant UUID ή SKU"
          className="flex-1 rounded border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Αναζήτηση
        </button>
      </form>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {snapshot === null ? (
        <p className="text-sm text-muted-foreground">
          Δώστε ένα variant UUID ή SKU για να δείτε την κατάσταση.
        </p>
      ) : !snapshot.variant ? (
        <p className="text-sm text-destructive">Δεν βρέθηκε παραλλαγή.</p>
      ) : (
        <>
          <section className="rounded border p-4">
            <h2 className="font-medium">
              {snapshot.variant.product_name}
              {snapshot.variant.label && (
                <span className="text-muted-foreground"> · {snapshot.variant.label}</span>
              )}
            </h2>
            <p className="text-xs font-mono text-muted-foreground mt-1">
              SKU {snapshot.variant.sku} · {snapshot.variant.id}
            </p>
            {snapshot.inventory && (
              <dl className="mt-3 grid grid-cols-4 gap-3 text-sm">
                <Stat label="Διαθέσιμα" value={snapshot.inventory.quantity_available} />
                <Stat label="Reserved" value={snapshot.inventory.quantity_reserved} />
                <Stat
                  label="Soft held"
                  value={snapshot.inventory.quantity_soft_held}
                  warn={snapshot.inventory.quantity_soft_held > 0}
                />
                <Stat
                  label="Priority held"
                  value={snapshot.inventory.quantity_priority_held}
                  warn={snapshot.inventory.quantity_priority_held > 0}
                />
              </dl>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              {snapshot.notify_subscriber_count} συνδρομητές περιμένουν ειδοποίηση
              αποθέματος
            </p>
          </section>

          <section className="rounded border">
            <h3 className="px-4 py-2 border-b text-sm font-medium">
              Active soft sessions ({snapshot.soft_sessions.length})
            </h3>
            {snapshot.soft_sessions.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Καμία.</p>
            ) : (
              <ul className="divide-y">
                {snapshot.soft_sessions.map((s) => (
                  <li
                    key={s.id}
                    className="px-4 py-3 text-sm flex items-start justify-between gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">
                        {s.customer_name ?? s.customer_email ?? s.customer_id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.state} · {s.cart_quantity} σε καλάθι · expires{" "}
                        {new Date(s.expires_at).toLocaleString("el-GR")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleReleaseSession(s.id)}
                      disabled={isPending}
                      className="rounded border border-destructive px-3 py-1 text-xs text-destructive disabled:opacity-50"
                    >
                      Force release
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded border">
            <h3 className="px-4 py-2 border-b text-sm font-medium">
              Active priority holds ({snapshot.priority_holds.length})
            </h3>
            {snapshot.priority_holds.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Κανένα.</p>
            ) : (
              <ul className="divide-y">
                {snapshot.priority_holds.map((h) => (
                  <li
                    key={h.id}
                    className="px-4 py-3 text-sm flex items-start justify-between gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">
                        {h.customer_name ?? h.customer_email ?? h.customer_id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {h.source === "wishlist_notification" ? "Wishlist" : "Soft-wait"}{" "}
                        · qty {h.quantity} · expires{" "}
                        {new Date(h.expires_at).toLocaleString("el-GR")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleReleaseHold(h.id)}
                      disabled={isPending}
                      className="rounded border border-destructive px-3 py-1 text-xs text-destructive disabled:opacity-50"
                    >
                      Force release
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded border">
            <h3 className="px-4 py-2 border-b text-sm font-medium">
              Soft-wait queue ({snapshot.soft_waits.length})
            </h3>
            {snapshot.soft_waits.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Άδειο.</p>
            ) : (
              <ul className="divide-y">
                {snapshot.soft_waits.map((w, idx) => (
                  <li key={w.id} className="px-4 py-3 text-sm">
                    <p className="font-medium">
                      #{idx + 1}{" "}
                      {w.customer_name ?? w.customer_email ?? w.customer_id}
                      {w.promoted_at && (
                        <span className="ml-2 text-xs text-emerald-700">
                          (promoted)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      qty {w.quantity} · ζητήθηκε{" "}
                      {new Date(w.created_at).toLocaleString("el-GR")} · behind
                      session {w.checkout_session_id.slice(0, 8)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded border p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 font-mono font-semibold ${warn ? "text-amber-700" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
