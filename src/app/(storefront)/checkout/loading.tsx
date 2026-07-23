/**
 * Skeleton shown while the checkout server component runs (cart load,
 * session validation, address-book + carriers fetches). Mirrors the 2:1
 * grid (form left, summary aside right) so the shell doesn't jump.
 */
export default function CheckoutLoading() {
  return (
    <main className="container mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8 max-w-6xl animate-pulse skeleton-reveal">
      {/* Left column — form */}
      <section className="space-y-4">
        <div className="h-8 w-72 bg-stone-taupe/20 rounded-sm" />
        <div className="h-0.5 w-12 bg-terracotta/40" />
        <div className="space-y-2 mt-4">
          <div className="h-5 w-40 bg-stone-taupe/15 rounded-sm" />
          <div className="h-10 w-full bg-stone-taupe/15 rounded-sm" />
          <div className="h-10 w-full bg-stone-taupe/15 rounded-sm" />
        </div>
        <div className="space-y-2 mt-4">
          <div className="h-5 w-32 bg-stone-taupe/15 rounded-sm" />
          <div className="h-32 w-full bg-stone-taupe/15 rounded-sm" />
        </div>
        <div className="space-y-2 mt-4">
          <div className="h-5 w-44 bg-stone-taupe/15 rounded-sm" />
          <div className="h-12 w-full bg-stone-taupe/15 rounded-sm" />
        </div>
        <div className="h-12 w-full bg-terracotta/30 rounded-sm mt-6" />
      </section>

      {/* Right column — summary aside */}
      <aside className="border border-stone-taupe/20 rounded-sm bg-card p-5 h-fit space-y-3">
        <div className="h-5 w-32 bg-stone-taupe/20 rounded-sm" />
        <div className="space-y-2 mt-3">
          <div className="h-4 w-full bg-stone-taupe/15 rounded-sm" />
          <div className="h-4 w-3/4 bg-stone-taupe/15 rounded-sm" />
        </div>
        <div className="border-t border-stone-taupe/20 pt-3 mt-3 space-y-2">
          <div className="h-4 w-full bg-stone-taupe/15 rounded-sm" />
          <div className="h-4 w-full bg-stone-taupe/20 rounded-sm" />
        </div>
      </aside>
    </main>
  );
}
