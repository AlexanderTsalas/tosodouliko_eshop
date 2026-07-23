"use client";

import { useEffect, useState } from "react";
import CenteredModal from "@/components/admin/common/CenteredModal";
import type {
  CustomFieldDataType,
  CustomFieldEditPolicy,
} from "@/types/custom-fields";

interface Props {
  onCancel: () => void;
  onSubmit: (input: {
    key: string;
    label_translations: { el: string; en?: string };
    data_type: CustomFieldDataType;
    required_default: boolean;
    visible: boolean;
    per_unit: boolean;
    edit_policy: CustomFieldEditPolicy;
  }) => void;
}

const TYPES: Array<{
  value: CustomFieldDataType;
  title: string;
  description: string;
}> = [
  {
    value: "text",
    title: "Ελεύθερο κείμενο",
    description: "Π.χ. μήνυμα δώρου ή προσωπική σημείωση",
  },
  {
    value: "number",
    title: "Αριθμός",
    description: "Π.χ. μέτρα ή ποσότητα",
  },
  {
    value: "boolean",
    title: "Ναι / Όχι",
    description: "Δίτιμη επιλογή — μπορεί να φέρει modifier",
  },
  {
    value: "dropdown",
    title: "Λίστα επιλογής",
    description: "Μία επιλογή από πολλές, καθεμία με δικό της modifier",
  },
  {
    value: "multi_select",
    title: "Πολλαπλή επιλογή",
    description: "Πολλές επιλογές ταυτόχρονα — modifiers αθροίζονται",
  },
];

/**
 * Modal for creating a new custom field. Captures the minimum needed
 * to create the row; per-value config (for dropdown/multi_select) is
 * configured AFTER creation via the inline field editor.
 *
 * Auto-derives a key slug from the Greek label if the admin doesn't
 * type one explicitly. Validates locally before submit.
 */
export default function NewFieldModal({ onCancel, onSubmit }: Props) {
  const [labelEl, setLabelEl] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [keyExplicit, setKeyExplicit] = useState("");
  const [autoKey, setAutoKey] = useState("");
  const [dataType, setDataType] = useState<CustomFieldDataType>("text");
  const [requiredDefault, setRequiredDefault] = useState(false);
  const [perUnit, setPerUnit] = useState(false);
  const [editPolicy, setEditPolicy] =
    useState<CustomFieldEditPolicy>("frozen");

  // Re-compute the auto-key whenever the Greek label changes — but only
  // if the admin hasn't typed an explicit key (we don't fight their
  // input). Strip diacritics, lowercase, replace non-alphanumerics with
  // _, trim runs of _.
  useEffect(() => {
    const slug = labelEl
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    setAutoKey(slug);
  }, [labelEl]);

  const finalKey = (keyExplicit || autoKey).slice(0, 100);
  const isValid =
    labelEl.trim().length > 0 &&
    finalKey.length > 0 &&
    /^[a-z][a-z0-9_]*$/.test(finalKey);

  function handleSubmit() {
    if (!isValid) return;
    onSubmit({
      key: finalKey,
      label_translations: {
        el: labelEl.trim(),
        ...(labelEn.trim() ? { en: labelEn.trim() } : {}),
      },
      data_type: dataType,
      required_default: requiredDefault,
      visible: true,
      per_unit: perUnit,
      edit_policy: editPolicy,
    });
  }

  return (
    <CenteredModal
      title="Νέο πεδίο πελάτη"
      subtitle="Ο τύπος δεν αλλάζει μετά τη δημιουργία."
      onCancel={onCancel}
      maxWidth="max-w-lg"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-secondary btn-sm"
          >
            Ακύρωση
          </button>
          <button
            type="button"
            disabled={!isValid}
            onClick={handleSubmit}
            className="btn btn-primary btn-sm"
          >
            Δημιουργία
          </button>
        </>
      }
    >
      <div>
        <span className="block text-xs text-muted-foreground mb-2">
          Τύπος δεδομένων
        </span>
        <div className="grid gap-1.5">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setDataType(t.value)}
              className={`w-full text-left px-3 py-2 rounded border transition-colors ${
                dataType === t.value
                  ? "border-emerald-500 bg-emerald-50"
                  : "border-border hover:bg-muted"
              }`}
            >
              <div className="text-sm font-medium">{t.title}</div>
              <div className="text-xs text-muted-foreground">
                {t.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="block text-xs text-muted-foreground mb-1">
          Ετικέτα (ελληνικά) *
        </span>
        <input
          type="text"
          value={labelEl}
          onChange={(e) => setLabelEl(e.target.value)}
          placeholder="π.χ. Μήνυμα κάρτας δώρου"
          maxLength={200}
          autoFocus
          className="cms-input"
        />
      </label>

      <label className="block">
        <span className="block text-xs text-muted-foreground mb-1">
          Ετικέτα (αγγλικά, προαιρετική)
        </span>
        <input
          type="text"
          value={labelEn}
          onChange={(e) => setLabelEn(e.target.value)}
          placeholder="e.g. Gift card message"
          maxLength={200}
          className="cms-input"
        />
      </label>

      <label className="block">
        <span className="block text-xs text-muted-foreground mb-1">
          Key (αναγνωριστικό){" "}
          {!keyExplicit && autoKey && (
            <span className="text-foreground/60">
              — αυτόματο από ετικέτα
            </span>
          )}
        </span>
        <input
          type="text"
          value={keyExplicit || autoKey}
          onChange={(e) =>
            setKeyExplicit(
              e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_")
            )
          }
          placeholder="gift_message"
          maxLength={100}
          className="cms-input font-mono text-xs"
        />
        {finalKey.length > 0 && !/^[a-z][a-z0-9_]*$/.test(finalKey) && (
          <span className="text-[10px] text-destructive">
            Το key πρέπει να αρχίζει με γράμμα και να περιέχει μόνο πεζά,
            αριθμούς, _
          </span>
        )}
      </label>

      <div className="space-y-1.5 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={requiredDefault}
            onChange={(e) => setRequiredDefault(e.target.checked)}
          />
          Υποχρεωτικό από προεπιλογή
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={perUnit}
            onChange={(e) => setPerUnit(e.target.checked)}
          />
          Συλλογή ανά τεμάχιο (όταν ποσότητα {">"} 1)
        </label>
      </div>

      <label className="block">
        <span className="block text-xs text-muted-foreground mb-1">
          Πολιτική επεξεργασίας μετά την πληρωμή
        </span>
        <select
          value={editPolicy}
          onChange={(e) =>
            setEditPolicy(e.target.value as CustomFieldEditPolicy)
          }
          className="cms-input"
        >
          <option value="frozen">
            Παγωμένο (κανένας δεν αλλάζει την τιμή μετά την πληρωμή)
          </option>
          <option value="admin_until_dispatch">
            Επεξεργάσιμο από admin μέχρι την αποστολή
          </option>
        </select>
      </label>
    </CenteredModal>
  );
}
