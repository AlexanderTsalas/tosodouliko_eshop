"use client";

import { useEffect } from "react";
import { strings } from "@/config/strings";

/**
 * Shared warm error UI for the storefront route error boundaries (auth, cart,
 * checkout, products, wishlist). Each route's error.tsx is a thin wrapper that
 * passes its own title. Renders inside the storefront chrome (header/footer).
 */
export default function StorefrontErrorState({
  title,
  error,
  reset,
}: {
  title: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="container mx-auto px-4 py-16 max-w-lg text-center">
      <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">{title}</h1>
      <div className="w-28 h-0.5 bg-gradient-to-r from-transparent via-terracotta to-transparent mx-auto mt-3 mb-4" />
      <p className="text-ink/70">{error.message || strings.auth.errorGeneric}</p>
      <button
        onClick={reset}
        className="mt-6 inline-flex items-center gap-2 bg-terracotta hover:bg-canvas hover:text-terracotta border border-terracotta text-canvas font-serif text-sm tracking-widest py-3 px-7 rounded-sm uppercase font-medium transition-colors"
      >
        {strings.errors.retry}
      </button>
    </main>
  );
}
