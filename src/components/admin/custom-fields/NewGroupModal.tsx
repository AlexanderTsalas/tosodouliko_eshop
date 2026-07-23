"use client";

import { useState } from "react";
import CenteredModal from "@/components/admin/common/CenteredModal";

interface Props {
  /** When set, the modal pre-shows these field labels as the initial
   *  members (used by the "create from selected" multi-select flow). */
  preSelectedFields?: Array<{ id: string; label: string }>;
  onCancel: () => void;
  onSubmit: (input: {
    name_translations: { el: string; en?: string };
    description: string | null;
    active: boolean;
    initial_field_ids: string[];
  }) => void;
}

export default function NewGroupModal({
  preSelectedFields = [],
  onCancel,
  onSubmit,
}: Props) {
  const [nameEl, setNameEl] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);

  const isValid = nameEl.trim().length > 0;
  const initialIds = preSelectedFields.map((f) => f.id);

  return (
    <CenteredModal
      title={
        preSelectedFields.length > 0
          ? `Νέα ομάδα από ${preSelectedFields.length} ${preSelectedFields.length === 1 ? "πεδίο" : "πεδία"}`
          : "Νέα ομάδα"
      }
      subtitle={
        preSelectedFields.length > 0
          ? "Τα επιλεγμένα πεδία θα μπουν ως αρχικά μέλη — μπορείτε να αλλάξετε σύνθεση αργότερα."
          : "Ξεκινήστε άδεια και προσθέστε πεδία αργότερα."
      }
      onCancel={onCancel}
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
            onClick={() =>
              onSubmit({
                name_translations: {
                  el: nameEl.trim(),
                  ...(nameEn.trim() ? { en: nameEn.trim() } : {}),
                },
                description: description.trim() || null,
                active,
                initial_field_ids: initialIds,
              })
            }
            className="btn btn-primary btn-sm"
          >
            Δημιουργία
          </button>
        </>
      }
    >
      {preSelectedFields.length > 0 && (
        <div className="rounded-md bg-sky-50 border border-sky-200 px-3 py-2 text-sm">
          <span className="block text-xs text-sky-700 mb-1">
            Αρχικά μέλη:
          </span>
          <div className="flex flex-wrap gap-1">
            {preSelectedFields.map((f) => (
              <span
                key={f.id}
                className="text-xs px-1.5 py-0.5 rounded border bg-sky-100 border-sky-200 text-sky-900"
              >
                {f.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <label className="block">
        <span className="block text-xs text-muted-foreground mb-1">
          Ονομασία ομάδας (ελληνικά) *
        </span>
        <input
          type="text"
          value={nameEl}
          onChange={(e) => setNameEl(e.target.value)}
          placeholder="π.χ. Διαμόρφωση κάρτας δώρου"
          maxLength={200}
          autoFocus
          className="cms-input"
        />
      </label>

      <label className="block">
        <span className="block text-xs text-muted-foreground mb-1">
          Ονομασία (αγγλικά, προαιρετική)
        </span>
        <input
          type="text"
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
          placeholder="e.g. Gift card setup"
          maxLength={200}
          className="cms-input"
        />
      </label>

      <label className="block">
        <span className="block text-xs text-muted-foreground mb-1">
          Περιγραφή (προαιρετική)
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={2000}
          className="cms-input"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Ενεργή αμέσως
      </label>
    </CenteredModal>
  );
}
