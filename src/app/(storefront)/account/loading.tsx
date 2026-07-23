/** Account hub loading skeleton — header + menu rows. */
export default function Loading() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="pb-4 mb-6 border-b border-stone-taupe/20">
        <div className="h-8 w-40 bg-stone-taupe/20 rounded-sm animate-pulse" />
        <div className="h-4 w-56 bg-stone-taupe/15 rounded mt-2 animate-pulse" />
        <div className="h-0.5 w-12 bg-terracotta/40 mt-3" />
      </div>
      <div className="rounded-sm border border-stone-taupe/20 bg-card divide-y divide-stone-taupe/15 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-4">
            <div className="w-5 h-5 bg-stone-taupe/20 rounded animate-pulse" />
            <div className="h-4 w-40 bg-stone-taupe/15 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </main>
  );
}
