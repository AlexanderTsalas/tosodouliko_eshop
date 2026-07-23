import Link from "next/link";
import PageSizeSelect from "@/components/admin/common/PageSizeSelect";

interface Props {
  /** Current 1-based page number. */
  page: number;
  /** Current page size (items per page). */
  pageSize: number;
  /** Total items matching the current filter (across all pages). */
  total: number;
  /** Search params already present on the URL — preserved across nav. */
  preserveParams: Record<string, string>;
  /** Available page sizes for the dropdown. */
  pageSizeOptions?: number[];
  /** Optional label for the per-page selector. */
  pageSizeLabel?: string;
}

/**
 * Reusable URL-driven pagination control. Renders:
 *   - "X – Y από Z" total info
 *   - Page size selector (10 / 25 / 50 / 100 by default)
 *   - Prev / page links / Next
 *
 * Page state lives in URL (`?page=N&pageSize=M`). Page-size dropdown is a
 * GET <form> so the change submits immediately. Selection state and other
 * URL params are preserved.
 */
export default function Pagination({
  page,
  pageSize,
  total,
  preserveParams,
  pageSizeOptions = [10, 25, 50, 100],
  pageSizeLabel = "Ανά σελίδα",
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  function pageHref(p: number): string {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(preserveParams)) {
      if (v) sp.set(k, v);
    }
    if (p > 1) sp.set("page", String(p));
    if (pageSize !== pageSizeOptions[1]) sp.set("pageSize", String(pageSize));
    return sp.toString() ? `?${sp.toString()}` : "?";
  }

  // Window of page numbers around the current page (max 7 visible).
  const pages: number[] = [];
  const window = 2;
  for (let p = Math.max(1, page - window); p <= Math.min(totalPages, page + window); p++) {
    pages.push(p);
  }
  const showFirstEllipsis = pages.length > 0 && pages[0] > 2;
  const showFirst = pages.length > 0 && pages[0] > 1;
  const showLastEllipsis = pages.length > 0 && pages[pages.length - 1] < totalPages - 1;
  const showLast = pages.length > 0 && pages[pages.length - 1] < totalPages;

  return (
    <nav className="flex items-center justify-between gap-4 text-sm mt-4 flex-wrap" aria-label="Pagination">
      <p className="text-muted-foreground">
        {total === 0 ? (
          "Δεν βρέθηκαν αποτελέσματα"
        ) : (
          <>
            <span className="font-medium text-foreground">
              {start.toLocaleString("el-GR")} – {end.toLocaleString("el-GR")}
            </span>{" "}
            από {total.toLocaleString("el-GR")}
          </>
        )}
      </p>

      <form method="GET" className="flex items-center gap-2 text-xs">
        {Object.entries(preserveParams).map(([k, v]) =>
          v && k !== "page" && k !== "pageSize" ? (
            <input key={k} type="hidden" name={k} value={v} />
          ) : null
        )}
        <label className="flex items-center gap-1">
          <span className="text-muted-foreground">{pageSizeLabel}:</span>
          <PageSizeSelect
            name="pageSize"
            defaultValue={String(pageSize)}
            options={pageSizeOptions}
          />
        </label>
      </form>

      {totalPages > 1 && (
        <div className="flex items-center gap-1 text-xs">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="px-2 py-1 rounded hover:bg-muted">
              ← Προηγ.
            </Link>
          ) : (
            <span className="px-2 py-1 text-muted-foreground/50">← Προηγ.</span>
          )}

          {showFirst && (
            <>
              <Link href={pageHref(1)} className="px-2 py-1 rounded hover:bg-muted">
                1
              </Link>
              {showFirstEllipsis && <span className="px-1 text-muted-foreground">…</span>}
            </>
          )}

          {pages.map((p) =>
            p === page ? (
              <span
                key={p}
                aria-current="page"
                className="px-2 py-1 rounded bg-primary text-primary-foreground font-medium"
              >
                {p}
              </span>
            ) : (
              <Link key={p} href={pageHref(p)} className="px-2 py-1 rounded hover:bg-muted">
                {p}
              </Link>
            )
          )}

          {showLast && (
            <>
              {showLastEllipsis && <span className="px-1 text-muted-foreground">…</span>}
              <Link href={pageHref(totalPages)} className="px-2 py-1 rounded hover:bg-muted">
                {totalPages}
              </Link>
            </>
          )}

          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className="px-2 py-1 rounded hover:bg-muted">
              Επόμ. →
            </Link>
          ) : (
            <span className="px-2 py-1 text-muted-foreground/50">Επόμ. →</span>
          )}
        </div>
      )}
    </nav>
  );
}
