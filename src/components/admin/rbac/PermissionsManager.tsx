"use client";

import { useMemo, useState, useTransition } from "react";
import { createPermission } from "@/actions/rbac/createPermission";
import { deletePermission } from "@/actions/rbac/deletePermission";
import type { Permission } from "@/types/rbac";

/**
 * Built-in resource:action pairs seeded by the RBAC migrations and
 * referenced by RLS policies. The UI flags these so admins know they
 * can't delete them without breaking permission checks elsewhere.
 *
 * The trailing star matches "any action under this resource" — e.g.
 * "manage:products" qualifies as built-in via the "products" prefix
 * rule. We keep this client-side just for UI hinting; the server-side
 * deletePermission action is what actually enforces the rule.
 */
const BUILTIN_ACTIONS = new Set(["manage", "read"]);

/**
 * Permissions manager. Two-pane layout:
 *
 *   - Left: form to create a new permission with a live preview of the
 *     resulting `action:resource` slug
 *   - Right: existing permissions grouped by resource, with inline delete
 *     and a search box that filters across the whole tree
 *
 * Live search + ordered grouping replaces the previous wall of "resource
 * → list" sections that became hard to navigate at >30 permissions.
 */
export default function PermissionsManager({ initial }: { initial: Permission[] }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [resource, setResource] = useState("");
  const [action, setAction] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState("");

  const previewName =
    resource.trim() && action.trim()
      ? `${action.trim().toLowerCase()}:${resource.trim().toLowerCase()}`
      : null;

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await createPermission({
        resource: resource.trim().toLowerCase(),
        action: action.trim().toLowerCase(),
        description: description.trim() || undefined,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setItems((cur) => [r.data, ...cur]);
      setResource("");
      setAction("");
      setDescription("");
      setInfo(`Δημιουργήθηκε: ${r.data.name}`);
    });
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`Διαγραφή δικαιώματος '${name}';`)) return;
    setError(null);
    setInfo(null);
    const prev = items;
    setItems((cur) => cur.filter((p) => p.id !== id));
    startTransition(async () => {
      const r = await deletePermission({ id });
      if (!r.success) {
        setError(r.error);
        setItems(prev);
      }
    });
  }

  // Group + filter.
  const grouped = useMemo(() => {
    const m = new Map<string, Permission[]>();
    for (const p of items) {
      const list = m.get(p.resource) ?? [];
      list.push(p);
      m.set(p.resource, list);
    }
    return m;
  }, [items]);

  const filteredGrouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return grouped;
    const m = new Map<string, Permission[]>();
    for (const [res, list] of grouped) {
      const matches = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          res.toLowerCase().includes(q)
      );
      if (matches.length > 0) m.set(res, matches);
    }
    return m;
  }, [grouped, query]);

  const resources = useMemo(
    () => Array.from(filteredGrouped.keys()).sort(),
    [filteredGrouped]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
      {/* ─────────────────── Create panel (sticky on lg+) ─────────────────── */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <form onSubmit={handleCreate} className="cms-card space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Νέο δικαίωμα
          </h3>

          <label className="block">
            <span className="block text-xs font-medium mb-1">Resource</span>
            <input
              value={resource}
              onChange={(e) => setResource(e.target.value)}
              required
              placeholder="π.χ. reports"
              pattern="[a-z0-9-]+"
              className="cms-input font-mono"
            />
            <span className="text-[11px] text-muted-foreground mt-1 block">
              Πεζά γράμματα, αριθμοί ή παύλα.
            </span>
          </label>

          <label className="block">
            <span className="block text-xs font-medium mb-1">Action</span>
            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              required
              placeholder="π.χ. read, export"
              pattern="[a-z0-9_-]+"
              className="cms-input font-mono"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-medium mb-1">
              Περιγραφή <span className="text-muted-foreground">(προαιρετικό)</span>
            </span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Σύντομη περιγραφή"
              className="cms-input"
            />
          </label>

          {previewName && (
            <div className="rounded-md border border-foreground/15 bg-muted/30 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Θα δημιουργηθεί
              </p>
              <p className="font-mono text-sm font-semibold mt-0.5">
                {previewName}
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {info && !error && (
            <p role="status" className="text-xs text-muted-foreground">
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={isPending || !resource.trim() || !action.trim()}
            className="btn btn-primary btn-md w-full"
          >
            {isPending ? "Δημιουργία..." : "Δημιουργία δικαιώματος"}
          </button>

          <p className="text-[11px] text-muted-foreground border-t pt-3">
            Το πλήρες όνομα γίνεται{" "}
            <code className="font-mono">action:resource</code>. Χρήση στον
            κώδικα ως{" "}
            <code className="font-mono">has_permission(&apos;...&apos;)</code>.
          </p>
        </form>
      </aside>

      {/* ─────────────────── Existing permissions tree ─────────────────── */}
      <section className="space-y-3">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Υπάρχοντα δικαιώματα
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {items.length} συνολικά
              {query && (
                <>
                  {" "}· {Array.from(filteredGrouped.values()).reduce(
                    (a, l) => a + l.length,
                    0
                  )}{" "}
                  ορατά
                </>
              )}
            </p>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Αναζήτηση δικαιώματος..."
            className="cms-input cms-input-sm min-w-[260px]"
          />
        </header>

        {resources.length === 0 ? (
          <div className="cms-empty">
            {query
              ? "Δεν βρέθηκαν δικαιώματα για αυτή την αναζήτηση."
              : "Δεν υπάρχουν δικαιώματα."}
          </div>
        ) : (
          <div className="space-y-3">
            {resources.map((res) => {
              const list = filteredGrouped.get(res) ?? [];
              return (
                <section key={res} className="cms-card">
                  <header className="flex items-center justify-between pb-2 mb-2 border-b border-foreground/10">
                    <h3 className="font-semibold capitalize tracking-tight">
                      {res}
                    </h3>
                    <span className="cms-badge cms-badge-muted">
                      {list.length}
                    </span>
                  </header>
                  <ul className="divide-y divide-foreground/5">
                    {list.map((p) => {
                      const isBuiltin = BUILTIN_ACTIONS.has(p.action);
                      return (
                        <li
                          key={p.id}
                          className="py-2 flex items-start justify-between gap-3 hover:bg-muted/20 -mx-2 px-2 rounded-md transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-mono text-sm font-medium">
                                {p.name}
                              </p>
                              {isBuiltin && (
                                <span className="cms-badge cms-badge-muted text-[10px]">
                                  built-in
                                </span>
                              )}
                            </div>
                            {p.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {p.description}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDelete(p.id, p.name)}
                            disabled={isPending || isBuiltin}
                            className="btn btn-destructive btn-sm shrink-0"
                            aria-label={`Διαγραφή δικαιώματος ${p.name}`}
                            title={
                              isBuiltin
                                ? "Built-in — δεν διαγράφεται"
                                : "Διαγραφή"
                            }
                          >
                            ✕
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
