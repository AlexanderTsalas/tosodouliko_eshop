import Link from "next/link";
import { strings } from "@/config/strings";

/**
 * Shared chrome for the static info pages (about, terms, privacy, shipping,
 * returns, faq, contact). Warm breadcrumb + serif title + centered prose
 * column. Keeps all the placeholder pages visually consistent and on-brand.
 */
export default function InfoPageShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <nav
        aria-label="breadcrumb"
        className="mb-3 flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-stone-taupe"
      >
        <Link href="/" className="hover:text-terracotta transition-colors">
          {strings.pages.breadcrumbHome}
        </Link>
        <span className="text-stone-taupe/50">/</span>
        <span className="text-ink">{title}</span>
      </nav>

      <div className="pb-4 mb-6 border-b border-stone-taupe/20">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-ink">
          {title}
        </h1>
        <div className="w-28 h-0.5 bg-gradient-to-r from-transparent via-terracotta to-transparent mt-3" />
      </div>

      <div className="text-ink/80 leading-relaxed space-y-4">{children}</div>
    </main>
  );
}
