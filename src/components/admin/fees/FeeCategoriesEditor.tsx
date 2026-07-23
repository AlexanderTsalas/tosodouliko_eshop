"use client";

import { useState } from "react";
import FeeCategoryCard from "./FeeCategoryCard";
import FeeCategoryForm from "./FeeCategoryForm";
import type { FeeCategory, FeeRule } from "@/types/fee";

interface Props {
  categories: FeeCategory[];
  rules: FeeRule[];
}

/**
 * Top-level orchestrator. Renders one card per fee category (with its rules
 * editor inside) plus a "new category" form at the bottom.
 */
export default function FeeCategoriesEditor({ categories, rules }: Props) {
  const [showNew, setShowNew] = useState(false);
  const rulesByCategory = new Map<string, FeeRule[]>();
  for (const r of rules) {
    const list = rulesByCategory.get(r.fee_category_id) ?? [];
    list.push(r);
    rulesByCategory.set(r.fee_category_id, list);
  }

  return (
    <div className="space-y-4">
      {categories.length === 0 && (
        <div className="cms-empty">
          Δεν υπάρχουν κατηγορίες ακόμη. Η αρχική migration σπέρνει τις
          συστημικές <code className="font-mono text-xs">shipping</code> και{" "}
          <code className="font-mono text-xs">cod_handling</code> · αν λείπουν,
          ελέγξτε ότι έχει τρέξει η{" "}
          <code className="font-mono text-xs">20260520000001_fees_foundation</code>.
        </div>
      )}

      {categories.map((cat) => (
        <FeeCategoryCard
          key={cat.id}
          category={cat}
          rules={rulesByCategory.get(cat.id) ?? []}
        />
      ))}

      <section className="rounded-lg border border-dashed border-foreground/20 p-4 bg-muted/20">
        {showNew ? (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Νέα κατηγορία χρέωσης
            </h2>
            <FeeCategoryForm onDone={() => setShowNew(false)} />
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="mt-3 text-xs underline text-muted-foreground hover:text-foreground"
            >
              Ακύρωση
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="btn btn-secondary btn-md w-full justify-center"
          >
            <span className="text-base leading-none">+</span> Προσθήκη νέας
            κατηγορίας
          </button>
        )}
      </section>
    </div>
  );
}
