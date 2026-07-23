/**
 * Default skeleton for admin pages that don't ship their own loading.tsx.
 *
 * Renders INSIDE the admin layout's children slot, so the sidebar
 * stays painted around it during navigation. The skeleton fills only
 * the content area with a generic page-header + body shape that fits
 * most admin destinations (list pages, form pages, detail pages).
 *
 * Routes with meaningfully distinct shapes — like /admin/orders
 * which has a filter row + table — ship a tailored loading.tsx
 * that overrides this one and matches the destination's structure
 * more precisely.
 */
export default function AdminLoading() {
  // The whole skeleton uses `skeleton-reveal` because nothing in this
  // generic fallback is "real" chrome — the title placeholder and
  // filter row are guesses, since we don't know which destination is
  // loading. Keeping it invisible for 150ms means fast in-cache
  // navigations show no skeleton at all. Pages with their own
  // loading.tsx render the actual page header + chrome immediately
  // (no delay) and apply `skeleton-reveal` only to the data
  // placeholders.
  return (
    <div className="animate-pulse skeleton-reveal">
      {/* Title + subtitle band */}
      <div className="mb-6">
        <div className="h-7 w-64 bg-muted/70 rounded mb-2" />
        <div className="h-4 w-96 bg-muted/40 rounded" />
      </div>

      {/* Filter / control row */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="h-9 w-48 bg-muted/40 rounded" />
        <div className="h-9 w-32 bg-muted/40 rounded" />
        <div className="h-9 w-32 bg-muted/40 rounded" />
      </div>

      {/* Generic body — works for tables, cards, or forms. A few
          stacked rows of varying widths reads as "content arriving"
          for any layout. */}
      <div className="space-y-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="h-12 bg-muted/30 rounded"
            style={{ width: `${85 + (i % 3) * 5}%` }}
          />
        ))}
      </div>
    </div>
  );
}
