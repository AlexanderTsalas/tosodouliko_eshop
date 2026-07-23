"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { useSearch } from "@/hooks/useSearch";
import { strings } from "@/config/strings";

/**
 * Storefront search. `variant="bar"` renders the compact dark-utility-bar
 * styling from the reference header (transparent input on the ink bar);
 * the default variant is the standard light input used in the mobile drawer.
 * Search logic is identical across variants.
 */
export default function SearchBar({ variant = "default" }: { variant?: "default" | "bar" }) {
  const [q, setQ] = useState("");
  const { data, isLoading } = useSearch(q);

  if (variant === "bar") {
    // Always-expanded search pill, centred in its container. Light-brown
    // (stone-taupe) field with white (canvas) text, sized a touch larger than
    // the rest of the utility bar so it reads as the primary action.
    return (
      <div className="relative mx-auto w-full flex justify-center">
        <div className="flex items-center w-72 max-w-full bg-stone-taupe px-4 py-2 rounded-full focus-within:ring-2 focus-within:ring-canvas/40 transition-shadow">
          <Search className="w-4 h-4 text-canvas shrink-0 mr-2" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQ("");
            }}
            placeholder={strings.layout.search.placeholderShort}
            aria-label={strings.layout.search.placeholderShort}
            className="bg-transparent text-canvas placeholder:text-canvas/70 focus:outline-none text-sm w-full"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Καθαρισμός"
              className="ml-1 text-canvas/80 hover:text-canvas shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {q.length >= 2 && (
          <div className="absolute top-full z-50 mt-1 w-72 max-w-full bg-card border border-stone-taupe/25 rounded-sm shadow-xl max-h-80 overflow-auto">
            {isLoading && <p className="p-3 text-sm text-muted-foreground">Αναζήτηση...</p>}
            {!isLoading && data && data.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">Καμία εγγραφή.</p>
            )}
            <ul>
              {data?.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/products/${p.slug}`}
                    className="block px-3 py-2 text-sm text-ink hover:bg-muted"
                    onClick={() => setQ("")}
                  >
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={strings.layout.search.placeholder}
        className="border border-stone-taupe/30 rounded-sm px-3 py-2 w-full max-w-sm focus:outline-none focus:border-stone-taupe"
        aria-label="Αναζήτηση"
      />
      {q.length >= 2 && (
        <div className="absolute z-50 mt-1 w-full bg-card border border-stone-taupe/25 rounded-sm shadow max-h-80 overflow-auto">
          {isLoading && <p className="p-3 text-sm text-muted-foreground">Αναζήτηση...</p>}
          {!isLoading && data && data.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">Καμία εγγραφή.</p>
          )}
          <ul>
            {data?.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/products/${p.slug}`}
                  className="block px-3 py-2 hover:bg-muted"
                  onClick={() => setQ("")}
                >
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
