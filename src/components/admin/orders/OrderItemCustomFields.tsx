"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Lock, Pencil } from "lucide-react";
import CenteredModal from "@/components/admin/common/CenteredModal";
import { editOrderItemCustomField } from "@/actions/orders";
import { formatCurrency as format_price } from "@/lib/multi-currency/formatCurrency";
import type { OrderItemCustomFieldEntry } from "@/lib/custom-fields/loadOrderCustomFields";

interface Props {
  entries: OrderItemCustomFieldEntry[];
  /** Order's current fulfillment_status. Pre-dispatch statuses unlock
   *  the edit UI for admin_until_dispatch fields; everything else
   *  shows the frozen badge. */
  fulfillment_status: string | null;
  /** Currency code for displaying contributed_price values. */
  currency: string;
}

// Statuses after which all admin edits are frozen — mirrors the gate
// inside editOrderItemCustomField for client-side display consistency.
const FROZEN_AFTER = new Set([
  "shipped",
  "ready_for_pickup",
  "delivered",
  "picked_up",
  "cancelled",
]);

/**
 * Renders the custom-field rows attached to one order_item, plus
 * inline "✎ Edit" buttons for fields whose edit_policy allows post-
 * payment modification AND whose parent order hasn't moved past
 * dispatch.
 *
 * Pure UI shell — the actual server-side enforcement happens inside
 * editOrderItemCustomField. The frozen badge here is a visual hint
 * (the server is the source of truth either way).
 */
export default function OrderItemCustomFields({
  entries,
  fulfillment_status,
  currency,
}: Props) {
  const [editing, setEditing] = useState<OrderItemCustomFieldEntry | null>(
    null
  );
  const router = useRouter();

  if (entries.length === 0) return null;

  const orderIsDispatched =
    fulfillment_status !== null && FROZEN_AFTER.has(fulfillment_status);

  return (
    <div className="mt-2 rounded-md bg-muted/30 border border-border px-3 py-2 space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Προσαρμογές πελάτη
      </p>
      <ul className="text-xs space-y-1">
        {entries.map((e) => {
          const editable =
            e.field.edit_policy === "admin_until_dispatch" &&
            !orderIsDispatched;
          return (
            <li
              key={e.id}
              className="flex items-start gap-2"
            >
              <span className="font-medium shrink-0">
                {pickLabel(e.field.label_translations) ?? e.field.key}
                {e.unit_index !== null && (
                  <span className="text-muted-foreground">
                    {" "}
                    (#{e.unit_index + 1})
                  </span>
                )}
                :
              </span>
              <span className="flex-1 break-words">
                {formatValueDisplay(e)}
              </span>
              {e.contributed_price > 0 && (
                <span className="shrink-0 tabular-nums text-emerald-700">
                  +{format_price(e.contributed_price, currency)}
                </span>
              )}
              {editable ? (
                <button
                  type="button"
                  onClick={() => setEditing(e)}
                  className="shrink-0 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  aria-label="Επεξεργασία πεδίου"
                  title="Επεξεργασία πεδίου"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              ) : (
                <span
                  className="shrink-0 inline-flex items-center gap-1 text-muted-foreground"
                  title={
                    e.field.edit_policy === "frozen"
                      ? "Παγωμένο πεδίο — δεν επεξεργάζεται μετά την πληρωμή"
                      : "Η παραγγελία έχει προχωρήσει — δεν επεξεργάζεται πλέον"
                  }
                >
                  <Lock className="w-3 h-3" />
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {editing && (
        <EditFieldModal
          entry={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── Edit modal ─────────────────────────────────────────────────────

function EditFieldModal({
  entry,
  onCancel,
  onSaved,
}: {
  entry: OrderItemCustomFieldEntry;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<unknown>(entry.value);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    if (!reason.trim()) {
      setError("Συμπληρώστε λόγο επεξεργασίας για το ιστορικό.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await editOrderItemCustomField({
        id: entry.id,
        value,
        reason: reason.trim(),
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <CenteredModal
      title={`Επεξεργασία — ${
        pickLabel(entry.field.label_translations) ?? entry.field.key
      }`}
      subtitle="Η τιμή ενημερώνεται αλλά η αρχική χρέωση παραμένει παγωμένη. Ο λόγος καταγράφεται στο audit log."
      maxWidth="max-w-lg"
      onCancel={onCancel}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-secondary btn-sm"
            disabled={isPending}
          >
            Ακύρωση
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="btn btn-primary btn-sm"
          >
            {isPending ? "Αποθήκευση…" : "Αποθήκευση"}
          </button>
        </>
      }
    >
      <ValueInput
        entry={entry}
        value={value}
        onChange={setValue}
      />

      <label className="block pt-2 border-t border-border">
        <span className="block text-xs text-muted-foreground mb-1">
          Λόγος επεξεργασίας *
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="π.χ. Πελάτης τηλεφώνησε για διόρθωση ονόματος"
          rows={2}
          maxLength={500}
          className="cms-input"
        />
      </label>

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-xs px-3 py-2">
          {error}
        </div>
      )}
    </CenteredModal>
  );
}

// ─── Per-type value input ───────────────────────────────────────────

function ValueInput({
  entry,
  value,
  onChange,
}: {
  entry: OrderItemCustomFieldEntry;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const dt = entry.field.data_type;
  if (dt === "text") {
    return (
      <Field label="Τιμή">
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          maxLength={
            typeof entry.field.validation.maxLength === "number"
              ? (entry.field.validation.maxLength as number)
              : undefined
          }
          className="cms-input"
        />
      </Field>
    );
  }
  if (dt === "number") {
    return (
      <Field label="Τιμή">
        <input
          type="number"
          value={
            typeof value === "number" && !Number.isNaN(value)
              ? value
              : ""
          }
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(null);
              return;
            }
            const n = parseFloat(raw);
            onChange(Number.isNaN(n) ? null : n);
          }}
          step={entry.field.validation.integerOnly === true ? 1 : undefined}
          min={
            typeof entry.field.validation.min === "number"
              ? (entry.field.validation.min as number)
              : undefined
          }
          max={
            typeof entry.field.validation.max === "number"
              ? (entry.field.validation.max as number)
              : undefined
          }
          className="cms-input"
        />
      </Field>
    );
  }
  if (dt === "boolean") {
    const current = typeof value === "boolean" ? value : null;
    return (
      <Field label="Τιμή">
        <div className="grid grid-cols-2 gap-2">
          {[true, false].map((b) => (
            <button
              key={String(b)}
              type="button"
              onClick={() => onChange(b)}
              className={`px-3 py-2 rounded border text-sm text-left transition-colors ${
                current === b
                  ? "border-emerald-500 bg-emerald-50"
                  : "border-border hover:bg-muted"
              }`}
            >
              {labelForBooleanValue(entry, b)}
            </button>
          ))}
        </div>
      </Field>
    );
  }
  if (dt === "dropdown") {
    const current = typeof value === "string" ? value : "";
    return (
      <Field label="Τιμή">
        <select
          value={current}
          onChange={(e) => onChange(e.target.value)}
          className="cms-input"
        >
          <option value="">— επιλέξτε —</option>
          {entry.field.values.map((v) => (
            <option
              key={v.id}
              value={typeof v.value === "string" ? v.value : String(v.value)}
            >
              {pickLabel(v.label_translations) ?? String(v.value)}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (dt === "multi_select") {
    const current = Array.isArray(value) ? (value as string[]) : [];
    const selectedSet = new Set(current);
    function toggle(key: string) {
      const next = new Set(selectedSet);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onChange(Array.from(next));
    }
    return (
      <Field label="Τιμές">
        <div className="rounded-md border border-border max-h-48 overflow-y-auto">
          {entry.field.values.map((v) => {
            const key =
              typeof v.value === "string" ? v.value : String(v.value);
            const selected = selectedSet.has(key);
            return (
              <label
                key={v.id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggle(key)}
                />
                {pickLabel(v.label_translations) ?? key}
              </label>
            );
          })}
        </div>
      </Field>
    );
  }
  return null;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}

// ─── Display helpers ────────────────────────────────────────────────

function formatValueDisplay(entry: OrderItemCustomFieldEntry): string {
  const { value } = entry;
  const dt = entry.field.data_type;
  if (dt === "boolean") {
    return labelForBooleanValue(
      entry,
      typeof value === "boolean" ? value : false
    );
  }
  if (dt === "dropdown") {
    const match = entry.field.values.find(
      (v) => typeof v.value === "string" && v.value === value
    );
    return pickLabel(match?.label_translations ?? null) ?? String(value);
  }
  if (dt === "multi_select") {
    if (!Array.isArray(value)) return "—";
    const labels = (value as unknown[]).map((sel) => {
      const match = entry.field.values.find(
        (v) => typeof v.value === "string" && v.value === sel
      );
      return pickLabel(match?.label_translations ?? null) ?? String(sel);
    });
    return labels.join(", ");
  }
  if (dt === "number") return value === null ? "—" : String(value);
  if (dt === "text") return (value as string) || "—";
  return JSON.stringify(value);
}

function labelForBooleanValue(
  entry: OrderItemCustomFieldEntry,
  value: boolean
): string {
  const match = entry.field.values.find((v) => v.value === value);
  return pickLabel(match?.label_translations ?? null) ?? (value ? "Ναι" : "Όχι");
}

function pickLabel(
  translations: import("@/types/custom-fields").Translations | null
): string | null {
  if (!translations) return null;
  return translations.el || translations.en || null;
}
