"use client";

import { useMemo, useState, useTransition } from "react";
import { addProductSpec } from "@/actions/product-specifications/addProductSpec";
import { removeProductSpec } from "@/actions/product-specifications/removeProductSpec";
import { createAttribute } from "@/actions/attributes/createAttribute";
import { createAttributeValue } from "@/actions/attributes/createAttributeValue";
import { ClipboardList } from "@/components/admin/common/icons";
import { compareAttributeValues } from "@/lib/sort-attribute-values";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";
import type { ProductSpecificationView } from "@/types/product-specifications";

interface CommonProps {
  /** Already-saved specs (edit) or staged specs so far (create).
   *  Shape is identical so the rendering layer doesn't branch. In
   *  create mode the `id` is a synthetic local key; the parent
   *  strips these before submitting. */
  initial: ProductSpecificationView[];
  /** All attributes (for the type picker). */
  attributes: Attribute[];
  /** All attribute_values (for the value picker per attribute). */
  attributeValues: AttributeValue[];
  /**
   * Attribute slugs already used as variant attributes on this product —
   * the picker excludes these so admins can't add a spec on the same
   * attribute that drives the variant picker.
   */
  variantAttributeSlugs: string[];
}

interface EditProps extends CommonProps {
  mode?: "edit";
  productId: string;
}

interface CreateProps extends CommonProps {
  mode: "create";
  /** Fires whenever the staged spec list changes. Parent
   *  (ProductCreateClient) buffers the snapshot and includes it in
   *  the atomic createProduct call. */
  onSpecsChange: (specs: ProductSpecificationView[]) => void;
}

type Props = EditProps | CreateProps;

/**
 * Specs picker — mirrors AxesEditor's interaction model so the two
 * sections feel identical. Committed specs render as small content-
 * sized chips; the "+ Νέο χαρακτηριστικό" dashed tile sits inline
 * with the chips at the END of the wrap row (no separate add-row
 * below). Click → expands inline → step-by-step:
 *
 *   1. Pick an attribute (or "+ Νέος τύπος…" to create one inline)
 *   2. Pick a value from existing values for that attribute (or type
 *      a new value inline — same widget shape as AxisPanel value
 *      entry, minus the multi-select since a spec is a single value)
 *   3. Submit → addProductSpec → chip appears, picker resets
 *
 * Renames live in /admin/attributes (NOT this surface) — see the
 * value display block for the why.
 */
export default function ProductSpecsPanel(props: Props) {
  const {
    initial,
    attributes,
    attributeValues,
    variantAttributeSlugs,
  } = props;
  const isCreate = props.mode === "create";
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Local mirrors so create-new flows can prepend to the picker without
  // a full router.refresh.
  const [attrsLocal, setAttrsLocal] = useState(attributes);
  const [valuesLocal, setValuesLocal] = useState(attributeValues);

  const variantSet = useMemo(
    () => new Set(variantAttributeSlugs),
    [variantAttributeSlugs]
  );
  const usedAttrIds = useMemo(
    () => new Set(rows.map((r) => r.attribute_id)),
    [rows]
  );

  const valuesByAttribute = useMemo(() => {
    const map = new Map<string, AttributeValue[]>();
    for (const v of valuesLocal) {
      const list = map.get(v.attribute_id) ?? [];
      list.push(v);
      map.set(v.attribute_id, list);
    }
    for (const list of map.values()) {
      list.sort(compareAttributeValues);
    }
    return map;
  }, [valuesLocal]);

  /** Attributes the admin can still add: not a variant attribute, not already used as a spec. */
  const availableAttributes = useMemo(
    () =>
      attrsLocal.filter((a) => !variantSet.has(a.slug) && !usedAttrIds.has(a.id)),
    [attrsLocal, variantSet, usedAttrIds]
  );

  /**
   * Commit a new rows list to local state AND propagate to the parent
   * if we're in create mode. Calling the parent's setState directly
   * inside a `setRows((cur) => ...)` updater triggers React 19's
   * setState-during-render guard ("Cannot update a component
   * (ProductForm) while rendering a different component
   * (ProductSpecsPanel)"). The fix is to compute `next` outside the
   * updater and call both setters as siblings in the event handler.
   */
  function commitRows(next: ProductSpecificationView[]) {
    setRows(next);
    if (isCreate) {
      (props as CreateProps).onSpecsChange(next);
    }
  }

  function handleSubmitSpec(args: {
    attribute: Attribute;
    value: string;
  }): Promise<{ ok: boolean }> {
    return new Promise((resolve) => {
      setError(null);
      if (isCreate) {
        // Create mode — no server call. Stage the new spec with a
        // synthetic local id (the parent strips it before sending to
        // createProduct). display_order = current length so the
        // visual sort matches insertion order.
        const newView: ProductSpecificationView = {
          id: `local-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          attribute_id: args.attribute.id,
          attribute_slug: args.attribute.slug,
          attribute_name: args.attribute.name,
          value: args.value,
          display_order: rows.length,
        };
        commitRows([...rows, newView]);
        resolve({ ok: true });
        return;
      }
      startTransition(async () => {
        const r = await addProductSpec({
          productId: (props as EditProps).productId,
          attributeId: args.attribute.id,
          value: args.value,
        });
        if (!r.success) {
          setError(r.error);
          resolve({ ok: false });
          return;
        }
        // Optimistic append — the chip lands immediately in the list.
        const newView: ProductSpecificationView = {
          id: r.data.id,
          attribute_id: args.attribute.id,
          attribute_slug: args.attribute.slug,
          attribute_name: args.attribute.name,
          value: args.value,
          display_order: r.data.display_order,
        };
        setRows((cur) => [...cur, newView]);
        resolve({ ok: true });
      });
    });
  }

  function handleRemove(row: ProductSpecificationView) {
    // Create mode skips the confirm dialog — nothing's persisted yet,
    // the cost of misclick is one click of "+ Νέο χαρακτηριστικό" to
    // re-add. Edit mode keeps the confirm because removal hits the DB.
    if (
      !isCreate &&
      !confirm(`Αφαίρεση προδιαγραφής «${row.attribute_name}: ${row.value}»;`)
    ) {
      return;
    }
    setError(null);
    if (isCreate) {
      commitRows(rows.filter((r) => r.id !== row.id));
      return;
    }
    const prev = rows;
    setRows((cur) => cur.filter((r) => r.id !== row.id));
    startTransition(async () => {
      const r = await removeProductSpec({ id: row.id });
      if (!r.success) {
        setError(r.error);
        setRows(prev);
      }
    });
  }

  return (
    <section className="cms-card-section space-y-5">
      <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
        <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
          <ClipboardList className="w-4 h-4" />
          Προδιαγραφές προϊόντος
        </h2>
        <p className="text-sm text-foreground/70 mt-1.5 max-w-3xl">
          Οι <strong>προδιαγραφές</strong> εμφανίζονται στο κάτω μέρος της
          σελίδας προϊόντος, ως λίστα με κλειδί–τιμή που{" "}
          <strong>ΔΕΝ είναι επιλέξιμη από τον πελάτη</strong> (σε αντίθεση
          με τους άξονες παραλλαγών). Χρησιμοποιούνται για να περιγράψουν
          πάγια χαρακτηριστικά του προϊόντος. Παραδείγματα:
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          <li className="cms-badge cms-badge-muted font-mono">
            Δέσιμο: Κορδόνι
          </li>
          <li className="cms-badge cms-badge-muted font-mono">
            Υλικό: Δέρμα
          </li>
          <li className="cms-badge cms-badge-muted font-mono">
            Προέλευση: Ελλάδα
          </li>
          <li className="cms-badge cms-badge-muted font-mono">
            Εποχικότητα: Άνοιξη 2026
          </li>
        </ul>
      </header>

      {/* Committed specs + "+ Νέο χαρακτηριστικό" trigger in a single
          flex-wrap row. Cards size to their content (no fixed grid
          columns) so a one-word value doesn't get a half-row of
          whitespace next to it. The dashed-tile trigger sits at the
          END of the wrap so it always appears as "the next slot",
          even when there are zero committed specs yet. */}
      <div className="flex flex-wrap gap-2 items-start">
        {rows.map((row) => (
          <SpecChip key={row.id} row={row} onRemove={handleRemove} disabled={isPending} />
        ))}
        <AddNewSpecPanel
          availableAttributes={availableAttributes}
          valuesByAttribute={valuesByAttribute}
          isPending={isPending}
          onCreateAttribute={(a) => setAttrsLocal((cur) => [...cur, a])}
          onCreateValue={(v) => setValuesLocal((cur) => [...cur, v])}
          onSubmit={handleSubmitSpec}
        />
      </div>

      {availableAttributes.length === 0 && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Όλα τα υπάρχοντα χαρακτηριστικά είναι ήδη σε χρήση. Πατήστε «+ Νέο
          χαρακτηριστικό» για να δημιουργήσετε καινούριο τύπο.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * One spec card — content-sized. Renders attribute label (small caps)
 * + value (read-only, see rename policy comment) + delete icon.
 * `inline-flex` + `w-fit` keeps the card no wider than it needs to be,
 * so short specs (e.g. "Υλικό: Δέρμα") don't get padded out to grid
 * column widths.
 */
function SpecChip({
  row,
  onRemove,
  disabled,
}: {
  row: ProductSpecificationView;
  onRemove: (row: ProductSpecificationView) => void;
  disabled: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-foreground/15 bg-card px-3 py-1.5 w-fit max-w-full">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground leading-tight">
          {row.attribute_name}
        </p>
        {/* Value display — read-only on this surface. The previous
            inline-edit input let admins accidentally rename a
            canonical attribute_value (e.g. "Κορδονι" → "Κορδόνι")
            while just browsing. Renames live in the dedicated
            /admin/attributes page, where the change propagates
            cleanly to every product that uses the value. */}
        <p
          className="text-sm font-medium leading-tight truncate"
          title="Για διόρθωση πληκτρολόγησης, επεξεργαστείτε την τιμή στη σελίδα «Χαρακτηριστικά» — η αλλαγή ισχύει σε όλα τα προϊόντα που τη χρησιμοποιούν."
        >
          {row.value}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onRemove(row)}
        disabled={disabled}
        className="text-muted-foreground hover:text-destructive transition-colors text-lg leading-none px-1 shrink-0"
        title="Αφαίρεση"
        aria-label={`Αφαίρεση προδιαγραφής ${row.attribute_name}`}
      >
        ×
      </button>
    </div>
  );
}

/**
 * Dashed-bordered "+ Νέο χαρακτηριστικό" trigger that mirrors
 * AxesEditor's AddNewAxisPanel exactly. Two-phase inline flow:
 *
 *   Phase 1 — attribute pick
 *     A <select> with existing attribute options + a "+ Νέος τύπος…"
 *     sentinel that swaps to an inline name input + create button.
 *
 *   Phase 2 — value pick
 *     A <select> with this attribute's existing values + a "+ Νέα
 *     τιμή…" sentinel that swaps to an inline text input + create
 *     button. Once the value is chosen, submits to addProductSpec
 *     (via the parent's `onSubmit`) and resets.
 *
 * Same affordance shape as the axis flow (dashed border, same fonts,
 * same buttons) — the only behavioral difference is that picking an
 * existing value here means "use this exact value for this spec",
 * whereas in axes "selecting values" means "add multiple options to
 * the axis". That's the spec-vs-axis semantic difference the user
 * called out: same UX shell, different cardinality.
 */
function AddNewSpecPanel({
  availableAttributes,
  valuesByAttribute,
  isPending,
  onCreateAttribute,
  onCreateValue,
  onSubmit,
}: {
  availableAttributes: Attribute[];
  valuesByAttribute: Map<string, AttributeValue[]>;
  isPending: boolean;
  onCreateAttribute: (a: Attribute) => void;
  onCreateValue: (v: AttributeValue) => void;
  onSubmit: (args: { attribute: Attribute; value: string }) => Promise<{ ok: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  // Phase 1: attribute pick
  const [pickedAttribute, setPickedAttribute] = useState<Attribute | null>(null);
  const [creatingNewAttr, setCreatingNewAttr] = useState(false);
  const [newAttrName, setNewAttrName] = useState("");
  // Phase 2: value pick (only relevant once pickedAttribute is set)
  const [creatingNewValue, setCreatingNewValue] = useState(false);
  const [newValueText, setNewValueText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function reset() {
    setOpen(false);
    setPickedAttribute(null);
    setCreatingNewAttr(false);
    setNewAttrName("");
    setCreatingNewValue(false);
    setNewValueText("");
    setError(null);
  }

  function handleSelectAttribute(attributeId: string) {
    if (!attributeId) return;
    if (attributeId === "__new__") {
      setCreatingNewAttr(true);
      return;
    }
    const found = availableAttributes.find((a) => a.id === attributeId);
    if (found) setPickedAttribute(found);
  }

  function handleCreateAttr() {
    setError(null);
    const name = newAttrName.trim();
    if (!name) return;
    startTransition(async () => {
      // type="text" — spec-only attributes don't drive variants so
      // they don't need select/color/size semantics. Pure free-text
      // values is how specs work today.
      const r = await createAttribute({ name, type: "text" });
      if (!r.success) {
        setError(r.error);
        return;
      }
      onCreateAttribute(r.data);
      setPickedAttribute(r.data);
      setCreatingNewAttr(false);
      setNewAttrName("");
    });
  }

  function handleSelectValue(valueId: string) {
    if (!valueId || !pickedAttribute) return;
    if (valueId === "__new__") {
      setCreatingNewValue(true);
      return;
    }
    const values = valuesByAttribute.get(pickedAttribute.id) ?? [];
    const found = values.find((v) => v.id === valueId);
    if (!found) return;
    void submitSpec(found.value);
  }

  function handleCreateValue() {
    setError(null);
    const text = newValueText.trim();
    if (!text || !pickedAttribute) return;
    startTransition(async () => {
      // Persist the new attribute_value so it shows up in future
      // pickers across the admin (matches what AxisPanel does for
      // value creation). Slug is auto-derived server-side.
      const r = await createAttributeValue({
        attributeId: pickedAttribute.id,
        value: text,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      onCreateValue(r.data);
      // Submit the spec with the freshly-created value.
      await submitSpec(text);
    });
  }

  async function submitSpec(value: string) {
    if (!pickedAttribute) return;
    const result = await onSubmit({ attribute: pickedAttribute, value });
    if (result.ok) reset();
  }

  // ─── Trigger (collapsed) ───────────────────────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={isPending}
        className="rounded-md border-2 border-dashed border-foreground/30 hover:border-foreground hover:bg-muted/30 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:hover:bg-transparent inline-flex items-center justify-center gap-1.5 text-foreground/70 hover:text-foreground"
      >
        <span className="text-base leading-none">+</span>
        Νέο χαρακτηριστικό
      </button>
    );
  }

  // ─── Expanded picker (phase 1 + phase 2) ───────────────────────────
  return (
    <fieldset className="rounded-md border-2 border-dashed border-foreground/40 bg-card p-3 space-y-2 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_2px_8px_rgba(0,0,0,0.05)] w-full max-w-md">
      <legend className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-1">
        {pickedAttribute ? `Τιμή για: ${pickedAttribute.name}` : "Νέο χαρακτηριστικό"}
      </legend>

      {/* Phase 1: attribute pick — only shown until pickedAttribute is set */}
      {!pickedAttribute && !creatingNewAttr && (
        <select
          autoFocus
          defaultValue=""
          onChange={(e) => handleSelectAttribute(e.target.value)}
          className="cms-input cms-input-sm"
          disabled={isPending}
        >
          <option value="" disabled>
            — επιλέξτε χαρακτηριστικό —
          </option>
          {availableAttributes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          <option value="__new__">+ Νέος τύπος…</option>
        </select>
      )}

      {!pickedAttribute && creatingNewAttr && (
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={newAttrName}
            onChange={(e) => setNewAttrName(e.target.value)}
            placeholder="Όνομα νέου τύπου"
            className="cms-input cms-input-sm flex-1"
            disabled={isPending}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateAttr();
              }
            }}
          />
          <button
            type="button"
            onClick={handleCreateAttr}
            disabled={isPending || !newAttrName.trim()}
            className="btn btn-primary btn-sm"
          >
            Δημιουργία
          </button>
        </div>
      )}

      {/* Phase 2: value pick — only shown after pickedAttribute is set */}
      {pickedAttribute && !creatingNewValue && (
        <select
          autoFocus
          defaultValue=""
          onChange={(e) => handleSelectValue(e.target.value)}
          className="cms-input cms-input-sm"
          disabled={isPending}
        >
          <option value="" disabled>
            — επιλέξτε τιμή —
          </option>
          {(valuesByAttribute.get(pickedAttribute.id) ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.value}
            </option>
          ))}
          <option value="__new__">+ Νέα τιμή…</option>
        </select>
      )}

      {pickedAttribute && creatingNewValue && (
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={newValueText}
            onChange={(e) => setNewValueText(e.target.value)}
            placeholder={`Νέα τιμή για ${pickedAttribute.name}`}
            className="cms-input cms-input-sm flex-1"
            disabled={isPending}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateValue();
              }
            }}
          />
          <button
            type="button"
            onClick={handleCreateValue}
            disabled={isPending || !newValueText.trim()}
            className="btn btn-primary btn-sm"
          >
            Προσθήκη
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {/* Step-back link when in phase 2 — lets the admin re-pick the
            attribute without canceling the whole flow. */}
        {pickedAttribute && (
          <button
            type="button"
            onClick={() => {
              setPickedAttribute(null);
              setCreatingNewValue(false);
              setNewValueText("");
              setError(null);
            }}
            disabled={isPending}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            ← Άλλος τύπος
          </button>
        )}
        <button
          type="button"
          onClick={reset}
          disabled={isPending}
          className="btn btn-secondary btn-sm ml-auto"
        >
          Άκυρο
        </button>
      </div>
    </fieldset>
  );
}
