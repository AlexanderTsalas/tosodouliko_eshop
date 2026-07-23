import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import SystemErrorResolveButton from "@/components/admin/system-errors/SystemErrorResolveButton";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "System errors — Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const SEVERITIES = ["info", "warn", "error", "critical"] as const;
type Severity = (typeof SEVERITIES)[number];

const SEVERITY_BADGE: Record<Severity, string> = {
  info: "cms-badge cms-badge-muted",
  warn: "cms-badge cms-badge-neutral",
  error: "cms-badge border-foreground/40 bg-background font-semibold",
  critical:
    "cms-badge border-destructive bg-destructive/10 text-destructive font-semibold",
};

interface SystemErrorRow {
  id: string;
  occurred_at: string;
  source: string;
  severity: Severity;
  entity_kind: string | null;
  entity_id: string | null;
  sqlstate: string;
  sqlerrm: string;
  metadata: Record<string, unknown> | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

function isSeverity(v: string | undefined): v is Severity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

/**
 * Operator surface for Postgres-side exceptions caught by typed-SQLSTATE
 * catches (Phase 8 of the data-layer remediation). Populated via the
 * `log_system_error()` PL/pgSQL helper from reapers + atomic RPCs.
 *
 * Compare with /admin/errors which surfaces application-layer
 * (Node-side) errors from `error_events`. Two distinct surfaces by
 * design: DB-side ops want different filter axes (source = PG function
 * name, sqlstate = error class) than application errors (type = JS
 * error class, fingerprint = stack-hash).
 */
export default async function AdminSystemErrorsPage(
  props: {
    searchParams: Promise<{
      severity?: string;
      source?: string;
      resolved?: string;
      page?: string;
    }>;
  }
) {
  await requirePermission("read:errors");
  const searchParams = await props.searchParams;
  const admin = createAdminClient();
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const severity = isSeverity(searchParams.severity)
    ? searchParams.severity
    : null;
  const source = searchParams.source?.trim() || null;
  const resolvedFilter =
    searchParams.resolved === "true"
      ? true
      : searchParams.resolved === "false"
        ? false
        : null;

  // Main page query — paginated rows for the visible page.
  let pageQuery = admin
    .from("system_errors")
    .select("*", { count: "exact" })
    .order("occurred_at", { ascending: false })
    .range(from, to);
  if (severity) pageQuery = pageQuery.eq("severity", severity);
  if (source) pageQuery = pageQuery.eq("source", source);
  if (resolvedFilter === false) pageQuery = pageQuery.is("resolved_at", null);
  else if (resolvedFilter === true)
    pageQuery = pageQuery.not("resolved_at", "is", null);

  // Per-severity badge counts (across the unresolved set — what
  // operators usually care about). Four cheap parallel head queries.
  const [
    pageRes,
    unresolvedTotalRes,
    infoCountRes,
    warnCountRes,
    errorCountRes,
    criticalCountRes,
    sourceListRes,
  ] = await Promise.all([
    pageQuery,
    admin
      .from("system_errors")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null),
    admin
      .from("system_errors")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .eq("severity", "info"),
    admin
      .from("system_errors")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .eq("severity", "warn"),
    admin
      .from("system_errors")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .eq("severity", "error"),
    admin
      .from("system_errors")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .eq("severity", "critical"),
    // For the source dropdown — list distinct sources from the unresolved
    // set. At small scale we just read the column; if this grows we
    // expose a SQL view.
    admin
      .from("system_errors")
      .select("source")
      .is("resolved_at", null)
      .limit(500),
  ]);

  const rows = (pageRes.data ?? []) as SystemErrorRow[];
  const total = pageRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const unresolvedBySeverity: Record<Severity, number> = {
    info: infoCountRes.count ?? 0,
    warn: warnCountRes.count ?? 0,
    error: errorCountRes.count ?? 0,
    critical: criticalCountRes.count ?? 0,
  };
  const unresolvedTotal = unresolvedTotalRes.count ?? 0;
  const distinctSources = Array.from(
    new Set(
      ((sourceListRes.data ?? []) as Array<{ source: string }>).map(
        (r) => r.source
      )
    )
  ).sort();

  const queryString = (override: Partial<Record<string, string | number>>) => {
    const params = new URLSearchParams();
    if (severity) params.set("severity", severity);
    if (source) params.set("source", source);
    if (resolvedFilter === false) params.set("resolved", "false");
    if (resolvedFilter === true) params.set("resolved", "true");
    for (const [k, v] of Object.entries(override)) {
      if (v === undefined || v === null || v === "") params.delete(k);
      else params.set(k, String(v));
    }
    return params.toString();
  };

  return (
    <>
      <PageHeader
        eyebrow="Λειτουργία"
        title="System errors"
        description={`${unresolvedTotal.toLocaleString("el-GR")} ανοιχτά σφάλματα από Postgres functions. Ποιες reapers / atomic RPCs έχουν πρόβλημα — και πόσο συχνά.`}
      />

      {/* Severity badges — counts across unresolved rows */}
      <div className="flex flex-wrap gap-2 mb-4 text-sm">
        {SEVERITIES.map((s) => (
          <span
            key={s}
            className={`${SEVERITY_BADGE[s]} cursor-pointer`}
            title={`Φιλτράρισμα με severity=${s}`}
          >
            <Link
              href={`/admin/system-errors?${queryString({ severity: severity === s ? "" : s, page: 1 })}`}
              className="no-underline"
            >
              {s} · {unresolvedBySeverity[s]}
            </Link>
          </span>
        ))}
      </div>

      <form className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <select
          name="source"
          defaultValue={source ?? ""}
          className="cms-input w-auto"
        >
          <option value="">Όλες οι πηγές</option>
          {distinctSources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          name="severity"
          defaultValue={severity ?? ""}
          className="cms-input w-auto"
        >
          <option value="">Όλα τα severity</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          name="resolved"
          defaultValue={
            resolvedFilter === null ? "" : resolvedFilter ? "true" : "false"
          }
          className="cms-input w-auto"
        >
          <option value="">Όλα</option>
          <option value="false">Ανοιχτά</option>
          <option value="true">Επιλυμένα</option>
        </select>
        <button type="submit" className="btn btn-secondary btn-md">
          Φιλτράρισμα
        </button>
        {(severity || source || resolvedFilter !== null) && (
          <Link
            href="/admin/system-errors"
            className="text-sm text-muted-foreground underline"
          >
            Καθαρισμός
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="cms-empty">Κανένα σφάλμα.</div>
      ) : (
        <div className="cms-table-wrap">
          <table className="cms-table">
            <thead>
              <tr>
                <th>Όταν</th>
                <th>Severity</th>
                <th>Source</th>
                <th>SQLSTATE</th>
                <th>Message</th>
                <th>Entity</th>
                <th>Status</th>
                <th className="text-center">Ενέργειες</th>
              </tr>
            </thead>
            <tbody className="content-reveal">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={r.resolved_at ? "opacity-60" : ""}
                  data-resolved={r.resolved_at ? "true" : "false"}
                >
                  <td className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(r.occurred_at).toLocaleString("el-GR")}
                  </td>
                  <td>
                    <span className={SEVERITY_BADGE[r.severity]}>
                      {r.severity}
                    </span>
                  </td>
                  <td className="font-mono text-xs">{r.source}</td>
                  <td className="font-mono text-xs">{r.sqlstate}</td>
                  <td className="max-w-md truncate" title={r.sqlerrm}>
                    {r.sqlerrm}
                  </td>
                  <td className="text-xs font-mono whitespace-nowrap">
                    {r.entity_kind ?? "—"}
                    {r.entity_id ? (
                      <>
                        {" "}
                        ·{" "}
                        <span className="text-muted-foreground">
                          {r.entity_id.slice(0, 8)}…
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {r.resolved_at ? (
                      <span className="cms-badge cms-badge-neutral">
                        Επιλυμένο
                      </span>
                    ) : (
                      <span className="cms-badge cms-badge-muted">Ανοιχτό</span>
                    )}
                  </td>
                  <td className="text-center">
                    <SystemErrorResolveButton
                      id={r.id}
                      initiallyResolved={r.resolved_at !== null}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between mt-6 text-sm">
          <span className="text-muted-foreground">
            Σελίδα {page} / {totalPages} — {total.toLocaleString("el-GR")}{" "}
            συνολικά
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/admin/system-errors?${queryString({ page: page - 1 })}`}
                className="btn btn-secondary btn-sm"
              >
                ← Προηγούμενη
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/admin/system-errors?${queryString({ page: page + 1 })}`}
                className="btn btn-secondary btn-sm"
              >
                Επόμενη →
              </Link>
            )}
          </div>
        </nav>
      )}
    </>
  );
}
