/** Orders list loading skeleton — header + stacked order rows. */
export default function Loading() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="pb-4 mb-6 border-b border-stone-taupe/20">
        <div className="h-4 w-40 bg-stone-taupe/15 rounded mb-3 animate-pulse" />
        <div className="h-8 w-56 bg-stone-taupe/20 rounded-sm animate-pulse" />
        <div className="h-0.5 w-12 bg-terracotta/40 mt-3" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-20 w-full bg-card border border-stone-taupe/15 rounded-sm animate-pulse"
          />
        ))}
      </div>
    </main>
  );
}
