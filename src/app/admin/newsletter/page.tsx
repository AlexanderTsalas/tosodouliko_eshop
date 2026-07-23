import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import NewsletterRow from "@/components/admin/newsletter/NewsletterRow";
import type { NewsletterSubscriber } from "@/types/newsletter-sync";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Newsletter — Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminNewsletterPage(
  props: {
    searchParams: Promise<{ status?: string; page?: string }>;
  }
) {
  await requirePermission("manage:newsletter");
  const searchParams = await props.searchParams;
  const admin = createAdminClient();
  const status = searchParams.status ?? "all";
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = admin
    .from("newsletter_subscribers")
    .select("*", { count: "exact" })
    .order("consent_at", { ascending: false })
    .range(from, to);

  if (status !== "all") query = query.eq("status", status);

  const { data, count } = await query;
  const rows = (data ?? []) as NewsletterSubscriber[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Newsletter"
        description={`${total.toLocaleString("el-GR")} εγγραφές. Διαχείριση συνδρομητών και κατάστασης συναίνεσης.`}
      />

      <form className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <select
          name="status"
          defaultValue={status}
          className="cms-input w-auto"
        >
          <option value="all">Όλα</option>
          <option value="subscribed">Subscribed</option>
          <option value="unsubscribed">Unsubscribed</option>
          <option value="pending">Pending</option>
        </select>
        <button type="submit" className="btn btn-secondary btn-md">
          Φιλτράρισμα
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="cms-empty">Δεν υπάρχουν εγγραφές.</div>
      ) : (
        <div className="cms-table-wrap">
          <table className="cms-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Status</th>
                <th>Consent</th>
                <th>Ενέργειες</th>
              </tr>
            </thead>
            <tbody className="content-reveal">
              {rows.map((r) => (
                <NewsletterRow key={r.id} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? (
            <a
              href={`?status=${status}&page=${page - 1}`}
              className="btn btn-secondary btn-sm"
            >
              ← Προηγούμενη
            </a>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Σελίδα {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <a
              href={`?status=${status}&page=${page + 1}`}
              className="btn btn-secondary btn-sm"
            >
              Επόμενη →
            </a>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
