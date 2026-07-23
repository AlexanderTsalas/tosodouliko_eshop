"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  ClipboardList,
  Package,
  Link2,
  type LucideIcon,
} from "lucide-react";
import {
  createCustomField,
  updateCustomField,
  deleteCustomField,
  createCustomFieldGroup,
  updateCustomFieldGroup,
  deleteCustomFieldGroup,
  createCustomFieldBinding,
  updateCustomFieldBinding,
  deleteCustomFieldBinding,
} from "@/actions/custom-fields";
import WorkshopToggle from "@/components/admin/common/WorkshopToggle";
import BinButton from "@/components/admin/common/BinButton";
import NewFieldModal from "./NewFieldModal";
import FieldEditor from "./FieldEditor";
import NewGroupModal from "./NewGroupModal";
import GroupEditor from "./GroupEditor";
import NewBindingModal, { type ScopeLookups } from "./NewBindingModal";
import BindingEditor from "./BindingEditor";
import type {
  CustomFieldWithValues,
  CustomFieldGroupWithFields,
  ResolvedCustomFieldBinding,
  CustomFieldDataType,
  CustomFieldScopeKind,
  CustomFieldGroup,
} from "@/types/custom-fields";

interface Props {
  fields: CustomFieldWithValues[];
  groups: CustomFieldGroupWithFields[];
  bindings: ResolvedCustomFieldBinding[];
  categories: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  variants: Array<{
    id: string;
    sku: string;
    product_id: string;
    product_name: string;
  }>;
}

type StateFilter = "all" | "active" | "inactive";

/**
 * Custom Fields library workbench.
 *
 * Three columns side-by-side (Πεδία | Ομάδες | Συνδέσεις) on the same
 * containerless layout shipped for the offers redesign. Vertical
 * separators between columns, compact cards stacked top-to-bottom.
 *
 * Phase 8b: field CRUD wired. Clicking a field card morphs it into
 * the inline FieldEditor (above the rest of the column). Click "+ Νέο
 * πεδίο" → modal. Toggle = visibility. Bin = delete with confirm.
 *
 * Groups + bindings still read-only in this phase (8c brings their CRUD).
 */
export default function CustomFieldsLibraryBench({
  fields: initialFields,
  groups: initialGroups,
  bindings: initialBindings,
  categories,
  products,
  variants,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const lookups: ScopeLookups = { categories, products, variants };

  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Local-state mirrors of all three families so the bench can do
  // optimistic updates for toggle / delete / create. Re-sync from
  // props on every refresh.
  const [fields, setFields] =
    useState<CustomFieldWithValues[]>(initialFields);
  const [groups, setGroups] =
    useState<CustomFieldGroupWithFields[]>(initialGroups);
  const [bindings, setBindings] =
    useState<ResolvedCustomFieldBinding[]>(initialBindings);
  useEffect(() => setFields(initialFields), [initialFields]);
  useEffect(() => setGroups(initialGroups), [initialGroups]);
  useEffect(() => setBindings(initialBindings), [initialBindings]);

  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [expandedBindingId, setExpandedBindingId] = useState<string | null>(
    null
  );

  // Only one expansion at a time per the workshop pattern.
  function expandField(id: string) {
    setExpandedGroupId(null);
    setExpandedBindingId(null);
    setExpandedFieldId(id);
  }
  function expandGroup(id: string) {
    setExpandedFieldId(null);
    setExpandedBindingId(null);
    setExpandedGroupId(id);
  }
  function expandBinding(id: string) {
    setExpandedFieldId(null);
    setExpandedGroupId(null);
    setExpandedBindingId(id);
  }

  const [newFieldModalOpen, setNewFieldModalOpen] = useState(false);
  const [newGroupModal, setNewGroupModal] = useState<{
    open: boolean;
    preSelectedFieldIds: string[];
  }>({ open: false, preSelectedFieldIds: [] });
  const [newBindingModal, setNewBindingModal] = useState<{
    open: boolean;
    preTarget:
      | { kind: "field"; id: string; label: string }
      | { kind: "group"; id: string; label: string }
      | undefined;
  }>({ open: false, preTarget: undefined });

  // Multi-select state for fields → "create group from selected".
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(
    new Set()
  );
  function toggleFieldSelected(id: string, next: boolean) {
    setSelectedFieldIds((prev) => {
      const cp = new Set(prev);
      if (next) cp.add(id);
      else cp.delete(id);
      return cp;
    });
  }
  function clearFieldSelection() {
    setSelectedFieldIds(new Set());
  }

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }
  function showError(msg: string) {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  }

  // Toggle a field's visibility from the card.
  function handleToggleField(id: string, next: boolean) {
    setFields((fs) =>
      fs.map((f) => (f.id === id ? { ...f, visible: next } : f))
    );
    startTransition(async () => {
      const r = await updateCustomField({ id, visible: next });
      if (!r.success) {
        setFields((fs) =>
          fs.map((f) => (f.id === id ? { ...f, visible: !next } : f))
        );
        return showError(r.error);
      }
      router.refresh();
    });
  }

  function handleDeleteField(id: string, label: string) {
    if (!confirm(`Διαγραφή πεδίου «${label}»; Δεν επαναφέρεται.`)) return;
    if (expandedFieldId === id) setExpandedFieldId(null);
    setFields((fs) => fs.filter((f) => f.id !== id));
    startTransition(async () => {
      const r = await deleteCustomField({ id });
      if (!r.success) return showError(r.error);
      router.refresh();
    });
  }

  function handleCreateField(input: Parameters<typeof createCustomField>[0]) {
    startTransition(async () => {
      const r = await createCustomField(input);
      if (!r.success) return showError(r.error);
      showFlash(
        `Δημιουργήθηκε «${r.data.label_translations.el ?? r.data.key}»`
      );
      // Prepend to local state with empty values; the next router.refresh
      // brings the canonical row (and any seeded boolean values).
      setFields((fs) => [{ ...r.data, values: [] }, ...fs]);
      setNewFieldModalOpen(false);
      router.refresh();
    });
  }

  // ─── Group handlers ───────────────────────────────────────────────
  function handleToggleGroup(id: string, next: boolean) {
    setGroups((gs) =>
      gs.map((g) => (g.id === id ? { ...g, active: next } : g))
    );
    startTransition(async () => {
      const r = await updateCustomFieldGroup({ id, active: next });
      if (!r.success) {
        setGroups((gs) =>
          gs.map((g) => (g.id === id ? { ...g, active: !next } : g))
        );
        return showError(r.error);
      }
      router.refresh();
    });
  }
  function handleDeleteGroup(id: string, name: string) {
    if (
      !confirm(
        `Διαγραφή ομάδας «${name}»; Τα πεδία παραμένουν στη βιβλιοθήκη.`
      )
    )
      return;
    if (expandedGroupId === id) setExpandedGroupId(null);
    setGroups((gs) => gs.filter((g) => g.id !== id));
    startTransition(async () => {
      const r = await deleteCustomFieldGroup({ id });
      if (!r.success) return showError(r.error);
      router.refresh();
    });
  }
  function handleCreateGroup(
    input: Parameters<typeof createCustomFieldGroup>[0]
  ) {
    startTransition(async () => {
      const r = await createCustomFieldGroup(input);
      if (!r.success) return showError(r.error);
      const created = r.data as CustomFieldGroup;
      // Build composite shape from initial members so the new card
      // shows them immediately (router.refresh will reconcile if any
      // member couldn't be added).
      const initialIds = input.initial_field_ids ?? [];
      const memberFields = initialIds
        .map((id) => fields.find((f) => f.id === id))
        .filter((f): f is CustomFieldWithValues => !!f);
      const withMembers: CustomFieldGroupWithFields = {
        ...created,
        members: memberFields.map((field, i) => ({
          sort_order: i,
          field,
        })),
      };
      setGroups((gs) => [withMembers, ...gs]);
      setNewGroupModal({ open: false, preSelectedFieldIds: [] });
      clearFieldSelection();
      showFlash(
        `Δημιουργήθηκε «${withMembers.name_translations.el ?? "ομάδα"}»`
      );
      router.refresh();
    });
  }

  // ─── Binding handlers ─────────────────────────────────────────────
  function handleToggleBinding(id: string, next: boolean) {
    setBindings((bs) =>
      bs.map((b) => (b.id === id ? { ...b, active: next } : b))
    );
    startTransition(async () => {
      const r = await updateCustomFieldBinding({ id, active: next });
      if (!r.success) {
        setBindings((bs) =>
          bs.map((b) => (b.id === id ? { ...b, active: !next } : b))
        );
        return showError(r.error);
      }
      router.refresh();
    });
  }
  function handleDeleteBinding(id: string) {
    if (!confirm("Διαγραφή σύνδεσης;")) return;
    if (expandedBindingId === id) setExpandedBindingId(null);
    setBindings((bs) => bs.filter((b) => b.id !== id));
    startTransition(async () => {
      const r = await deleteCustomFieldBinding({ id });
      if (!r.success) return showError(r.error);
      router.refresh();
    });
  }
  function handleCreateBinding(
    input: Parameters<typeof createCustomFieldBinding>[0]
  ) {
    startTransition(async () => {
      const r = await createCustomFieldBinding(input);
      if (!r.success) return showError(r.error);
      // We don't reconstruct the resolved binding optimistically — the
      // router.refresh below brings the canonical resolved row.
      setNewBindingModal({ open: false, preTarget: undefined });
      showFlash("Δημιουργήθηκε σύνδεση");
      router.refresh();
    });
  }

  // ─── Scope-name resolution (UUIDs → friendly labels) ──────────────
  function scopeTargetName(
    kind: CustomFieldScopeKind,
    resourceId: string
  ): string {
    if (kind === "category")
      return (
        categories.find((c) => c.id === resourceId)?.name ??
        truncateUuid(resourceId)
      );
    if (kind === "product")
      return (
        products.find((p) => p.id === resourceId)?.name ??
        truncateUuid(resourceId)
      );
    const v = variants.find((x) => x.id === resourceId);
    return v ? `${v.product_name} — ${v.sku}` : truncateUuid(resourceId);
  }

  const q = query.trim().toLowerCase();

  const filteredFields = useMemo(() => {
    return fields.filter((f) => {
      if (stateFilter === "active" && !f.visible) return false;
      if (stateFilter === "inactive" && f.visible) return false;
      if (!q) return true;
      const labelGr = (f.label_translations.el ?? "").toLowerCase();
      const labelEn = (f.label_translations.en ?? "").toLowerCase();
      return (
        f.key.toLowerCase().includes(q) ||
        labelGr.includes(q) ||
        labelEn.includes(q)
      );
    });
  }, [fields, q, stateFilter]);

  const filteredGroups = useMemo(() => {
    return groups.filter((g) => {
      if (stateFilter === "active" && !g.active) return false;
      if (stateFilter === "inactive" && g.active) return false;
      if (!q) return true;
      const nameGr = (g.name_translations.el ?? "").toLowerCase();
      const nameEn = (g.name_translations.en ?? "").toLowerCase();
      return nameGr.includes(q) || nameEn.includes(q);
    });
  }, [groups, q, stateFilter]);

  const filteredBindings = useMemo(() => {
    return bindings.filter((b) => {
      if (stateFilter === "active" && !b.active) return false;
      if (stateFilter === "inactive" && b.active) return false;
      if (!q) return true;
      // Search across the target's label/name + scope kind word.
      const targetName = b.field
        ? (b.field.label_translations.el ?? b.field.key)
        : (b.group?.name_translations.el ?? "");
      return targetName.toLowerCase().includes(q);
    });
  }, [bindings, q, stateFilter]);

  return (
    <div className="space-y-4">
      {/* Toolbar: search + state filter. Mirrors the offers bench shape. */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Αναζήτηση σε πεδία, ομάδες, συνδέσεις…"
            className="cms-input pl-8"
          />
        </div>
        <div className="flex items-center gap-1 text-sm">
          <FilterChip
            active={stateFilter === "all"}
            onClick={() => setStateFilter("all")}
          >
            Όλα
          </FilterChip>
          <FilterChip
            active={stateFilter === "active"}
            onClick={() => setStateFilter("active")}
          >
            Ενεργά
          </FilterChip>
          <FilterChip
            active={stateFilter === "inactive"}
            onClick={() => setStateFilter("inactive")}
          >
            Ανενεργά
          </FilterChip>
        </div>
      </div>

      {/* 3-column grid — Πεδία | Ομάδες | Συνδέσεις. Same containerless
          layout as the offers redesign: items sit on the page bg,
          tall 2px separators between columns. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 lg:divide-x-2 divide-foreground/15 min-h-[calc(100vh-220px)]">
        <Column
          title="Πεδία"
          icon={ClipboardList}
          accent="sky"
          count={filteredFields.length}
          helperText="Επιμέρους πεδία πελάτη — επαναχρησιμοποιούνται σε όσα scope θέλετε."
        >
          {/* Inline expanded editor at the top of the column when a
              field is expanded. Mirrors the offers-bench pattern. */}
          {expandedFieldId &&
            (() => {
              const f = fields.find((x) => x.id === expandedFieldId);
              if (!f) return null;
              return (
                <div className="mb-4 rounded-lg border border-foreground/20 bg-card shadow-md p-4">
                  <FieldEditor
                    field={f}
                    onClose={() => setExpandedFieldId(null)}
                    onDeleted={() => setExpandedFieldId(null)}
                  />
                </div>
              );
            })()}

          <CardStack>
            <DashedAddButton
              label="Νέο πεδίο"
              onClick={() => setNewFieldModalOpen(true)}
            />
            {filteredFields
              .filter((f) => f.id !== expandedFieldId)
              .map((f) => (
                <FieldCard
                  key={f.id}
                  field={f}
                  selected={selectedFieldIds.has(f.id)}
                  onToggleSelect={(next) => toggleFieldSelected(f.id, next)}
                  onSelect={() => expandField(f.id)}
                  onToggleVisible={(next) => handleToggleField(f.id, next)}
                  onDelete={() =>
                    handleDeleteField(
                      f.id,
                      f.label_translations.el ?? f.key
                    )
                  }
                />
              ))}
          </CardStack>
          {q &&
            filteredFields.filter((f) => f.id !== expandedFieldId).length ===
              0 &&
            !expandedFieldId && (
              <p className="text-xs text-muted-foreground italic mt-2">
                Κανένα πεδίο δεν ταιριάζει με τα φίλτρα.
              </p>
            )}
        </Column>

        <Column
          title="Ομάδες"
          icon={Package}
          accent="emerald"
          count={filteredGroups.length}
          helperText="Επαναχρησιμοποιήσιμα πακέτα πεδίων — εφαρμόστε όλα μαζί σε ένα scope."
        >
          {expandedGroupId &&
            (() => {
              const g = groups.find((x) => x.id === expandedGroupId);
              if (!g) return null;
              return (
                <div className="mb-4 rounded-lg border border-foreground/20 bg-card shadow-md p-4">
                  <GroupEditor
                    group={g}
                    allFields={fields}
                    onClose={() => setExpandedGroupId(null)}
                    onDeleted={() => setExpandedGroupId(null)}
                    onChanged={() => router.refresh()}
                  />
                </div>
              );
            })()}
          <CardStack>
            <DashedAddButton
              label="Νέα ομάδα"
              onClick={() =>
                setNewGroupModal({ open: true, preSelectedFieldIds: [] })
              }
            />
            {filteredGroups
              .filter((g) => g.id !== expandedGroupId)
              .map((g) => (
                <GroupCard
                  key={g.id}
                  group={g}
                  onSelect={() => expandGroup(g.id)}
                  onToggleActive={(next) => handleToggleGroup(g.id, next)}
                  onDelete={() =>
                    handleDeleteGroup(
                      g.id,
                      g.name_translations.el ?? "(χωρίς όνομα)"
                    )
                  }
                />
              ))}
          </CardStack>
          {q &&
            filteredGroups.filter((g) => g.id !== expandedGroupId).length ===
              0 &&
            !expandedGroupId && (
              <p className="text-xs text-muted-foreground italic mt-2">
                Καμία ομάδα δεν ταιριάζει με τα φίλτρα.
              </p>
            )}
        </Column>

        <Column
          title="Συνδέσεις"
          icon={Link2}
          accent="purple"
          count={filteredBindings.length}
          helperText="Πού εφαρμόζεται κάθε πεδίο ή ομάδα: κατηγορία, προϊόν, ή παραλλαγή."
        >
          {expandedBindingId &&
            (() => {
              const b = bindings.find((x) => x.id === expandedBindingId);
              if (!b) return null;
              const name = scopeTargetName(
                b.scope_kind,
                b.scope_resource_id
              );
              return (
                <div className="mb-4 rounded-lg border border-foreground/20 bg-card shadow-md p-4">
                  <BindingEditor
                    binding={b}
                    scopeTargetName={name}
                    onClose={() => setExpandedBindingId(null)}
                    onDeleted={() => setExpandedBindingId(null)}
                  />
                </div>
              );
            })()}
          <CardStack>
            <DashedAddButton
              label="Νέα σύνδεση"
              onClick={() =>
                setNewBindingModal({ open: true, preTarget: undefined })
              }
            />
            {filteredBindings
              .filter((b) => b.id !== expandedBindingId)
              .map((b) => (
                <BindingCard
                  key={b.id}
                  binding={b}
                  scopeTargetName={scopeTargetName(
                    b.scope_kind,
                    b.scope_resource_id
                  )}
                  onSelect={() => expandBinding(b.id)}
                  onToggleActive={(next) => handleToggleBinding(b.id, next)}
                  onDelete={() => handleDeleteBinding(b.id)}
                />
              ))}
          </CardStack>
          {q &&
            filteredBindings.filter((b) => b.id !== expandedBindingId)
              .length === 0 &&
            !expandedBindingId && (
              <p className="text-xs text-muted-foreground italic mt-2">
                Καμία σύνδεση δεν ταιριάζει με τα φίλτρα.
              </p>
            )}
        </Column>
      </div>

      {/* Sticky bottom bar — appears when ≥1 field card is ticked. */}
      {selectedFieldIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 bg-foreground text-background rounded-full shadow-xl flex items-center gap-2 pl-4 pr-2 py-1.5">
          <span className="text-sm font-medium">
            {selectedFieldIds.size}{" "}
            {selectedFieldIds.size === 1 ? "πεδίο επιλεγμένο" : "πεδία επιλεγμένα"}
          </span>
          <span className="w-px h-5 bg-background/30 mx-1" aria-hidden />
          <button
            type="button"
            onClick={() =>
              setNewGroupModal({
                open: true,
                preSelectedFieldIds: Array.from(selectedFieldIds),
              })
            }
            className="text-sm font-semibold px-3 py-1 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
          >
            Δημιουργία ομάδας
          </button>
          <button
            type="button"
            onClick={clearFieldSelection}
            aria-label="Ακύρωση επιλογής"
            className="text-sm font-medium w-7 h-7 rounded-full hover:bg-background/15 transition-colors flex items-center justify-center"
          >
            ✕
          </button>
        </div>
      )}

      {/* Creation modals */}
      {newFieldModalOpen && (
        <NewFieldModal
          onCancel={() => setNewFieldModalOpen(false)}
          onSubmit={handleCreateField}
        />
      )}
      {newGroupModal.open && (
        <NewGroupModal
          preSelectedFields={newGroupModal.preSelectedFieldIds
            .map((id) => {
              const f = fields.find((x) => x.id === id);
              return f
                ? { id, label: f.label_translations.el ?? f.key }
                : null;
            })
            .filter((x): x is { id: string; label: string } => x !== null)}
          onCancel={() =>
            setNewGroupModal({ open: false, preSelectedFieldIds: [] })
          }
          onSubmit={handleCreateGroup}
        />
      )}
      {newBindingModal.open && (
        <NewBindingModal
          preTarget={newBindingModal.preTarget}
          fields={fields}
          groups={groups}
          lookups={lookups}
          onCancel={() =>
            setNewBindingModal({ open: false, preTarget: undefined })
          }
          onSubmit={handleCreateBinding}
        />
      )}

      {/* Flash + error pills */}
      {flash && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white text-sm px-4 py-2 rounded shadow-lg z-40">
          {flash}
        </div>
      )}
      {error && (
        <div className="fixed bottom-6 right-6 bg-destructive text-white text-sm px-4 py-2 rounded shadow-lg z-40">
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Dashed "+ Νέο…" button ──────────────────────────────────────────

function DashedAddButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full min-h-[44px] rounded-lg border-2 border-dashed border-foreground/20 flex items-center justify-center gap-1.5 hover:border-foreground/40 hover:bg-muted/30 transition-colors cursor-pointer px-3 py-2 text-muted-foreground hover:text-foreground"
    >
      <Plus className="w-4 h-4" />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

// ─── Column primitive ───────────────────────────────────────────────

function Column({
  title,
  icon: Icon,
  accent,
  count,
  helperText,
  children,
}: {
  title: string;
  icon: LucideIcon;
  accent: "emerald" | "sky" | "purple";
  count: number;
  helperText?: string;
  children: ReactNode;
}) {
  const badge = {
    emerald: "bg-emerald-100 text-emerald-700 border-emerald-200",
    sky: "bg-sky-100 text-sky-700 border-sky-200",
    purple: "bg-purple-100 text-purple-700 border-purple-200",
  }[accent];

  return (
    <section className="px-4 first:pl-0 last:pr-0">
      <header className="pb-4 mb-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <span
            className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border ${badge}`}
            aria-hidden
          >
            <Icon className="w-5 h-5" />
          </span>
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          <span className="text-sm font-medium text-foreground/60 tabular-nums ml-auto">
            {count}
          </span>
        </div>
        {helperText && (
          <p className="text-sm text-foreground/70 mt-2 leading-snug">
            {helperText}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}

function CardStack({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}

// ─── Cards ───────────────────────────────────────────────────────────

function FieldCard({
  field,
  selected,
  onToggleSelect,
  onSelect,
  onToggleVisible,
  onDelete,
}: {
  field: CustomFieldWithValues;
  selected: boolean;
  onToggleSelect: (next: boolean) => void;
  onSelect: () => void;
  onToggleVisible: (next: boolean) => void;
  onDelete: () => void;
}) {
  const label = field.label_translations.el ?? field.key;
  const modifierSummary = summarizeModifiers(field);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`rounded-lg border bg-muted/40 p-3.5 shadow-sm hover:shadow-md hover:border-foreground/25 transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 ${
        selected
          ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-background border-border"
          : "border-border"
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Multi-select checkbox — stops click propagation. */}
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelect(e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Επιλογή πεδίου ${label} για ομαδοποίηση`}
          className="mt-1 w-4 h-4 rounded border-foreground/30 focus:ring-0 cursor-pointer shrink-0 accent-emerald-500"
        />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate">{label}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            <span className="font-mono">{field.key}</span> ·{" "}
            {dataTypeLabel(field.data_type)}
            {field.required_default ? " · υποχρεωτικό" : ""}
            {field.per_unit ? " · ανά τεμάχιο" : ""}
          </p>
        </div>
        <WorkshopToggle
          active={field.visible}
          onChange={onToggleVisible}
          ariaLabel={`Ορατότητα πεδίου ${label}`}
        />
        <BinButton
          onClick={onDelete}
          ariaLabel={`Διαγραφή πεδίου ${label}`}
        />
      </div>
      {modifierSummary && (
        <p className="text-[11px] text-muted-foreground mt-2">
          {modifierSummary}
        </p>
      )}
    </div>
  );
}

function GroupCard({
  group,
  onSelect,
  onToggleActive,
  onDelete,
}: {
  group: CustomFieldGroupWithFields;
  onSelect: () => void;
  onToggleActive: (next: boolean) => void;
  onDelete: () => void;
}) {
  const name = group.name_translations.el ?? "(χωρίς όνομα)";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="rounded-lg border border-border bg-muted/40 p-3.5 shadow-sm hover:shadow-md hover:border-foreground/25 transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate">{name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {group.members.length}{" "}
            {group.members.length === 1 ? "πεδίο" : "πεδία"}
          </p>
        </div>
        <WorkshopToggle
          active={group.active}
          onChange={onToggleActive}
          ariaLabel={`Ενεργή ομάδα ${name}`}
        />
        <BinButton
          onClick={onDelete}
          ariaLabel={`Διαγραφή ομάδας ${name}`}
        />
      </div>
      {group.members.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {group.members.slice(0, 4).map(({ field }) => (
            <span
              key={field.id}
              className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-800"
            >
              {field.label_translations.el ?? field.key}
            </span>
          ))}
          {group.members.length > 4 && (
            <span className="text-[10px] text-muted-foreground self-center">
              +{group.members.length - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Binding card uses the sentence-style preview pattern (locked in
 * wireframes). Scope chip + target chip + override hint render as
 * inline highlighted spans inside Greek prose.
 */
function BindingCard({
  binding,
  scopeTargetName,
  onSelect,
  onToggleActive,
  onDelete,
}: {
  binding: ResolvedCustomFieldBinding;
  /** Resolved scope name (category name, product name, variant SKU)
   *  computed upstream in the bench. */
  scopeTargetName: string;
  onSelect: () => void;
  onToggleActive: (next: boolean) => void;
  onDelete: () => void;
}) {
  const scopeLabel = scopeKindLabel(binding.scope_kind);
  const targetName = binding.field
    ? (binding.field.label_translations.el ?? binding.field.key)
    : (binding.group?.name_translations.el ?? "(χωρίς όνομα)");
  const targetIsGroup = !!binding.group;

  const requiredHint =
    binding.override_required === null
      ? null
      : binding.override_required
        ? "υποχρεωτικό (override)"
        : "προαιρετικό (override)";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="rounded-lg border border-border bg-muted/40 p-3.5 shadow-sm hover:shadow-md hover:border-foreground/25 transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm leading-relaxed text-foreground/90">
          <span className="text-muted-foreground">Στο </span>
          <Chip accent="scope">
            {scopeLabel}: {scopeTargetName}
          </Chip>
          <span className="text-muted-foreground">
            {" "}
            εφαρμόζεται{targetIsGroup ? " η ομάδα" : " το πεδίο"}{" "}
          </span>
          <Chip accent="target">{targetName}</Chip>
          {requiredHint && (
            <span className="text-muted-foreground italic text-xs">
              {" "}
              ({requiredHint})
            </span>
          )}
          <span className="text-muted-foreground">.</span>
        </p>
        <WorkshopToggle
          active={binding.active}
          onChange={onToggleActive}
          ariaLabel="Ενεργή σύνδεση"
        />
        <BinButton onClick={onDelete} ariaLabel="Διαγραφή σύνδεσης" />
      </div>
    </div>
  );
}

// ─── Small primitives ────────────────────────────────────────────────

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-sm transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Chip({
  children,
  accent,
}: {
  children: ReactNode;
  accent: "scope" | "target";
}) {
  const cls =
    accent === "scope"
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-sky-50 border-sky-200 text-sky-800";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0 rounded border text-xs font-medium align-baseline ${cls}`}
    >
      {children}
    </span>
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

function scopeKindLabel(k: CustomFieldScopeKind): string {
  switch (k) {
    case "category":
      return "Κατηγορία";
    case "product":
      return "Προϊόν";
    case "variant":
      return "Παραλλαγή";
  }
}

function summarizeModifiers(field: CustomFieldWithValues): string | null {
  if (field.values.length === 0) return null;
  const withMod = field.values.filter((v) => v.modifier_kind !== "none");
  if (withMod.length === 0) return null;
  const examples = withMod.slice(0, 2).map((v) => {
    const sign = v.modifier_amount >= 0 ? "+" : "−";
    const amt = Math.abs(v.modifier_amount);
    return v.modifier_kind === "percent"
      ? `${sign}${Math.round(amt * 100)}%`
      : `${sign}€${amt.toFixed(2)}`;
  });
  const more = withMod.length > 2 ? ` +${withMod.length - 2}` : "";
  return `Modifiers: ${examples.join(", ")}${more}`;
}

function truncateUuid(id: string): string {
  return id.slice(0, 8) + "…";
}
