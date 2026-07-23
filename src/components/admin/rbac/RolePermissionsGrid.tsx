"use client";

import { useMemo, useState, useTransition } from "react";
import { setRolePermissions } from "@/actions/rbac/setRolePermissions";
import type { Permission } from "@/types/rbac";

interface Props {
  roleId: string;
  allPermissions: Permission[];
  initialPermissionIds: string[];
}

/**
 * Grouped permission editor for a role. Permissions are organised by
 * resource (e.g. `products`, `orders`, `users`) into resource cards;
 * each card has its own select-all / clear-all controls so admins can
 * grant or revoke entire resource scopes with one click.
 *
 * UX details:
 *   - Live search box filters resources + actions, hiding empty groups
 *   - Sticky save bar shows pending changes vs. baseline + count summary
 *   - Save is destructive (overrides current permission set), so we keep
 *     the original baseline around to compute the delta for the badge
 *     "X προσθήκες · Y αφαιρέσεις"
 *   - Selecting/clearing only flips visible permissions when a search
 *     query is active — so admins don't accidentally wipe permissions
 *     they filtered out of view
 */
export default function RolePermissionsGrid({
  roleId,
  allPermissions,
  initialPermissionIds,
}: Props) {
  const baseline = useMemo(
    () => new Set(initialPermissionIds),
    [initialPermissionIds]
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(baseline));
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  // --- Grouping + filtering -------------------------------------------
  const byResource = useMemo(() => {
    const m = new Map<string, Permission[]>();
    for (const p of allPermissions) {
      const list = m.get(p.resource) ?? [];
      list.push(p);
      m.set(p.resource, list);
    }
    return m;
  }, [allPermissions]);
  const resources = useMemo(() => Array.from(byResource.keys()).sort(), [byResource]);

  const filteredByResource = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return byResource;
    const result = new Map<string, Permission[]>();
    for (const [res, list] of byResource) {
      const filtered = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          res.toLowerCase().includes(q)
      );
      if (filtered.length > 0) result.set(res, filtered);
    }
    return result;
  }, [byResource, query]);
  const visibleResources = useMemo(
    () => Array.from(filteredByResource.keys()).sort(),
    [filteredByResource]
  );

  // --- Mutation helpers ----------------------------------------------
  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleResource(res: string, on: boolean) {
    setSelected((cur) => {
      const next = new Set(cur);
      for (const p of filteredByResource.get(res) ?? []) {
        if (on) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
  }
  function selectAllVisible() {
    setSelected((cur) => {
      const next = new Set(cur);
      for (const list of filteredByResource.values()) {
        for (const p of list) next.add(p.id);
      }
      return next;
    });
  }
  function clearAllVisible() {
    setSelected((cur) => {
      const next = new Set(cur);
      for (const list of filteredByResource.values()) {
        for (const p of list) next.delete(p.id);
      }
      return next;
    });
  }
  function resetToBaseline() {
    setSelected(new Set(baseline));
  }

  // --- Delta vs. baseline (for save bar) -----------------------------
  const adds = useMemo(() => {
    let n = 0;
    for (const id of selected) if (!baseline.has(id)) n++;
    return n;
  }, [selected, baseline]);
  const removes = useMemo(() => {
    let n = 0;
    for (const id of baseline) if (!selected.has(id)) n++;
    return n;
  }, [selected, baseline]);
  const dirty = adds > 0 || removes > 0;

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await setRolePermissions({
        roleId,
        permissionIds: Array.from(selected),
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setSavedAt(Date.now());
      // Baseline can't be reassigned (it's a useMemo over a prop), but
      // since the prop is server-fetched and the page would reload to
      // reflect new state, we leave baseline as-is until the next
      // render. Until then `dirty` will read false because selected
      // matches the new server state on next mount.
    });
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Δικαιώματα
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {selected.size} ενεργά από {allPermissions.length} συνολικά
            {query && (
              <>
                {" "}· {Array.from(filteredByResource.values()).reduce(
                  (acc, l) => acc + l.length,
                  0
                )}{" "}
                ορατά
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Αναζήτηση δικαιώματος..."
            className="cms-input cms-input-sm min-w-[220px]"
          />
          <button
            type="button"
            onClick={selectAllVisible}
            className="btn btn-secondary btn-sm"
          >
            Επιλογή ορατών
          </button>
          <button
            type="button"
            onClick={clearAllVisible}
            className="btn btn-secondary btn-sm"
          >
            Καθαρισμός ορατών
          </button>
        </div>
      </header>

      {visibleResources.length === 0 ? (
        <div className="cms-empty">Δεν βρέθηκαν δικαιώματα.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {visibleResources.map((res) => {
            const list = filteredByResource.get(res) ?? [];
            const selectedHere = list.filter((p) => selected.has(p.id)).length;
            const allOn = selectedHere === list.length;
            const someOn = selectedHere > 0 && !allOn;
            return (
              <section
                key={res}
                className="cms-card flex flex-col"
              >
                <header className="flex items-center justify-between gap-2 pb-2 border-b border-foreground/10 mb-2">
                  <h3 className="font-semibold capitalize tracking-tight">
                    {res}
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={
                        allOn
                          ? "cms-badge cms-badge-neutral"
                          : someOn
                          ? "cms-badge border-foreground/40 bg-background"
                          : "cms-badge cms-badge-muted"
                      }
                    >
                      {selectedHere}/{list.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleResource(res, !allOn)}
                      className="text-xs underline text-muted-foreground hover:text-foreground"
                    >
                      {allOn ? "καθαρισμός" : "όλα"}
                    </button>
                  </div>
                </header>
                <ul className="space-y-1.5">
                  {list.map((p) => {
                    const isOn = selected.has(p.id);
                    return (
                      <li key={p.id}>
                        <label
                          className={`flex items-start gap-2.5 rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
                            isOn
                              ? "bg-muted/40"
                              : "hover:bg-muted/30"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isOn}
                            onChange={() => toggle(p.id)}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-xs">{p.name}</p>
                            {p.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {p.description}
                              </p>
                            )}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {/* Sticky save bar. Only renders when there's an unsaved change vs.
          the original baseline — keeps the page calm otherwise. */}
      {(dirty || error || savedAt) && (
        <div
          className={`sticky bottom-4 z-10 rounded-lg border px-4 py-3 flex flex-wrap items-center gap-3 shadow-md backdrop-blur ${
            error
              ? "border-destructive bg-destructive/5"
              : "border-foreground bg-background/95"
          }`}
        >
          {error ? (
            <span className="text-sm text-destructive flex-1">{error}</span>
          ) : (
            <div className="flex-1 text-sm">
              {dirty ? (
                <span>
                  Μη αποθηκευμένες αλλαγές:{" "}
                  {adds > 0 && (
                    <span className="font-semibold">+{adds} προσθήκ{adds === 1 ? "η" : "ες"}</span>
                  )}
                  {adds > 0 && removes > 0 && " · "}
                  {removes > 0 && (
                    <span className="font-semibold">−{removes} αφαίρεσ{removes === 1 ? "η" : "εις"}</span>
                  )}
                </span>
              ) : savedAt ? (
                <span className="text-muted-foreground">✓ Αποθηκεύτηκε</span>
              ) : null}
            </div>
          )}
          {dirty && (
            <>
              <button
                type="button"
                onClick={resetToBaseline}
                disabled={isPending}
                className="btn btn-ghost btn-sm"
              >
                Επαναφορά
              </button>
              <button
                type="button"
                onClick={save}
                disabled={isPending}
                className="btn btn-primary btn-md"
              >
                {isPending ? "Αποθήκευση..." : "Αποθήκευση αλλαγών"}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
