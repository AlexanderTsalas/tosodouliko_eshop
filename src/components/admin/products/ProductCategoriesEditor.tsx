"use client";

import { useState, useTransition } from "react";
import NextLink from "next/link";
import { setProductCategories } from "@/actions/products/setProductCategories";
import QuickCategoryCreator from "@/components/admin/products/QuickCategoryCreator";
import { Package } from "@/components/admin/common/icons";
import type { Category } from "@/types/category-navigation";

interface Props {
  productId: string;
  allCategories: Category[];
  initialCategoryIds: string[];
  /** Dynamic (auto-rule) categories the product resolves into. Read-only —
   *  membership is rule-derived, not manually assigned. */
  autoCategories?: Array<{ id: string; name: string }>;
}

export default function ProductCategoriesEditor({
  productId,
  allCategories,
  initialCategoryIds,
  autoCategories = [],
}: Props) {
  const [categories, setCategories] = useState<Category[]>(allCategories);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialCategoryIds));
  // Categories created inline this session — surfaces the "Λεπτομερής ρύθμιση"
  // deep-link next to them. Cleared on reload (the new categories are still
  // selected via `selected`).
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function handleCreated(category: Category) {
    // Optimistically extend the local list, auto-check, and tag as fresh
    // so the inline detail-link surfaces. The createCategory action has
    // already revalidated /products + the categories tag — on next
    // navigation, allCategories will include this row from the server.
    setCategories((cur) => [...cur, category]);
    setSelected((cur) => {
      const next = new Set(cur);
      next.add(category.id);
      return next;
    });
    setFreshIds((cur) => {
      const next = new Set(cur);
      next.add(category.id);
      return next;
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await setProductCategories({
        productId,
        categoryIds: Array.from(selected),
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setSavedAt(Date.now());
    });
  }

  return (
    <section className="cms-card-section space-y-5">
      <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <Package className="w-4 h-4" />
            Κατηγορίες
          </h2>
          <p className="text-sm text-foreground/70 mt-1.5">
            Επιλέξτε σε ποιες κατηγορίες ανήκει το προϊόν. Εμφανίζεται κάτω
            από κάθε επιλεγμένη κατηγορία στο storefront.
          </p>
        </div>
        <QuickCategoryCreator parents={categories} onCreated={handleCreated} />
      </header>

      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Δεν υπάρχουν κατηγορίες ακόμη. Δημιουργήστε μία παραπάνω.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {categories.map((c) => {
            const isFresh = freshIds.has(c.id);
            return (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                <label className="flex items-center gap-2 flex-1 rounded-md border border-foreground/15 bg-background px-3 py-2 cursor-pointer hover:bg-card transition-colors">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <span>{c.name}</span>
                </label>
                {isFresh && (
                  <NextLink
                    href={`/admin/categories/${c.id}/edit`}
                    target="_blank"
                    className="text-[11px] text-primary underline whitespace-nowrap mt-3"
                    title="Άνοιγμα λεπτομερούς ρύθμισης σε νέα καρτέλα"
                  >
                    Λεπτομερής ρύθμιση →
                  </NextLink>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Dynamic (auto-rule) categories the product currently resolves into.
          Read-only — membership is decided by the category's rules, not
          manually assigned here. */}
      {autoCategories.length > 0 && (
        <div className="pt-1">
          <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">
            Δυναμικές κατηγορίες (αυτόματες)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {autoCategories.map((c) => (
              <span
                key={c.id}
                title="Ανατίθεται αυτόματα από τους κανόνες της κατηγορίας — δεν αλλάζει χειροκίνητα"
                className="inline-flex items-center gap-1.5 rounded-md border border-foreground/15 bg-foreground/[0.04] text-foreground/70 text-xs px-2 py-1"
              >
                <span className="uppercase tracking-wide text-[9px] text-muted-foreground">
                  auto
                </span>
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2 border-t border-foreground/10">
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="btn btn-primary btn-md"
        >
          {isPending ? "Αποθήκευση..." : "Αποθήκευση κατηγοριών"}
        </button>
        {savedAt && <span className="text-xs text-muted-foreground">Αποθηκεύτηκε</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </section>
  );
}
