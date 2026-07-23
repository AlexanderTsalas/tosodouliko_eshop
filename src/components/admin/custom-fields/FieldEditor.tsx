"use client";

import { useState, useTransition, type ReactNode } from "react";
import { X, Plus } from "lucide-react";
import {
  updateCustomField,
  createCustomFieldValue,
  updateCustomFieldValue,
  deleteCustomFieldValue,
  deleteCustomField,
} from "@/actions/custom-fields";
import WorkshopToggle from "@/components/admin/common/WorkshopToggle";
import BinButton from "@/components/admin/common/BinButton";
import type {
  CustomFieldWithValues,
  CustomFieldValue,
  CustomFieldDataType,
  CustomFieldEditPolicy,
  CustomFieldModifierKind,
  Translations,
} from "@/types/custom-fields";

// Patch types narrowed to ONLY the fields each server action accepts.
// Spreading a CustomFieldWithValues / CustomFieldValue directly into the
// schema's input type would leak immutable fields (id, key, data_type,
// values list) and trip the schema.
type FieldPatch = Partial<{
  label_translations: Translations;
  required_default: boolean;
  visible: boolean;
  per_unit: boolean;
  validation: Record<string, unknown>;
  edit_policy: CustomFieldEditPolicy;
}>;

type ValuePatch = Partial<{
  label_translations: Translations;
  modifier_kind: CustomFieldModifierKind;
  modifier_amount: number;
  message_translations: Translations | null;
  sort_order: number;
}>;

interface Props {
  field: CustomFieldWithValues;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Inline editor for a single custom field. Expands at the top of the
 * Πεδία column when its card is clicked. Three sections:
 *
 *   1. Header  — key (immutable), close button, delete button
 *   2. Metadata — label translations (el/en), required, visible, per_unit,
 *      edit_policy, and a per-type validation panel
 *   3. Values   — per-value config table (only for deterministic types)
 *
 * Each row mutates server-side via the per-field/per-value actions.
 * Local state mirrors so the UI stays responsive.
 */
export default function FieldEditor({ field, onClose, onDeleted }: Props) {
  const [, startTransition] = useTransition();
  const [local, setLocal] = useState<CustomFieldWithValues>(field);
  const [error, setError] = useState<string | null>(null);

  function flashError(msg: string) {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  }

  // Optimistic patch helper for the parent field. The `patch` is narrow
  // (only schema-acceptable fields); when applying locally we widen to
  // `Partial<CustomFieldWithValues>` since the types align structurally.
  function patchField(patch: FieldPatch) {
    setLocal((f) => ({ ...f, ...patch }));
    startTransition(async () => {
      const r = await updateCustomField({ id: local.id, ...patch });
      if (!r.success) {
        // Revert by restoring the original field prop (caller will
        // re-render with fresh data on next refresh).
        setLocal(field);
        flashError(r.error);
      }
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `Διαγραφή πεδίου «${local.label_translations.el ?? local.key}»; Δεν επαναφέρεται.`
      )
    )
      return;
    startTransition(async () => {
      const r = await deleteCustomField({ id: local.id });
      if (!r.success) return flashError(r.error);
      onDeleted();
    });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-border">
        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost btn-sm flex items-center gap-1.5"
          aria-label="Κλείσιμο επεξεργασίας"
        >
          <X className="w-4 h-4" />
          <span>Κλείσιμο</span>
        </button>
        <div className="flex-1 min-w-0 text-right">
          <code className="text-xs font-mono text-muted-foreground">
            {local.key}
          </code>
          <span className="text-xs text-muted-foreground mx-2">·</span>
          <span className="text-xs text-muted-foreground">
            {dataTypeLabel(local.data_type)}
            {local.values.length > 0 && ` · ${local.values.length} χρήσεις`}
          </span>
        </div>
        <WorkshopToggle
          active={local.visible}
          onChange={(next) => patchField({ visible: next })}
          ariaLabel="Ορατό στο storefront"
        />
        <BinButton onClick={handleDelete} ariaLabel="Διαγραφή πεδίου" />
      </div>

      {/* Labels */}
      <Section title="Ετικέτα">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <LabelInput
            locale="el"
            value={local.label_translations.el ?? ""}
            onChange={(v) =>
              patchField({
                label_translations: { ...local.label_translations, el: v },
              })
            }
          />
          <LabelInput
            locale="en"
            value={local.label_translations.en ?? ""}
            onChange={(v) =>
              patchField({
                label_translations: { ...local.label_translations, en: v },
              })
            }
          />
        </div>
      </Section>

      {/* Behavior */}
      <Section title="Συμπεριφορά">
        <div className="space-y-2.5 text-sm">
          <Row label="Υποχρεωτικό από προεπιλογή">
            <WorkshopToggle
              active={local.required_default}
              onChange={(next) => patchField({ required_default: next })}
            />
          </Row>
          <Row label="Συλλογή ανά τεμάχιο (όταν qty > 1)">
            <WorkshopToggle
              active={local.per_unit}
              onChange={(next) => patchField({ per_unit: next })}
            />
          </Row>
          <Row label="Πολιτική επεξεργασίας μετά την πληρωμή">
            <select
              value={local.edit_policy}
              onChange={(e) =>
                patchField({
                  edit_policy: e.target.value as CustomFieldEditPolicy,
                })
              }
              className="cms-input text-sm w-64"
            >
              <option value="frozen">Παγωμένο</option>
              <option value="admin_until_dispatch">
                Admin μέχρι αποστολή
              </option>
            </select>
          </Row>
        </div>
      </Section>

      {/* Validation (per data_type) */}
      <ValidationSection field={local} patch={patchField} />

      {/* Per-value config (deterministic types only) */}
      {(local.data_type === "boolean" ||
        local.data_type === "dropdown" ||
        local.data_type === "multi_select") && (
        <ValuesSection
          field={local}
          onLocalUpdate={(values) => setLocal((f) => ({ ...f, values }))}
          flashError={flashError}
        />
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-xs px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Section primitive ───────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </h4>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground/80">{label}</span>
      {children}
    </div>
  );
}

function LabelInput({
  locale,
  value,
  onChange,
}: {
  locale: "el" | "en";
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1">
        {locale === "el" ? "Ελληνικά" : "English"}
        {locale === "el" && " *"}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={200}
        className="cms-input"
      />
    </label>
  );
}

// ─── Validation per data_type ────────────────────────────────────────

function ValidationSection({
  field,
  patch,
}: {
  field: CustomFieldWithValues;
  patch: (p: FieldPatch) => void;
}) {
  const v = field.validation as Record<string, unknown>;
  const setKey = (k: string, val: unknown) =>
    patch({ validation: { ...v, [k]: val } });
  const clearKey = (k: string) => {
    const next = { ...v };
    delete next[k];
    patch({ validation: next });
  };

  if (field.data_type === "text") {
    return (
      <Section title="Validation">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">
              Μέγιστος αριθμός χαρακτήρων
            </span>
            <input
              type="number"
              min={1}
              value={typeof v.maxLength === "number" ? v.maxLength : ""}
              onChange={(e) =>
                e.target.value
                  ? setKey("maxLength", parseInt(e.target.value, 10))
                  : clearKey("maxLength")
              }
              placeholder="200"
              className="cms-input"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">
              Regex (προχωρημένο)
            </span>
            <input
              type="text"
              value={typeof v.regex === "string" ? v.regex : ""}
              onChange={(e) =>
                e.target.value ? setKey("regex", e.target.value) : clearKey("regex")
              }
              placeholder="^[a-zA-Z\s]+$"
              className="cms-input font-mono text-xs"
            />
          </label>
        </div>
      </Section>
    );
  }

  if (field.data_type === "number") {
    return (
      <Section title="Validation">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">
              Min
            </span>
            <input
              type="number"
              value={typeof v.min === "number" ? v.min : ""}
              onChange={(e) =>
                e.target.value
                  ? setKey("min", parseFloat(e.target.value))
                  : clearKey("min")
              }
              className="cms-input"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">
              Max
            </span>
            <input
              type="number"
              value={typeof v.max === "number" ? v.max : ""}
              onChange={(e) =>
                e.target.value
                  ? setKey("max", parseFloat(e.target.value))
                  : clearKey("max")
              }
              className="cms-input"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">
              Step
            </span>
            <input
              type="number"
              step="any"
              value={typeof v.step === "number" ? v.step : ""}
              onChange={(e) =>
                e.target.value
                  ? setKey("step", parseFloat(e.target.value))
                  : clearKey("step")
              }
              className="cms-input"
            />
          </label>
          <label className="flex items-center gap-2 mt-5">
            <input
              type="checkbox"
              checked={v.integerOnly === true}
              onChange={(e) =>
                e.target.checked
                  ? setKey("integerOnly", true)
                  : clearKey("integerOnly")
              }
            />
            <span className="text-xs">Μόνο ακέραιοι</span>
          </label>
        </div>
      </Section>
    );
  }

  if (field.data_type === "multi_select") {
    return (
      <Section title="Validation">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">
              Ελάχιστες επιλογές
            </span>
            <input
              type="number"
              min={0}
              value={
                typeof v.minSelections === "number" ? v.minSelections : ""
              }
              onChange={(e) =>
                e.target.value
                  ? setKey("minSelections", parseInt(e.target.value, 10))
                  : clearKey("minSelections")
              }
              className="cms-input"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">
              Μέγιστες επιλογές
            </span>
            <input
              type="number"
              min={1}
              value={
                typeof v.maxSelections === "number" ? v.maxSelections : ""
              }
              onChange={(e) =>
                e.target.value
                  ? setKey("maxSelections", parseInt(e.target.value, 10))
                  : clearKey("maxSelections")
              }
              className="cms-input"
            />
          </label>
        </div>
      </Section>
    );
  }

  return null; // boolean, dropdown: no field-level validation knobs
}

// ─── Per-value config table ──────────────────────────────────────────

function ValuesSection({
  field,
  onLocalUpdate,
  flashError,
}: {
  field: CustomFieldWithValues;
  onLocalUpdate: (values: CustomFieldValue[]) => void;
  flashError: (msg: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [, startTransition] = useTransition();

  function patchValue(id: string, patch: ValuePatch) {
    onLocalUpdate(
      field.values.map((v) => (v.id === id ? { ...v, ...patch } : v))
    );
    startTransition(async () => {
      const r = await updateCustomFieldValue({ id, ...patch });
      if (!r.success) flashError(r.error);
    });
  }

  function removeValue(id: string) {
    if (!confirm("Διαγραφή τιμής;")) return;
    onLocalUpdate(field.values.filter((v) => v.id !== id));
    startTransition(async () => {
      const r = await deleteCustomFieldValue({ id });
      if (!r.success) flashError(r.error);
    });
  }

  function addValue(input: {
    value: string;
    label: string;
    modifierKind: CustomFieldModifierKind;
    modifierAmount: number;
  }) {
    startTransition(async () => {
      const r = await createCustomFieldValue({
        field_id: field.id,
        value: input.value,
        label_translations: { el: input.label },
        modifier_kind: input.modifierKind,
        modifier_amount: input.modifierAmount,
        sort_order: field.values.length,
      });
      if (!r.success) return flashError(r.error);
      onLocalUpdate([...field.values, r.data]);
      setAdding(false);
    });
  }

  const canAdd =
    field.data_type === "dropdown" || field.data_type === "multi_select";

  return (
    <Section title="Τιμές + κόστος">
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium">Τιμή</th>
              <th className="text-left px-3 py-1.5 font-medium">
                Ετικέτα (el)
              </th>
              <th className="text-left px-3 py-1.5 font-medium">Modifier</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {field.values.map((v) => (
              <ValueRow
                key={v.id}
                value={v}
                field={field}
                onPatch={(p) => patchValue(v.id, p)}
                onRemove={() => removeValue(v.id)}
              />
            ))}
            {field.values.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-4 text-xs text-muted-foreground italic text-center"
                >
                  Δεν έχουν οριστεί τιμές ακόμη.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canAdd && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <Plus className="w-3.5 h-3.5" />
          Νέα τιμή
        </button>
      )}
      {adding && (
        <NewValueInlineForm onCancel={() => setAdding(false)} onSubmit={addValue} />
      )}
    </Section>
  );
}

function ValueRow({
  value,
  field,
  onPatch,
  onRemove,
}: {
  value: CustomFieldValue;
  field: CustomFieldWithValues;
  onPatch: (p: ValuePatch) => void;
  onRemove: () => void;
}) {
  // Boolean rows show "true"/"false" read-only; dropdown/multi_select
  // show their string key (also immutable post-creation).
  const valueLabel =
    typeof value.value === "boolean"
      ? value.value
        ? "true"
        : "false"
      : String(value.value);

  const isBoolean = field.data_type === "boolean";

  return (
    <tr className="border-t border-border">
      <td className="px-3 py-1.5">
        <code className="text-xs font-mono text-muted-foreground">
          {valueLabel}
        </code>
      </td>
      <td className="px-3 py-1.5">
        <input
          type="text"
          value={value.label_translations.el ?? ""}
          onChange={(e) =>
            onPatch({
              label_translations: {
                ...value.label_translations,
                el: e.target.value,
              },
            })
          }
          className="cms-input text-sm py-0.5"
          maxLength={200}
        />
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <select
            value={value.modifier_kind}
            onChange={(e) =>
              onPatch({
                modifier_kind: e.target.value as CustomFieldModifierKind,
              })
            }
            className="cms-input text-xs py-0.5 w-20"
          >
            <option value="none">—</option>
            <option value="flat">€</option>
            <option value="percent">%</option>
          </select>
          {value.modifier_kind !== "none" && (
            <input
              type="number"
              step="0.01"
              value={
                value.modifier_kind === "percent"
                  ? value.modifier_amount * 100
                  : value.modifier_amount
              }
              onChange={(e) => {
                const raw = parseFloat(e.target.value) || 0;
                onPatch({
                  modifier_amount:
                    value.modifier_kind === "percent" ? raw / 100 : raw,
                });
              }}
              className="cms-input text-sm py-0.5 w-20"
            />
          )}
        </div>
      </td>
      <td className="px-2 py-1.5 text-right">
        {!isBoolean && (
          <BinButton onClick={onRemove} ariaLabel="Διαγραφή τιμής" />
        )}
      </td>
    </tr>
  );
}

function NewValueInlineForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: {
    value: string;
    label: string;
    modifierKind: CustomFieldModifierKind;
    modifierAmount: number;
  }) => void;
}) {
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [modifierKind, setModifierKind] =
    useState<CustomFieldModifierKind>("none");
  const [modifierAmount, setModifierAmount] = useState(0);

  const canSubmit =
    value.trim().length > 0 &&
    /^[a-z0-9_]+$/.test(value.trim()) &&
    label.trim().length > 0;

  return (
    <div className="mt-2 rounded-lg border border-foreground/20 bg-muted/30 p-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        <label className="block">
          <span className="block text-[10px] text-muted-foreground mb-1">
            Value key (lowercase, _)
          </span>
          <input
            type="text"
            value={value}
            onChange={(e) =>
              setValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))
            }
            placeholder="standard"
            className="cms-input font-mono text-xs py-0.5"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="block text-[10px] text-muted-foreground mb-1">
            Ετικέτα (el)
          </span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Standard"
            className="cms-input text-sm py-0.5"
            maxLength={200}
          />
        </label>
        <div className="flex items-end gap-1.5">
          <select
            value={modifierKind}
            onChange={(e) =>
              setModifierKind(e.target.value as CustomFieldModifierKind)
            }
            className="cms-input text-xs py-0.5 w-20"
          >
            <option value="none">—</option>
            <option value="flat">€</option>
            <option value="percent">%</option>
          </select>
          {modifierKind !== "none" && (
            <input
              type="number"
              step="0.01"
              value={
                modifierKind === "percent"
                  ? modifierAmount * 100
                  : modifierAmount
              }
              onChange={(e) => {
                const raw = parseFloat(e.target.value) || 0;
                setModifierAmount(modifierKind === "percent" ? raw / 100 : raw);
              }}
              className="cms-input text-sm py-0.5 flex-1"
            />
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="btn btn-secondary btn-sm"
        >
          Ακύρωση
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() =>
            onSubmit({
              value: value.trim(),
              label: label.trim(),
              modifierKind,
              modifierAmount,
            })
          }
          className="btn btn-primary btn-sm"
        >
          Προσθήκη
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function dataTypeLabel(t: CustomFieldDataType): string {
  switch (t) {
    case "text":
      return "Ελεύθερο κείμενο";
    case "number":
      return "Αριθμός";
    case "boolean":
      return "Ναι/Όχι";
    case "dropdown":
      return "Λίστα επιλογής";
    case "multi_select":
      return "Πολλαπλή επιλογή";
  }
}
