"use client";

import { useState } from "react";
import CenteredModal from "@/components/admin/common/CenteredModal";

interface Props {
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    message_title_translations: { el?: string; en?: string };
    active: boolean;
  }) => void;
}

/**
 * Creation modal — keeps the initial form tight (the rest of the
 * config lands in the inline editor right after creation). Required:
 * internal nickname. Optional: customer-facing title (el / en).
 */
export default function NewAssociationModal({ onCancel, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [titleEl, setTitleEl] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [active, setActive] = useState(true);

  const isValid = name.trim().length > 0;

  return (
    <CenteredModal
      title="Νέα συσχέτιση"
      subtitle="Δώστε ένα εσωτερικό όνομα και προαιρετικά τον τίτλο που θα δει ο πελάτης. Τα φίλτρα ρυθμίζονται αμέσως μετά."
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
            onClick={() =>
              onSubmit({
                name: name.trim(),
                message_title_translations: {
                  ...(titleEl.trim() ? { el: titleEl.trim() } : {}),
                  ...(titleEn.trim() ? { en: titleEn.trim() } : {}),
                },
                active,
              })
            }
            className="btn btn-primary btn-sm"
          >
            Δημιουργία
          </button>
        </>
      }
    >
      <label className="block">
        <span className="block text-xs text-muted-foreground mb-1">
          Εσωτερικό όνομα * <span className="text-foreground/60">(δεν φαίνεται στον πελάτη)</span>
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="π.χ. Μπλε παπούτσια → Μπλε φόρεμα"
          maxLength={200}
          autoFocus
          className="cms-input"
        />
      </label>

      <div className="border-t border-border pt-3">
        <span className="block text-xs text-muted-foreground mb-2">
          Τίτλος καρουζέλ (όπως τον βλέπει ο πελάτης)
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[10px] text-muted-foreground mb-1">
              Ελληνικά
            </span>
            <input
              type="text"
              value={titleEl}
              onChange={(e) => setTitleEl(e.target.value)}
              placeholder="π.χ. Ταιριάζει υπέροχα με αυτά"
              maxLength={200}
              className="cms-input"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] text-muted-foreground mb-1">
              English
            </span>
            <input
              type="text"
              value={titleEn}
              onChange={(e) => setTitleEn(e.target.value)}
              placeholder="e.g. Pairs beautifully with these"
              maxLength={200}
              className="cms-input"
            />
          </label>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Άδειο σημαίνει fallback στο «Προτεινόμενα Προϊόντα».
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm pt-2 border-t border-border">
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
