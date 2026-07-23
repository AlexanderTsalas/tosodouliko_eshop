import "server-only";

interface ColumnSpec {
  label: string;
  /** Optional className for th — match what the real table uses on
   *  each column (e.g. `w-8` for the checkbox column, `text-center`
   *  for numeric columns). */
  thClassName?: string;
  /** Optional className for the skeleton placeholder cell on each
   *  row. Defaults to a single muted bar of varying width. */
  cellClassName?: string;
}

/**
 * Skeleton table that matches the visual structure of the live
 * `cms-table` — same wrap + table classes, the same thead with the
 * caller-supplied column labels, and `rowCount` skeleton rows. Used
 * inside list-page Suspense fallbacks so the table shape is stable
 * across the loading → loaded transition (real rows replace the
 * skeleton rows in place, header and column widths don't shift).
 *
 * Column widths come from `thClassName` — keep them the same as the
 * live table's <th> classes so the layout doesn't shift when data
 * arrives.
 */
export default function StaticTableSkeleton({
  columns,
  rowCount = 10,
}: {
  columns: ColumnSpec[];
  rowCount?: number;
}) {
  return (
    <div className="cms-table-wrap">
      <table className="cms-table">
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={i} className={col.thClassName}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((col, colIndex) => (
                <td key={colIndex}>
                  <div
                    className={
                      col.cellClassName ??
                      `h-4 bg-muted/30 rounded animate-pulse skeleton-reveal ${
                        colIndex === 0 ? "w-3/4" : colIndex % 2 === 0 ? "w-1/2" : "w-2/3"
                      }`
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
