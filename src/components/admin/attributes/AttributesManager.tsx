"use client";

import { useState, useTransition } from "react";
import { createAttribute } from "@/actions/attributes/createAttribute";
import { updateAttribute } from "@/actions/attributes/updateAttribute";
import { deleteAttribute } from "@/actions/attributes/deleteAttribute";
import { createAttributeValuesBulk } from "@/actions/attributes/createAttributeValuesBulk";
import { updateAttributeValue } from "@/actions/attributes/updateAttributeValue";
import { deleteAttributeValue } from "@/actions/attributes/deleteAttributeValue";
import Toggle from "@/components/admin/common/Toggle";
import DeleteButton from "@/components/admin/common/DeleteButton";
import {
  Layers,
  ClipboardList,
  ChevronRight,
} from "@/components/admin/common/icons";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";
import { compareAttributeValues } from "@/lib/sort-attribute-values";

interface Props {
  initialAttributes: Attribute[];
  initialValues: AttributeValue[];
  /**
   * Logical scope this instance is rendering. Used for the section
   * header icon + copy (variant vs spec). Functionally the two
   * sections are identical CRUD surfaces.
   */
  scope?: "variant" | "spec";
}

export default function AttributesManager({
  initialAttributes,
  initialValues,
  scope = "variant",
}: Props) {
  const [attributes, setAttributes] = useState(initialAttributes);
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [newAttrName, setNewAttrName] = useState("");

  const valuesByAttribute = new Map<string, AttributeValue[]>();
  for (const v of values) {
    const list = valuesByAttribute.get(v.attribute_id) ?? [];
    list.push(v);
    valuesByAttribute.set(v.attribute_id, list);
  }
  for (const list of valuesByAttribute.values()) {
    list.sort(compareAttributeValues);
  }

  function handleCreateAttribute(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const name = newAttrName.trim();
    if (!name) return;
    startTransition(async () => {
      const r = await createAttribute({ name });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setAttributes((cur) => [...cur, r.data]);
      setNewAttrName("");
    });
  }

  function handleRenameAttribute(attr: Attribute, newName: string) {
    if (newName === attr.name || !newName.trim()) return;
    setError(null);
    setAttributes((cur) =>
      cur.map((a) => (a.id === attr.id ? { ...a, name: newName } : a))
    );
    startTransition(async () => {
      const r = await updateAttribute({ id: attr.id, name: newName });
      if (!r.success) {
        setError(r.error);
        setAttributes((cur) =>
          cur.map((a) => (a.id === attr.id ? { ...a, name: attr.name } : a))
        );
      }
    });
  }

  function handleDeleteAttribute(attr: Attribute) {
    if (!confirm(`Διαγραφή τύπου «${attr.name}» και όλων των τιμών του;`))
      return;
    setError(null);
    const prevAttrs = attributes;
    const prevVals = values;
    setAttributes((cur) => cur.filter((a) => a.id !== attr.id));
    setValues((cur) => cur.filter((v) => v.attribute_id !== attr.id));
    startTransition(async () => {
      const r = await deleteAttribute({ id: attr.id });
      if (!r.success) {
        setError(r.error);
        setAttributes(prevAttrs);
        setValues(prevVals);
      }
    });
  }

  function handleRenameValue(val: AttributeValue, newValue: string) {
    if (newValue === val.value || !newValue.trim()) return;
    setError(null);
    setValues((cur) =>
      cur.map((v) => (v.id === val.id ? { ...v, value: newValue } : v))
    );
    startTransition(async () => {
      const r = await updateAttributeValue({ id: val.id, value: newValue });
      if (!r.success) {
        setError(r.error);
        setValues((cur) =>
          cur.map((v) => (v.id === val.id ? { ...v, value: val.value } : v))
        );
      }
    });
  }

  function handleToggleAffectsPrice(attr: Attribute, next: boolean) {
    setError(null);
    setAttributes((cur) =>
      cur.map((a) => (a.id === attr.id ? { ...a, affects_price: next } : a))
    );
    startTransition(async () => {
      const r = await updateAttribute({ id: attr.id, affectsPrice: next });
      if (!r.success) {
        setError(r.error);
        setAttributes((cur) =>
          cur.map((a) =>
            a.id === attr.id ? { ...a, affects_price: attr.affects_price } : a
          )
        );
      }
    });
  }

  function handleToggleSplitsListing(attr: Attribute, next: boolean) {
    setError(null);
    setAttributes((cur) =>
      cur.map((a) => (a.id === attr.id ? { ...a, splits_listing: next } : a))
    );
    startTransition(async () => {
      const r = await updateAttribute({ id: attr.id, splitsListing: next });
      if (!r.success) {
        setError(r.error);
        setAttributes((cur) =>
          cur.map((a) =>
            a.id === attr.id
              ? { ...a, splits_listing: attr.splits_listing }
              : a
          )
        );
      }
    });
  }

  function handleUpdateModifier(val: AttributeValue, modifier: number) {
    if (Number.isNaN(modifier) || modifier === val.price_modifier) return;
    setError(null);
    setValues((cur) =>
      cur.map((v) =>
        v.id === val.id ? { ...v, price_modifier: modifier } : v
      )
    );
    startTransition(async () => {
      const r = await updateAttributeValue({
        id: val.id,
        priceModifier: modifier,
      });
      if (!r.success) {
        setError(r.error);
        setValues((cur) =>
          cur.map((v) =>
            v.id === val.id ? { ...v, price_modifier: val.price_modifier } : v
          )
        );
      }
    });
  }

  function handleDeleteValue(val: AttributeValue) {
    if (!confirm(`Διαγραφή τιμής «${val.value}»;`)) return;
    setError(null);
    const prev = values;
    setValues((cur) => cur.filter((v) => v.id !== val.id));
    startTransition(async () => {
      const r = await deleteAttributeValue({ id: val.id });
      if (!r.success) {
        setError(r.error);
        setValues(prev);
      }
    });
  }

  return (
    <section className="cms-card-section space-y-5">
      <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            {scope === "variant" ? (
              <Layers className="w-4 h-4" />
            ) : (
              <ClipboardList className="w-4 h-4" />
            )}
            {scope === "variant" ? "Χαρακτηριστικά παραλλαγών" : "Χαρακτηριστικά προδιαγραφών"}
          </h2>
          <p className="text-sm text-foreground/70 mt-1.5 max-w-3xl">
            {scope === "variant"
              ? "Χρησιμοποιούνται ως άξονες παραλλαγής (επιλέξιμα από τον πελάτη)."
              : "Χρησιμοποιούνται μόνο ως προδιαγραφές προϊόντος ή δεν είναι ακόμη σε χρήση."}
          </p>
        </div>
        <form onSubmit={handleCreateAttribute} className="flex items-end gap-2 shrink-0">
          <label className="block">
            <span className="block text-xs font-medium mb-1 text-muted-foreground">
              Νέος τύπος
            </span>
            <input
              value={newAttrName}
              onChange={(e) => setNewAttrName(e.target.value)}
              placeholder="π.χ. Χρώμα, Υλικό…"
              className="cms-input min-w-[220px]"
              disabled={isPending}
            />
          </label>
          <button
            type="submit"
            disabled={isPending || !newAttrName.trim()}
            className="btn btn-primary btn-md"
          >
            <span className="text-base leading-none">+</span> Δημιουργία
          </button>
        </form>
      </header>

      {error && (
        <p role="alert" className="text-sm text-destructive bg-destructive/5 border border-destructive/30 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {attributes.length === 0 ? (
        <div className="cms-empty">
          Δεν έχουν οριστεί τύποι ακόμη. Δημιουργήστε έναν παραπάνω.
        </div>
      ) : (
        <ul className="space-y-3">
          {attributes.map((attr) => {
            const vs = valuesByAttribute.get(attr.id) ?? [];
            return (
              <AttributeCard
                key={attr.id}
                attr={attr}
                values={vs}
                isPending={isPending}
                onRename={(name) => handleRenameAttribute(attr, name)}
                onDelete={() => handleDeleteAttribute(attr)}
                onToggleAffectsPrice={(next) =>
                  handleToggleAffectsPrice(attr, next)
                }
                onToggleSplitsListing={(next) =>
                  handleToggleSplitsListing(attr, next)
                }
                onRenameValue={(val, name) => handleRenameValue(val, name)}
                onUpdateModifier={(val, modifier) =>
                  handleUpdateModifier(val, modifier)
                }
                onDeleteValue={(val) => handleDeleteValue(val)}
                onValuesCreated={(created) =>
                  setValues((cur) => [...cur, ...created])
                }
                setError={setError}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * One attribute card. Inline-editable name on the left, two
 * affects-price/splits-listing toggles in the middle, delete on the
 * right. Body shows existing values as chips + a batch-create textarea
 * for adding many at once.
 */
function AttributeCard({
  attr,
  values,
  isPending,
  onRename,
  onDelete,
  onToggleAffectsPrice,
  onToggleSplitsListing,
  onRenameValue,
  onUpdateModifier,
  onDeleteValue,
  onValuesCreated,
  setError,
}: {
  attr: Attribute;
  values: AttributeValue[];
  isPending: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onToggleAffectsPrice: (next: boolean) => void;
  onToggleSplitsListing: (next: boolean) => void;
  onRenameValue: (val: AttributeValue, newValue: string) => void;
  onUpdateModifier: (val: AttributeValue, modifier: number) => void;
  onDeleteValue: (val: AttributeValue) => void;
  onValuesCreated: (created: AttributeValue[]) => void;
  setError: (msg: string | null) => void;
}) {
  const [bulkInput, setBulkInput] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleBulkAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    setError(null);
    const raw = bulkInput.trim();
    if (!raw) return;
    startTransition(async () => {
      const r = await createAttributeValuesBulk({
        attributeId: attr.id,
        raw,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      onValuesCreated(r.data.created);
      setBulkInput("");
      // Surface what happened: created vs skipped (existing) vs failed.
      // Multi-line input often has dupes when admins copy from external
      // sources — they want to know what was a no-op.
      const parts: string[] = [];
      if (r.data.created.length > 0)
        parts.push(`+${r.data.created.length} νέες`);
      if (r.data.skipped.length > 0)
        parts.push(`${r.data.skipped.length} υπήρχαν ήδη`);
      if (r.data.failed.length > 0)
        parts.push(`${r.data.failed.length} απέτυχαν`);
      setFeedback(parts.join(" · "));
      // Clear the feedback after a few seconds to avoid screen clutter.
      setTimeout(() => setFeedback(null), 4000);
    });
  }

  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-lg border border-foreground/15 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
      {/* Clickable header — toggles the body via cms-accordion. The
          header itself stays fixed (always visible); only the body
          collapses. Toggles + delete sit on the right and stopPropagation
          so clicking them doesn't also toggle the accordion.

          Rendered as a <div role="button"> rather than <button> because
          the header content includes an <input> (rename), two <Toggle>
          buttons, and a <DeleteButton> — nested interactive elements
          inside a <button> are invalid HTML and cause hydration errors
          on React 19 / Next.js 16. Keyboard handlers preserve a11y. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 flex-wrap px-4 py-3 hover:bg-muted/30 transition-colors text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
      >
        <div className="flex items-baseline gap-3 flex-wrap min-w-0">
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform shrink-0 ${
              open ? "rotate-90" : ""
            }`}
          />
          <span
            onClick={(e) => e.stopPropagation()}
            className="contents"
          >
            <input
              defaultValue={attr.name}
              onBlur={(e) => onRename(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="font-semibold text-base border-b border-transparent hover:border-foreground/30 focus:border-foreground focus:outline-none bg-transparent"
              aria-label={`Όνομα τύπου ${attr.name}`}
            />
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            {attr.slug}
          </span>
          <span className="text-xs text-muted-foreground">
            · {values.length} {values.length === 1 ? "τιμή" : "τιμές"}
          </span>
        </div>
        <div
          className="flex items-center gap-4 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Toggle
              checked={attr.affects_price}
              onChange={onToggleAffectsPrice}
              size="sm"
              ariaLabel="Επηρεάζει την τιμή"
            />
            <span>Επηρεάζει την τιμή</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Toggle
              checked={attr.splits_listing}
              onChange={onToggleSplitsListing}
              size="sm"
              ariaLabel="Ξεχωριστή κάρτα στον κατάλογο"
            />
            <span>Ξεχωριστή κάρτα στον κατάλογο</span>
          </label>
          <DeleteButton
            onClick={onDelete}
            ariaLabel={`Διαγραφή τύπου ${attr.name}`}
            title={`Διαγραφή τύπου ${attr.name}`}
            disabled={isPending}
          />
        </div>
      </div>

      {/* Accordion body — values + batch-add form. The cms-accordion
          utility animates the height + opacity smoothly. The inner
          div carries the actual padding so the animated container
          can use min-height:0 to collapse fully. */}
      <div className={`cms-accordion ${open ? "is-open" : ""}`}>
        <div>
          <div className="px-4 pb-4 pt-2 border-t border-foreground/10">
            {/* Existing values — chips sized to their content. */}
            {values.length === 0 ? (
              <p className="text-xs text-muted-foreground italic mb-3">
                Καμία τιμή ακόμη. Προσθέστε τις πρώτες παρακάτω.
              </p>
            ) : (
              <ul className="flex flex-wrap items-center gap-2 mb-3">
                {values.map((v) => (
                  <li
                    key={v.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-foreground/15 bg-muted/30 px-2 py-1 text-sm"
                  >
                    <input
                      defaultValue={v.value}
                      onBlur={(e) => onRenameValue(v, e.target.value)}
                      // Size the input to its content (+1 char buffer
                      // so the cursor has room at the end). Min 3ch so
                      // very short values like "S" still have a
                      // clickable target.
                      style={{
                        width: `${Math.max(3, v.value.length + 1)}ch`,
                      }}
                      className="bg-transparent border-b border-transparent hover:border-foreground/30 focus:border-foreground focus:outline-none text-center font-medium"
                    />
                    {attr.affects_price && (
                      <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                        <span>±</span>
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={v.price_modifier}
                          onBlur={(e) =>
                            onUpdateModifier(v, Number(e.target.value))
                          }
                          className="bg-transparent border-b border-transparent hover:border-foreground/30 focus:border-foreground focus:outline-none w-14 text-center font-mono"
                          title="Πρόσθετη χρέωση/έκπτωση τιμής"
                        />
                      </span>
                    )}
                    <button
                      onClick={() => onDeleteValue(v)}
                      disabled={isPending}
                      className="text-muted-foreground hover:text-destructive transition-colors text-base leading-none px-0.5"
                      aria-label={`Διαγραφή τιμής ${v.value}`}
                      title="Διαγραφή"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Batch-create form — accepts comma OR newline separated input.
                Constrained width + centered text so the field doesn't
                stretch awkwardly across the wide card. */}
            <form
              onSubmit={handleBulkAdd}
              className="space-y-2 max-w-2xl mx-auto"
            >
              <label className="block">
                <span className="block text-xs font-medium mb-1 text-muted-foreground text-center">
                  Προσθήκη τιμών{" "}
                  <span className="text-[11px] font-normal italic">
                    — διαχωρίστε με κόμμα ή Enter για πολλαπλή προσθήκη
                  </span>
                </span>
                <textarea
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  rows={2}
                  placeholder="Red, Blue, Green ή ένα ανά γραμμή"
                  className="cms-input text-center"
                  style={{ height: "auto", minHeight: "3rem" }}
                  disabled={isPending}
                  onKeyDown={(e) => {
                    // Ctrl/Cmd + Enter submits — admins typing multi-line
                    // input shouldn't have to reach for the mouse to commit.
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
              </label>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="submit"
                  disabled={isPending || !bulkInput.trim()}
                  className="btn btn-secondary btn-sm"
                >
                  + Προσθήκη
                </button>
                {feedback && (
                  <span className="text-xs text-muted-foreground">
                    {feedback}
                  </span>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    </li>
  );
}
