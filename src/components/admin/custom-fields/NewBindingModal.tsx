"use client";

import { useState, useMemo } from "react";
import CenteredModal from "@/components/admin/common/CenteredModal";
import type {
  CustomFieldWithValues,
  CustomFieldGroupWithFields,
  CustomFieldScopeKind,
} from "@/types/custom-fields";

export interface ScopeLookups {
  categories: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  variants: Array<{
    id: string;
    sku: string;
    product_id: string;
    product_name: string;
  }>;
}

interface Props {
  /** Optional pre-fill — when the modal is opened from a "drag field
   *  onto bindings" action, the field/group is locked. */
  preTarget?:
    | { kind: "field"; id: string; label: string }
    | { kind: "group"; id: string; label: string };
  fields: CustomFieldWithValues[];
  groups: CustomFieldGroupWithFields[];
  lookups: ScopeLookups;
  onCancel: () => void;
  onSubmit: (input: {
    field_id: string | null;
    group_id: string | null;
    scope_kind: CustomFieldScopeKind;
    scope_resource_id: string;
    active: boolean;
    override_required: boolean | null;
  }) => void;
}

export default function NewBindingModal({
  preTarget,
  fields,
  groups,
  lookups,
  onCancel,
  onSubmit,
}: Props) {
  type TargetKind = "field" | "group";
  const [targetKind, setTargetKind] = useState<TargetKind>(
    preTarget?.kind ?? "field"
  );
  const [targetId, setTargetId] = useState<string>(preTarget?.id ?? "");
  const [scopeKind, setScopeKind] = useState<CustomFieldScopeKind>("category");
  const [scopeResourceId, setScopeResourceId] = useState<string>("");
  const [overrideRequired, setOverrideRequired] = useState<
    "inherit" | "required" | "optional"
  >("inherit");
  const [query, setQuery] = useState("");

  // Scope picker options based on the selected kind. We pre-compute
  // here so the picker can render filtered results live.
  const scopeOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (scopeKind === "category") {
      return lookups.categories
        .filter((c) => !q || c.name.toLowerCase().includes(q))
        .map((c) => ({ id: c.id, label: c.name, sublabel: undefined }));
    }
    if (scopeKind === "product") {
      return lookups.products
        .filter((p) => !q || p.name.toLowerCase().includes(q))
        .map((p) => ({ id: p.id, label: p.name, sublabel: undefined }));
    }
    return lookups.variants
      .filter(
        (v) =>
          !q ||
          v.sku.toLowerCase().includes(q) ||
          v.product_name.toLowerCase().includes(q)
      )
      .map((v) => ({
        id: v.id,
        label: v.product_name,
        sublabel: v.sku,
      }));
  }, [scopeKind, query, lookups]);

  const isValid = targetId.length > 0 && scopeResourceId.length > 0;

  return (
    <CenteredModal
      title="Νέα σύνδεση"
      subtitle="Συνδέστε ένα πεδίο ή μια ομάδα σε ένα scope: κατηγορία, προϊόν ή παραλλαγή."
      maxWidth="max-w-xl"
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
                field_id: targetKind === "field" ? targetId : null,
                group_id: targetKind === "group" ? targetId : null,
                scope_kind: scopeKind,
                scope_resource_id: scopeResourceId,
                active: true,
                override_required:
                  overrideRequired === "inherit"
                    ? null
                    : overrideRequired === "required",
              })
            }
            className="btn btn-primary btn-sm"
          >
            Δημιουργία
          </button>
        </>
      }
    >
      {/* Target — what we're binding (field or group). Locked when
          preTarget is supplied. */}
      <div>
        <span className="block text-xs text-muted-foreground mb-2">
          Τι συνδέετε
        </span>
        {preTarget ? (
          <div className="rounded-md bg-sky-50 border border-sky-200 px-3 py-2 text-sm">
            <span className="text-xs text-sky-700 block mb-0.5">
              {preTarget.kind === "field" ? "Πεδίο" : "Ομάδα"}:
            </span>
            <span className="font-medium text-sky-900">
              {preTarget.label}
            </span>
          </div>
        ) : (
          <>
            <div className="flex gap-1 mb-2">
              <SegBtn
                active={targetKind === "field"}
                onClick={() => {
                  setTargetKind("field");
                  setTargetId("");
                }}
              >
                Πεδίο
              </SegBtn>
              <SegBtn
                active={targetKind === "group"}
                onClick={() => {
                  setTargetKind("group");
                  setTargetId("");
                }}
              >
                Ομάδα
              </SegBtn>
            </div>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="cms-input"
            >
              <option value="">— Επιλέξτε —</option>
              {targetKind === "field"
                ? fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label_translations.el ?? f.key} ({f.key})
                    </option>
                  ))
                : groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name_translations.el ?? "(χωρίς όνομα)"}
                    </option>
                  ))}
            </select>
          </>
        )}
      </div>

      {/* Scope kind */}
      <div>
        <span className="block text-xs text-muted-foreground mb-2">
          Πού εφαρμόζεται
        </span>
        <div className="flex gap-1 mb-2">
          {(["category", "product", "variant"] as const).map((k) => (
            <SegBtn
              key={k}
              active={scopeKind === k}
              onClick={() => {
                setScopeKind(k);
                setScopeResourceId("");
                setQuery("");
              }}
            >
              {scopeKindLabel(k)}
            </SegBtn>
          ))}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Αναζήτηση ${scopeKindLabel(scopeKind).toLowerCase()}...`}
          className="cms-input mb-2"
        />
        <div className="max-h-56 overflow-y-auto rounded border border-border">
          {scopeOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-3 py-3">
              Κανένα αποτέλεσμα.
            </p>
          ) : (
            <ul>
              {scopeOptions.map((opt) => (
                <li key={opt.id}>
                  <button
                    type="button"
                    onClick={() => setScopeResourceId(opt.id)}
                    className={`w-full text-left px-3 py-2 text-sm border-b border-border last:border-b-0 transition-colors ${
                      scopeResourceId === opt.id
                        ? "bg-emerald-50 text-emerald-900"
                        : "hover:bg-muted"
                    }`}
                  >
                    <div className="font-medium">{opt.label}</div>
                    {opt.sublabel && (
                      <div className="text-xs text-muted-foreground font-mono">
                        {opt.sublabel}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Override required */}
      {targetKind === "field" && (
        <div>
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
  children: React.ReactNode;
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
