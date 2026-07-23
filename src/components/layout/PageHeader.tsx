import Link from "next/link";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Shared storefront page header — serif title + terracotta underline, optional
 * description and breadcrumb. One source of truth so every customer-facing
 * page opens with the same rhythm (matches the catalog/cart/info headers).
 */
export default function PageHeader({
  title,
  description,
  breadcrumb,
}: {
  title: string;
  description?: string;
  breadcrumb?: Crumb[];
}) {
  return (
    <div className="pb-4 mb-6 border-b border-stone-taupe/20">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav
          aria-label="breadcrumb"
          className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-stone-taupe"
        >
          {breadcrumb.map((b, i) => (
            <span key={`${b.label}-${i}`} className="flex items-center gap-2">
              {i > 0 && <span className="text-stone-taupe/50">/</span>}
              {b.href ? (
                <Link href={b.href} className="hover:text-terracotta transition-colors">
                  {b.label}
                </Link>
              ) : (
                <span className="text-ink">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-ink">
        {title}
      </h1>
      {description && <p className="mt-1.5 text-sm text-ink/70 max-w-2xl">{description}</p>}
      <div className="w-28 h-0.5 bg-gradient-to-r from-transparent via-terracotta to-transparent mt-3" />
    </div>
  );
}
