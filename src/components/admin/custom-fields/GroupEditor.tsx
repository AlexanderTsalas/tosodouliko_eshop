"use client";

import { useState, useTransition, type ReactNode } from "react";
import { X, Plus } from "lucide-react";
import {
  updateCustomFieldGroup,
  deleteCustomFieldGroup,
  addFieldToGroup,
  removeFieldFromGroup,
} from "@/actions/custom-fields";
import WorkshopToggle from "@/components/admin/common/WorkshopToggle";
import BinButton from "@/components/admin/common/BinButton";
import type {
  CustomFieldGroupWithFields,
  CustomFieldWithValues,
  Translations,
} from "@/types/custom-fields";

type GroupPatch = Partial<{
  name_translations: Translations;
  description: string | null;
  active: boolean;
}>;

interface Props {
  group: CustomFieldGroupWithFields;
  /** All fields in the library — for the "+ add member" picker. */
  allFields: CustomFieldWithValues[];
  onClose: () => void;
  onDeleted: () => void;
  /** Reload trigger after server-side member mutations so the parent
   *  bench re-syncs from props. */
  onChanged: () => void;
}

/**
 * Inline editor for a custom field group. Header, name translations,
 * description, active toggle, delete bin. Below that, the member list
 * with a "+ Πρόσθεσε πεδίο" picker.
 */
export default function GroupEditor({
  group,
  allFields,
  onClose,
  onDeleted,
  onChanged,
}: Props) {
  const [, startTransition] = useTransition();
  const [local, setLocal] = useState<CustomFieldGroupWithFields>(group);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  function flashError(msg: string) {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  }

  function patchGroup(patch: GroupPatch) {
    setLocal((g) => ({ ...g, ...patch }));
    startTransition(async () => {
      const r = await updateCustomFieldGroup({ id: local.id, ...patch });
      if (!r.success) {
        setLocal(group);
        flashError(r.error);
      }
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `Διαγραφή ομάδας «${local.name_translations.el ?? "(χωρίς όνομα)"}»; Τα πεδία παραμένουν στη βιβλιοθήκη.`
      )
    )
      return;
    startTransition(async () => {
      const r = await deleteCustomFieldGroup({ id: local.id });
      if (!r.success) return flashError(r.error);
      onDeleted();
    });
  }

  function addMember(field_id: string) {
    setPickerOpen(false);
    const field = allFields.find((f) => f.id === field_id);
    if (!field) return;
    // Optimistic append.
    const nextSort = local.members.length;
    setLocal((g) => ({
      ...g,
      members: [...g.members, { sort_order: nextSort, field }],
    }));
    startTransition(async () => {
      const r = await addFieldToGroup({
        group_id: local.id,
        field_id,
        sort_order: nextSort,
      });
      if (!r.success) {
        setLocal(group);
        return flashError(r.error);
      }
      onChanged();
    });
  }

  function removeMember(field_id: string) {
    setLocal((g) => ({
      ...g,
      members: g.members.filter((m) => m.field.id !== field_id),
    }));
    startTransition(async () => {
      const r = await removeFieldFromGroup({
        group_id: local.id,
        field_id,
      });
      if (!r.success) {
        setLocal(group);
        return flashError(r.error);
      }
      onChanged();
    });
  }

  const nonMembers = allFields.filter(
    (f) => !local.members.some((m) => m.field.id === f.id)
  );

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
        <span className="ml-auto text-xs text-muted-foreground">
          {local.members.length}{" "}
          {local.members.length === 1 ? "πεδίο" : "πεδία"}
        </span>
        <WorkshopToggle
          active={local.active}
          onChange={(next) => patchGroup({ active: next })}
          ariaLabel="Ενεργή ομάδα"
        />
        <BinButton onClick={handleDelete} ariaLabel="Διαγραφή ομάδας" />
      </div>

      {/* Name translations */}
      <Section title="Ονομασία">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">
              Ελληνικά *
            </span>
            <input
              type="text"
              value={local.name_translations.el ?? ""}
              onChange={(e) =>
                patchGroup({
                  name_translations: {
                    ...local.name_translations,
                    el: e.target.value,
                  },
                })
              }
              maxLength={200}
              className="cms-input"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">
              English
            </span>
            <input
              type="text"
              value={local.name_translations.en ?? ""}
              onChange={(e) =>
                patchGroup({
                  name_translations: {
                    ...local.name_translations,
                    en: e.target.value,
                  },
                })
              }
              maxLength={200}
              className="cms-input"
            />
          </label>
        </div>
      </Section>

      {/* Description */}
      <Section title="Περιγραφή (προαιρετική)">
        <textarea
          value={local.description ?? ""}
          onChange={(e) =>
            patchGroup({ description: e.target.value || null })
          }
          rows={2}
          maxLength={2000}
          className="cms-input w-full"
        />
      </Section>

      {/* Member list */}
      <Section title="Μέλη">
        {local.members.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Καμία ανάθεση ακόμη.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {local.members.map((m) => (
              <li
                key={m.field.id}
                className="flex items-center gap-2 px-3 py-2 rounded bg-muted/40 border border-border text-sm"
              >
                <span className="flex-1 truncate">
                  {m.field.label_translations.el ?? m.field.key}
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  {m.field.key}
                </span>
                <BinButton
                  onClick={() => removeMember(m.field.id)}
                  ariaLabel="Αφαίρεση από ομάδα"
                />
              </li>
            ))}
          </ul>
        )}
        {nonMembers.length > 0 && (
          <div className="mt-3 relative">
            {pickerOpen ? (
              <div className="rounded-lg border border-border bg-background shadow-md p-2 max-h-72 overflow-y-auto">
                <div className="text-xs text-muted-foreground mb-1.5 px-2 py-1">
                  Επιλέξτε πεδίο
                </div>
                <ul className="space-y-0.5">
                  {nonMembers.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => addMember(f.id)}
                        className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-sm flex items-center gap-2"
                      >
                        <span className="flex-1 truncate">
                          {f.label_translations.el ?? f.key}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {f.key}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(false)}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                  >
                    Ακύρωση
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <Plus className="w-3.5 h-3.5" />
                Πρόσθεσε πεδίο
              </button>
            )}
          </div>
        )}
      </Section>

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-xs px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

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
