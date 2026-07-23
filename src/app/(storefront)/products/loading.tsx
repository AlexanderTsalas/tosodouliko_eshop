/**
 * Catalog loading skeleton — mirrors the products page layout (filter column +
 * header + responsive card grid) so navigation feels instant and stable.
 */
export default function Loading() {
  return (
    <main className="container mx-auto grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8 px-4 py-6">
      <aside className="hidden md:block space-y-3">
        <div className="h-6 w-24 bg-stone-taupe/20 rounded-sm animate-pulse" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-4 w-full bg-stone-taupe/15 rounded animate-pulse" />
        ))}
      </aside>
      <section>
        <div className="pb-4 mb-6 border-b border-stone-taupe/20">
          <div className="h-8 w-48 bg-stone-taupe/20 rounded-sm animate-pulse" />
          <div className="h-4 w-32 bg-stone-taupe/15 rounded mt-3 animate-pulse" />
        </div>
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="border border-stone-taupe/15 rounded-sm p-3 bg-card">
              <div className="w-full aspect-square bg-warm-sand rounded-sm animate-pulse" />
              <div className="h-4 w-3/4 bg-stone-taupe/15 rounded mt-3 animate-pulse" />
              <div className="h-4 w-1/3 bg-stone-taupe/15 rounded mt-2 animate-pulse" />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
