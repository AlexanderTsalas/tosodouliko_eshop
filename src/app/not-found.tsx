import Link from "next/link";
import BrandLogo from "@/components/layout/BrandLogo";
import { strings } from "@/config/strings";

export default function NotFound() {
  return (
    <main className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4 py-16">
      <Link href="/" className="group mb-8" aria-label="Αρχική">
        <BrandLogo size="md" />
      </Link>
      <p className="font-mono text-xs uppercase tracking-widest text-stone-taupe mb-2">404</p>
      <h1 className="font-serif text-3xl sm:text-4xl font-bold text-ink">
        {strings.errors.notFound}
      </h1>
      <p className="mt-3 text-ink/70 max-w-md">{strings.errors.notFoundDescription}</p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center gap-2 bg-terracotta hover:bg-canvas hover:text-terracotta border border-terracotta text-canvas font-serif text-sm tracking-widest py-3 px-7 rounded-sm uppercase font-medium transition-colors"
      >
        {strings.errors.backToHome}
      </Link>
    </main>
  );
}
