import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import ErrorResolveButton from "@/components/admin/errors/ErrorResolveButton";
import type { ErrorEvent } from "@/types/error-monitoring";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Σφάλματα — Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const SEVERITY_BADGE: Record<string, string> = {
  low: "cms-badge cms-badge-muted",
  medium: "cms-badge cms-badge-neutral",
  high: "cms-badge border-foreground/40 bg-background font-semibold",
  critical: "cms-badge border-destructive bg-destructive/10 text-destructive font-semibold",
};

export default async function AdminErrorsPage(
  props: {
    searchParams: Promise<{ severity?: string; resolved?: string; page?: string }>;
  }
) {
  await requirePermission("read:errors");
  const searchParams = await props.searchParams;
  const admin = createAdminClient();
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = admin
    .from("error_events")
    .select("*", { count: "exact" })
    .order("last_seen_at", { ascending: false })
    .range(from, to);

  if (searchParams.severity) query = query.eq("severity", searchParams.severity);
  if (searchParams.resolved === "false") query = query.eq("resolved", false);
  else if (searchParams.resolved === "true") query = query.eq("resolved", true);

  const { data, count } = await query;
  const rows = (data ?? []) as ErrorEvent[];
  const total = count ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Λειτουργία"
        title="Σφάλματα"
        description={`${total.toLocaleString("el-GR")} συνολικά. Παρακολούθηση application errors, με δυνατότητα φιλτραρίσματος ανά severity και κατάσταση.`}
      />

      <form className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <select
          name="severity"
          defaultValue={searchParams.severity ?? ""}
          className="cms-input w-auto"
        >
          <option value="">Όλα τα severity</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="critical">critical</option>
        </select>
        <select
          name="resolved"
          defaultValue={searchParams.resolved ?? ""}
          className="cms-input w-auto"
        >
          <option value="">Όλα</option>
          <option value="false">Ανοιχτά</option>
          <option value="true">Επιλυμένα</option>
        </select>
        <button type="submit" className="btn btn-secondary btn-md">
          Φιλτράρισμα
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="cms-empty">Κανένα σφάλμα.</div>
      ) : (
        <div className="cms-table-wrap">
          <table className="cms-table">
            <thead>
              <tr>
                <th>Last seen</th>
                <th>Severity</th>
                <th>Type</th>
                <th>Message</th>
                <th className="text-center">Count</th>
                <th>Status</th>
                <th className="text-center">Ενέργειες</th>
              </tr>
            </thead>
            <tbody className="content-reveal">
              {rows.map((r) => (
                <tr key={r.id} className={r.resolved ? "opacity-60" : ""}>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(r.last_seen_at).toLocaleString("el-GR")}
                  </td>
                  <td>
                    <span className={SEVERITY_BADGE[r.severity] ?? "cms-badge cms-badge-muted"}>
                      {r.severity}
                    </span>
                  </td>
                  <td className="font-mono text-xs">{r.type ?? "—"}</td>
                  <td className="max-w-md truncate">{r.message}</td>
                  <td className="text-center font-mono tabular-nums">
                    {r.occurrence_count}
                  </td>
                  <td>
                    {r.resolved ? (
                      <span className="cms-badge cms-badge-neutral">
                        <span className="cms-badge-dot" aria-hidden />
                        Επιλυμένο
                      </span>
                    ) : (
                      <span className="cms-badge cms-badge-muted">Ανοιχτό</span>
                    )}
                  </td>
                  <td className="text-center">
                    <ErrorResolveButton
                      id={r.id}
                      initiallyResolved={r.resolved}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
