/**
 * Skeleton shown while the PDP server component fetches:
 *   - product + variants (getProductBySlug)
 *   - inventory snapshots (getContestableAvailableForVariants)
 *   - per-variant offer evaluation
 *   - storefront custom fields resolution
 *
 * Mirrors the two-column grid the real page uses so the layout
 * doesn't shift when the data arrives.
 *
 * The related-products carousel area has its own <Suspense> inside
 * the page, so this skeleton intentionally stops at the main card —
 * the carousel skeleton renders later within page chrome.
 */
export default function PdpLoading() {
  return (
    <main className="container mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-2 gap-8 animate-pulse skeleton-reveal">
      {/* Left column — image carousel */}
      <div className="w-full aspect-square bg-warm-sand rounded-sm border border-stone-taupe/20" />

      {/* Right column — title, price, picker, CTAs */}
      <div className="space-y-4">
        <div className="h-8 w-3/4 bg-stone-taupe/20 rounded" />
        <div className="h-0.5 w-12 bg-terracotta/40" />
        <div className="h-7 w-32 bg-stone-taupe/20 rounded" />

        <div className="space-y-2 mt-6">
          <div className="h-4 w-24 bg-stone-taupe/15 rounded" />
          <div className="flex gap-2">
            <div className="h-9 w-16 bg-stone-taupe/15 rounded-sm" />
            <div className="h-9 w-16 bg-stone-taupe/15 rounded-sm" />
            <div className="h-9 w-16 bg-stone-taupe/15 rounded-sm" />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6">
          <div className="h-10 w-16 bg-stone-taupe/15 rounded-sm" />
          <div className="h-10 w-40 bg-terracotta/30 rounded-sm" />
          <div className="h-10 w-10 bg-stone-taupe/15 rounded-sm" />
        </div>
      </div>

      {/* Full-width description + specs band */}
      <div className="md:col-span-2 space-y-4 mt-4">
        <div className="h-4 w-full bg-stone-taupe/15 rounded-sm" />
        <div className="h-4 w-4/5 bg-stone-taupe/15 rounded-sm" />
        <div className="h-4 w-2/3 bg-stone-taupe/15 rounded-sm" />
      </div>
    </main>
  );
}
