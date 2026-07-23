"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import {
  updateCustomFieldBinding,
  deleteCustomFieldBinding,
  createBindingForProductScope,
} from "@/actions/custom-fields";
import WorkshopToggle from "@/components/admin/common/WorkshopToggle";
import BinButton from "@/components/admin/common/BinButton";
import CenteredModal from "@/components/admin/common/CenteredModal";
import type { ProductBindingsResult } from "@/lib/custom-fields/findBindingsForProduct";
import type {
  ResolvedCustomFieldBinding,
  CustomFieldWithValues,
  CustomFieldGroupWithFields,
  CustomFieldDataType,
} from "@/types/custom-fields";

interface Props {
  product_id: string;
  product_name: string;
  bindingsByScope: ProductBindingsResult;
  fieldsLibrary: CustomFieldWithValues[];
  groupsLibrary: CustomFieldGroupWithFields[];
}

/**
 * Client-side interaction for the product editor's "Πεδία πελάτη" tab.
 *
 * Three sections by scope:
 *   1. Κληρονομικά από κατηγορία  → read-only here; admin link to
 *      /admin/custom-fields for editing
 *   2. Στο προϊόν αυτό           → fully editable
 *   3. Στις παραλλαγές           → per-variant editable
 *
 * Add affordance: a single "+ Πρόσθεσε" button per editable scope
 * opens a picker modal that offers both fields and groups (library
 * filtered to remove already-bound items at THAT specific scope).
 */
export default function ProductCustomFieldsClient({
  product_id,
  product_name,
  bindingsByScope,
  fieldsLibrary,
  groupsLibrary,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState<
    | { kind: "product" }
    | { kind: "variant"; variant_id: string; variant_sku: string }
    | null
  >(null);

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }
  function showError(msg: string) {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  }

  // ─── Handlers ────────────────────────────────────────────────────
  function handleToggleOverrideRequired(
    binding_id: string,
    next: boolean | null
  ) {
    startTransition(async () => {
      const r = await updateCustomFieldBinding({
        id: binding_id,
        override_required: next,
      });
      if (!r.success) return showError(r.error);
      router.refresh();
    });
  }

  function handleDeleteBinding(binding_id: string) {
    if (!confirm("Αφαίρεση σύνδεσης από αυτό το προϊόν / παραλλαγή;"))
      return;
    startTransition(async () => {
      const r = await deleteCustomFieldBinding({ id: binding_id });
      if (!r.success) return showError(r.error);
      showFlash("Η σύνδεση αφαιρέθηκε.");
      router.refresh();
    });
  }

  function handleAddBinding(input: {
    field_id?: string;
    group_id?: string;
    override_required: boolean | null;
  }) {
    if (!pickerOpen) return;
    const scope_kind = pickerOpen.kind === "product" ? "product" : "variant";
    const scope_resource_id =
      pickerOpen.kind === "product" ? product_id : pickerOpen.variant_id;
    startTransition(async () => {
      const r = await createBindingForProductScope({
        field_id: input.field_id ?? null,
        group_id: input.group_id ?? null,
        scope_kind,
        scope_resource_id,
        override_required: input.override_required,
      });
      if (!r.success) return showError(r.error);
      showFlash("Η σύνδεση προστέθηκε.");
      setPickerOpen(null);
      router.refresh();
    });
  }

  // ─── Picker library filtered to non-already-bound items per scope ─
  function libraryForScope():
    | { fields: CustomFieldWithValues[]; groups: CustomFieldGroupWithFields[] }
    | null {
    if (!pickerOpen) return null;
    let alreadyBound: ResolvedCustomFieldBinding[] = [];
    if (pickerOpen.kind === "product") {
      alreadyBound = bindingsByScope.fromProduct;
    } else {
      const v = bindingsByScope.fromVariant.find(
        (x) => x.variant_id === pickerOpen.variant_id
      );
      alreadyBound = v?.bindings ?? [];
    }
    const boundFieldIds = new Set(
      alreadyBound.filter((b) => b.field).map((b) => b.field!.id)
    );
    const boundGroupIds = new Set(
      alreadyBound.filter((b) => b.group).map((b) => b.group!.id)
    );
    return {
      fields: fieldsLibrary.filter((f) => !boundFieldIds.has(f.id)),
      groups: groupsLibrary.filter((g) => !boundGroupIds.has(g.id)),
    };
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h2 className="text-base font-semibold">
          Πεδία πελάτη για το προϊόν «{product_name}»
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Διαμορφώστε ποια πεδία πελάτη θα ζητούνται σε αυτή τη σελίδα
          προϊόντος. Τα κληρονομικά από κατηγορία εμφανίζονται μόνο για
          ενημέρωση και επεξεργάζονται στο{" "}
          <Link
            href="/admin/custom-fields"
            className="underline underline-offset-2 hover:text-foreground"
          >
            workshop πεδίων πελάτη
          </Link>
          .
        </p>
      </header>

      {/* ── Inherited from category ── */}
      <ScopeSection
        title="Κληρονομικά από κατηγορία"
        icon="category"
        count={bindingsByScope.fromCategory.length}
        emptyText="Καμία συσχέτιση από τις κατηγορίες αυτού του προϊόντος."
      >
        {bindingsByScope.fromCategory.length > 0 && (
          <ul className="space-y-1.5">
            {bindingsByScope.fromCategory.map(({ category_name, binding }) => (
              <li key={binding.id}>
                <BindingRow
                  binding={binding}
                  readOnly
                  inheritedFrom={`Κατηγορία: ${category_name}`}
                  onDelete={() => handleDeleteBinding(binding.id)}
                  onToggleOverrideRequired={(next) =>
                    handleToggleOverrideRequired(binding.id, next)
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </ScopeSection>

      {/* ── Product-scope bindings ── */}
      <ScopeSection
        title="Στο προϊόν αυτό"
        icon="product"
        count={bindingsByScope.fromProduct.length}
        emptyText="Κανένα πεδίο συνδεδεμένο σε αυτό το προϊόν ακόμη."
        footer={
          <button
            type="button"
            onClick={() => setPickerOpen({ kind: "product" })}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <Plus className="w-3.5 h-3.5" />
            Πρόσθεσε πεδίο / ομάδα
          </button>
        }
      >
        {bindingsByScope.fromProduct.length > 0 && (
          <ul className="space-y-1.5">
            {bindingsByScope.fromProduct.map((binding) => (
              <li key={binding.id}>
                <BindingRow
                  binding={binding}
                  onDelete={() => handleDeleteBinding(binding.id)}
                  onToggleOverrideRequired={(next) =>
                    handleToggleOverrideRequired(binding.id, next)
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </ScopeSection>

      {/* ── Per-variant bindings ── */}
      {bindingsByScope.fromVariant.length > 0 && (
        <ScopeSection
          title="Στις παραλλαγές"
          icon="variant"
          count={bindingsByScope.fromVariant.reduce(
            (n, v) => n + v.bindings.length,
            0
          )}
          emptyText=""
        >
          <div className="space-y-2.5">
            {bindingsByScope.fromVariant.map((v) => (
              <VariantSubSection
                key={v.variant_id}
                variant_id={v.variant_id}
                variant_sku={v.variant_sku}
                bindings={v.bindings}
                onDelete={(id) => handleDeleteBinding(id)}
                onToggleOverrideRequired={(id, next) =>
                  handleToggleOverrideRequired(id, next)
                }
                onAdd={() =>
                  setPickerOpen({
                    kind: "variant",
                    variant_id: v.variant_id,
                    variant_sku: v.variant_sku,
                  })
                }
              />
            ))}
          </div>
        </ScopeSection>
      )}

      {/* ── Picker modal ── */}
      {pickerOpen &&
        (() => {
          const lib = libraryForScope();
          if (!lib) return null;
          return (
            <BindingPickerModal
              scopeLabel={
                pickerOpen.kind === "product"
                  ? `Το προϊόν «${product_name}»`
                  : `Παραλλαγή «${pickerOpen.variant_sku}»`
              }
              fields={lib.fields}
              groups={lib.groups}
              onCancel={() => setPickerOpen(null)}
              onSubmit={handleAddBinding}
            />
          );
        })()}

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

// ─── Section wrapper (collapsible) ──────────────────────────────────

function ScopeSection({
  title,
  icon,
  count,
  emptyText,
  footer,
  children,
}: {
  title: string;
  icon: "category" | "product" | "variant";
  count: number;
  emptyText: string;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const accent =
    icon === "category"
      ? "text-amber-700"
      : icon === "product"
        ? "text-sky-700"
        : "text-violet-700";
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className="w-full flex items-center gap-2 text-sm font-semibold pb-2 mb-2 border-b border-border hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <span>{title}</span>
        <span className={`text-xs tabular-nums ${accent}`}>({count})</span>
      </button>
      {open && (
        <div className="pl-2">
          {count === 0 && emptyText && (
            <p className="text-xs text-muted-foreground italic mb-2">
              {emptyText}
            </p>
          )}
          {children}
          {footer && <div className="mt-2">{footer}</div>}
        </div>
      )}
    </section>
  );
}

function VariantSubSection({
  variant_id,
  variant_sku,
  bindings,
  onDelete,
  onToggleOverrideRequired,
  onAdd,
}: {
  variant_id: string;
  variant_sku: string;
  bindings: ResolvedCustomFieldBinding[];
  onDelete: (binding_id: string) => void;
  onToggleOverrideRequired: (binding_id: string, next: boolean | null) => void;
  onAdd: () => void;
}) {
  void variant_id;
  return (
    <div className="rounded-md bg-muted/30 border border-border p-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-mono text-xs text-muted-foreground">
          {variant_sku}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums ml-auto">
          {bindings.length}
        </span>
      </div>
      {bindings.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Καμία σύνδεση σε αυτή την παραλλαγή.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {bindings.map((b) => (
            <li key={b.id}>
              <BindingRow
                binding={b}
                onDelete={() => onDelete(b.id)}
                onToggleOverrideRequired={(next) =>
                  onToggleOverrideRequired(b.id, next)
                }
              />
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <Plus className="w-3 h-3" />
        Πρόσθεσε στην παραλλαγή
      </button>
    </div>
  );
}

// ─── Single binding row ─────────────────────────────────────────────

function BindingRow({
  binding,
  readOnly = false,
  inheritedFrom,
  onDelete,
  onToggleOverrideRequired,
}: {
  binding: ResolvedCustomFieldBinding;
  readOnly?: boolean;
  inheritedFrom?: string;
  onDelete: () => void;
  onToggleOverrideRequired: (next: boolean | null) => void;
}) {
  const isField = !!binding.field;
  const label = isField
    ? (binding.field!.label_translations.el ?? binding.field!.key)
    : (binding.group!.name_translations.el ?? "(χωρίς όνομα)");
  const subtitle = isField
    ? `${dataTypeLabel(binding.field!.data_type)}${
        binding.field!.per_unit ? " · ανά τεμάχιο" : ""
      }`
    : `${binding.group!.members.length} ${binding.group!.members.length === 1 ? "πεδίο" : "πεδία"}`;

  // Effective required = override if set, else field default (for groups
  // we show no required indicator since requirement is per-member field).
  let requiredLabel: string;
  if (isField) {
    const field = binding.field!;
    const effective =
      binding.override_required === null
        ? field.required_default
        : binding.override_required;
    if (binding.override_required === null) {
      requiredLabel = effective
        ? "Υποχρεωτικό (από προεπιλογή)"
        : "Προαιρετικό (από προεπιλογή)";
    } else {
      requiredLabel = effective
        ? "Υποχρεωτικό (override)"
        : "Προαιρετικό (override)";
    }
  } else {
    requiredLabel = "Ομάδα (απαιτητότητα ανά μέλος)";
  }

  return (
    <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted/40 border border-border">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{label}</span>
          {isField && (
            <code className="text-[10px] font-mono text-muted-foreground">
              {binding.field!.key}
            </code>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {subtitle}
          {inheritedFrom && ` · ${inheritedFrom}`}
        </p>
        <p className="text-[10px] text-muted-foreground italic mt-0.5">
          {requiredLabel}
        </p>
      </div>
      {!readOnly && isField && (
        <select
          value={
            binding.override_required === null
              ? "inherit"
              : binding.override_required
                ? "required"
                : "optional"
          }
          onChange={(e) => {
            const v = e.target.value;
            onToggleOverrideRequired(
              v === "inherit" ? null : v === "required"
            );
          }}
          className="cms-input text-xs py-0.5 w-32"
        >
          <option value="inherit">Κληρονομικό</option>
          <option value="required">Υποχρεωτικό</option>
          <option value="optional">Προαιρετικό</option>
        </select>
      )}
      {readOnly ? (
        <Link
          href={`/admin/custom-fields?expand=${binding.id}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="w-3 h-3" />
        </Link>
      ) : (
        <BinButton onClick={onDelete} ariaLabel={`Αφαίρεση ${label}`} />
      )}
    </div>
  );
}

// ─── Picker modal ───────────────────────────────────────────────────

function BindingPickerModal({
  scopeLabel,
  fields,
  groups,
  onCancel,
  onSubmit,
}: {
  scopeLabel: string;
  fields: CustomFieldWithValues[];
  groups: CustomFieldGroupWithFields[];
  onCancel: () => void;
  onSubmit: (input: {
    field_id?: string;
    group_id?: string;
    override_required: boolean | null;
  }) => void;
}) {
  const [tab, setTab] = useState<"field" | "group">("field");
  const [selectedFieldId, setSelectedFieldId] = useState<string>("");
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [overrideRequired, setOverrideRequired] = useState<
    "inherit" | "required" | "optional"
  >("inherit");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filteredFields = q
    ? fields.filter(
        (f) =>
          f.key.toLowerCase().includes(q) ||
          (f.label_translations.el ?? "").toLowerCase().includes(q)
      )
    : fields;
  const filteredGroups = q
    ? groups.filter((g) =>
        (g.name_translations.el ?? "").toLowerCase().includes(q)
      )
    : groups;

  const canSubmit =
    tab === "field"
      ? selectedFieldId.length > 0
      : selectedGroupId.length > 0;

  return (
    <CenteredModal
      title="Πρόσθεσε πεδίο ή ομάδα"
      subtitle={
        <span>
          Σε scope: <strong>{scopeLabel}</strong>
        </span>
      }
      maxWidth="max-w-lg"
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
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                field_id: tab === "field" ? selectedFieldId : undefined,
                group_id: tab === "group" ? selectedGroupId : undefined,
                override_required:
                  overrideRequired === "inherit"
                    ? null
                    : overrideRequired === "required",
              })
            }
            className="btn btn-primary btn-sm"
          >
            Προσθήκη
          </button>
        </>
      }
    >
      <div className="flex gap-1 mb-2">
        <SegBtn active={tab === "field"} onClick={() => setTab("field")}>
          Πεδίο
        </SegBtn>
        <SegBtn active={tab === "group"} onClick={() => setTab("group")}>
          Ομάδα
        </SegBtn>
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          tab === "field" ? "Αναζήτηση πεδίου…" : "Αναζήτηση ομάδας…"
        }
        className="cms-input mb-2"
      />
      <div className="max-h-56 overflow-y-auto rounded-md border border-border">
        {tab === "field" ? (
          filteredFields.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-3 py-3">
              Όλα τα ορατά πεδία είναι ήδη συνδεδεμένα ή δεν ταιριάζουν.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filteredFields.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedFieldId(f.id)}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                      selectedFieldId === f.id
                        ? "bg-emerald-50 text-emerald-900"
                        : "hover:bg-muted"
                    }`}
                  >
                    <div className="font-medium">
                      {f.label_translations.el ?? f.key}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {f.key} · {dataTypeLabel(f.data_type)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : filteredGroups.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-3 py-3">
            Όλες οι ενεργές ομάδες είναι ήδη συνδεδεμένες ή δεν ταιριάζουν.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filteredGroups.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => setSelectedGroupId(g.id)}
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                    selectedGroupId === g.id
                      ? "bg-emerald-50 text-emerald-900"
                      : "hover:bg-muted"
                  }`}
                >
                  <div className="font-medium">
                    {g.name_translations.el ?? "(χωρίς όνομα)"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {g.members.length}{" "}
                    {g.members.length === 1 ? "πεδίο" : "πεδία"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Override required (only for field bindings; group bindings have
          no per-binding required toggle in the data model). */}
      {tab === "field" && (
        <div className="pt-2 border-t border-border">
          <span className="block text-xs text-muted-foreground mb-2">
            Υποχρεωτικό σε αυτό το scope
          </span>
          <div className="flex gap-1">
            <SegBtn
              active={overrideRequired === "inherit"}
              onClick={() => setOverrideRequired("inherit")}
            >
              Κληρονομικό
            </SegBtn>
            <SegBtn
              active={overrideRequired === "required"}
              onClick={() => setOverrideRequired("required")}
            >
              Υποχρεωτικό
            </SegBtn>
            <SegBtn
              active={overrideRequired === "optional"}
              onClick={() => setOverrideRequired("optional")}
            >
              Προαιρετικό
            </SegBtn>
          </div>
        </div>
      )}
    </CenteredModal>
  );
}

function SegBtn({
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
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

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

// `WorkshopToggle` kept around for future use if we add a per-binding
// active toggle here; suppress unused-warning explicitly.
void WorkshopToggle;
