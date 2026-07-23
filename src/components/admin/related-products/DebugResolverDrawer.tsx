"use client";

import { useState, useTransition } from "react";
import { X, FlaskConical, Search, AlertTriangle } from "lucide-react";
import { debugResolveCarousels } from "@/actions/related-products";
import type {
  ResolvedCarousel,
  ResolverWarning,
} from "@/lib/related-products";

interface Props {
  products: Array<{ id: string; name: string }>;
  /** Optional variant lookup. When the admin picks a variant the
   *  resolver matches variant-level attribute conditions. */
  variants: Array<{
    id: string;
    sku: string;
    product_id: string;
    product_name: string;
  }>;
  onClose: () => void;
  /** Called with each batch of warnings the resolver produced. The
   *  parent (the bench) uses these to badge the toolbar button so the
   *  admin sees a hint there's something worth inspecting. */
  onWarnings?: (warnings: ResolverWarning[]) => void;
}

/**
 * "Τέστ Live Προτεινόμενων" drawer — right-side slide-in panel where the
 * admin picks a product (and optionally a variant), triggers the
 * resolver, and sees the resulting carousels PLUS any configuration
 * warnings (bidirectional overlaps, etc).
 */
export default function DebugResolverDrawer({
  products,
  variants,
  onClose,
  onWarnings,
}: Props) {
  const [productQuery, setProductQuery] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [carousels, setCarousels] = useState<ResolvedCarousel[] | null>(null);
  const [warnings, setWarnings] = useState<ResolverWarning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredProducts = productQuery.trim()
    ? products.filter((p) =>
        p.name.toLowerCase().includes(productQuery.toLowerCase())
      )
    : products;
  const variantsForProduct = productId
    ? variants.filter((v) => v.product_id === productId)
    : [];

  function runResolver() {
    if (!productId) return;
    setError(null);
    startTransition(async () => {
      const r = await debugResolveCarousels({
        product_id: productId,
        variant_id: variantId,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setCarousels(r.data.carousels);
      setWarnings(r.data.warnings);
      onWarnings?.(r.data.warnings);
    });
  }

  const selectedProductName =
    products.find((p) => p.id === productId)?.name ?? null;

  return (
    <aside className="fixed top-0 right-0 h-full w-full max-w-md bg-card border-l border-border shadow-xl z-50 overflow-y-auto">
      <header className="sticky top-0 bg-card border-b border-border p-4 flex items-center gap-2">
        <FlaskConical className="w-5 h-5 text-muted-foreground" />
        <h3 className="font-semibold text-base">Τέστ Live Προτεινόμενων</h3>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto btn btn-ghost btn-sm"
          aria-label="Κλείσιμο"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="p-4 space-y-4">
        {/* ── Product picker ── */}
        <section>
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Προϊόν
          </h4>
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              placeholder="Αναζήτηση…"
              className="cms-input pl-8 w-full"
            />
          </div>
          {selectedProductName ? (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="truncate">{selectedProductName}</span>
              <button
                type="button"
                onClick={() => {
                  setProductId(null);
                  setVariantId(null);
                  setCarousels(null);
                  setWarnings([]);
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Καθαρισμός"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <ul className="max-h-64 overflow-y-auto space-y-1 border border-border rounded-md p-1 bg-muted/20">
              {filteredProducts.length === 0 ? (
                <li className="text-xs text-muted-foreground italic px-2 py-1">
                  Κανένα προϊόν.
                </li>
              ) : (
                filteredProducts.slice(0, 50).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setProductId(p.id);
                        setVariantId(null);
                        setCarousels(null);
                        setWarnings([]);
                      }}
                      className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted/60"
                    >
                      {p.name}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </section>

        {/* ── Variant picker (optional) ── */}
        {productId && variantsForProduct.length > 0 && (
          <section>
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Παραλλαγή (προαιρετικά)
            </h4>
            <select
              value={variantId ?? ""}
              onChange={(e) => setVariantId(e.target.value || null)}
              className="cms-input w-full"
            >
              <option value="">— χωρίς παραλλαγή —</option>
              {variantsForProduct.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.sku}
                </option>
              ))}
            </select>
          </section>
        )}

        {productId && (
          <button
            type="button"
            onClick={runResolver}
            disabled={isPending}
            className="btn btn-primary btn-md w-full"
          >
            {isPending ? "Εκτέλεση…" : "Τέστ Live Προτεινόμενων"}
          </button>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 text-destructive text-xs px-3 py-2">
            {error}
          </div>
        )}

        {/* ── Warnings ── */}
        {warnings.length > 0 && (
          <section>
            <h4 className="text-xs uppercase tracking-wider text-amber-700 mb-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Προειδοποιήσεις διαμόρφωσης ({warnings.length})
            </h4>
            <ul className="space-y-2">
              {warnings.map((w, i) => (
                <li
                  key={i}
                  className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 leading-relaxed"
                >
                  {w.kind === "bidirectional_overlap" && (
                    <>
                      Η συσχέτιση{" "}
                      <strong>«{w.association_name}»</strong> έχει
                      ενεργό το «Ισχύει και Αντίστροφα», αλλά αυτό το
                      προϊόν ταιριάζει ΚΑΙ στα φίλτρα πηγής ΚΑΙ στα
                      φίλτρα στόχου. Ο engine κράτησε την κανονική
                      κατεύθυνση (πηγή → στόχος) για να μη
                      διπλο-εμφανίζεται.
                      <br />
                      <span className="text-amber-800">
                        Επιλογές: στενέψτε ένα από τα δύο φίλτρα για να
                        μην αλληλεπικαλύπτονται, ή απενεργοποιήστε το
                        «Ισχύει και Αντίστροφα» αν δεν είναι σκόπιμο.
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Results ── */}
        {carousels !== null && (
          <section>
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Αποτέλεσμα
            </h4>
            {carousels.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                Καμία συσχέτιση δεν ταιριάζει στο επιλεγμένο προϊόν.
              </p>
            ) : (
              <div className="space-y-3">
                {carousels.map((c) => (
                  <article
                    key={c.association_id}
                    className="rounded-lg border border-border bg-muted/40 p-3"
                  >
                    <header className="mb-2">
                      <h5 className="text-sm font-semibold flex items-center gap-1.5">
                        {c.title_translations.el ??
                          c.title_translations.en ?? (
                            <span className="text-muted-foreground italic">
                              «Προτεινόμενα Προϊόντα» (fallback)
                            </span>
                          )}
                        {c.direction === "reverse" && (
                          <span className="text-[10px] font-mono uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded">
                            αντίστροφα
                          </span>
                        )}
                      </h5>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {c.matched_by} · θέση {c.display_order} ·{" "}
                        {strategyLabel(c.selection_strategy)}
                      </p>
                    </header>
                    <ul className="space-y-1">
                      {c.products.map((p, i) => (
                        <li
                          key={p.id}
                          className="text-xs flex items-center gap-2 px-2 py-1 rounded bg-background border border-border"
                        >
                          <span className="text-muted-foreground tabular-nums w-5">
                            {i + 1}.
                          </span>
                          <span className="flex-1 truncate">{p.name}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground italic mt-3">
              Hard cap: 3 carousels per page. Self-exclusion + OOS
              filtering εφαρμόζονται ανά συσχέτιση.
            </p>
          </section>
        )}
      </div>
    </aside>
  );
}

function strategyLabel(s: ResolvedCarousel["selection_strategy"]): string {
  switch (s) {
    case "random":
      return "Τυχαία";
    case "recent":
      return "Πιο πρόσφατα";
    case "manual":
      return "Χειροκίνητα";
  }
}
