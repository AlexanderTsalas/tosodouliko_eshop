"use client";

import { useState, useTransition } from "react";
import { createCategory } from "@/actions/categories/createCategory";
import type { Category } from "@/types/category-navigation";

interface Props {
  /** Parent categories the new one can nest under. */
  parents: Category[];
  /** Called with the freshly created Category so the parent can append + check it. */
  onCreated: (category: Category) => void;
}

/**
 * Slim inline category creator for the product editor's Categories tab.
 * Deliberately a SUBSET of the full CategoryForm:
 *
 *   Included:   name, parent (optional), active (defaults true)
 *   Excluded:   slug (auto from name), description, image, VAT, display order,
 *               mode + auto-rules
 *
 * Reasoning: the inline use case is "I need a quick bucket to drop this
 * product into". The 80% of fields the admin would tweak on the
 * standalone /admin/categories surface live there for a reason — they're
 * config the admin sets occasionally, not while building a product.
 * Auto-rule mode in particular is conceptually wrong inline: rules drive
 * membership independent of any single product. After creation we link to
 * /admin/categories/[id]/edit so the rest stays one click away.
 */
export default function QuickCategoryCreator({ parents, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setName("");
    setParentId("");
    setError(null);
  }

  function submit() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Συμπληρώστε όνομα.");
      return;
    }
    startTransition(async () => {
      const r = await createCategory({
        name: trimmed,
        parentId: parentId || null,
        // Inline creation is always manual-mode. Auto-rule categories live
        // on the standalone form where the AutoRuleBuilder has room to
        // breathe.
        mode: "manual",
        active: true,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      onCreated(r.data);
      setOpen(false);
      reset();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary btn-sm shrink-0"
      >
        <span className="text-base leading-none">+</span> Νέα κατηγορία
      </button>
    );
  }

  return (
    // NOTE: a <div>, not a <form>. This component is rendered INSIDE the
    // product overview <form>, and nested <form> elements are invalid HTML
    // (the browser strips the inner one, so a submit button would submit the
    // outer product form). Submit on click / Enter instead.
    <div className="rounded-md border border-foreground/15 bg-muted/30 p-3 space-y-3 min-w-[280px]">
      <h4 className="text-sm font-semibold">Νέα κατηγορία</h4>

      <label className="block">
        <span className="block text-xs font-medium mb-1 text-muted-foreground">
          Όνομα *
        </span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={200}
          placeholder='π.χ. "Χριστούγεννα"'
          className="cms-input"
          disabled={isPending}
        />
      </label>

      <label className="block">
        <span className="block text-xs font-medium mb-1 text-muted-foreground">
          Γονική κατηγορία
        </span>
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="cms-input"
          disabled={isPending}
        >
          <option value="">— καμία —</option>
          {parents.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <p className="text-[11px] text-muted-foreground">
        Το slug δημιουργείται αυτόματα. Για περιγραφή, εικόνα, ΦΠΑ, σειρά
        εμφάνισης και αυτόματους κανόνες ανοίξτε τη{" "}
        <span className="italic">Λεπτομερή ρύθμιση</span> μετά τη δημιουργία.
      </p>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2 pt-1 border-t border-foreground/10">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="btn btn-primary btn-sm"
        >
          {isPending ? "Δημιουργία..." : "Δημιουργία"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          disabled={isPending}
          className="btn btn-secondary btn-sm"
        >
          Άκυρο
        </button>
      </div>
    </div>
  );
}
