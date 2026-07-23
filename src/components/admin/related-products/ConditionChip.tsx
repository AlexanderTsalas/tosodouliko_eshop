"use client";

import type { ReactNode } from "react";
import Popover from "@/components/admin/offers/_Popover";
import type {
  RelatedProductsFilterCondition,
  RelatedProductsConditionKind,
  CategoryConditionConfig,
  ProductConditionConfig,
  VariantConditionConfig,
  AttributeValueConditionConfig,
  AttributeValueInConditionConfig,
  AttributePresentConditionConfig,
  TagConditionConfig,
} from "@/types/related-products";
import type { FilterLookups } from "./_lookups";

interface Props {
  condition: RelatedProductsFilterCondition;
  lookups: FilterLookups;
  /** Patch the condition (config / negate). Bench wires this to
   *  updateFilterCondition. */
  onPatch: (
    patch: Partial<{
      config: Record<string, unknown>;
      negate: boolean;
    }>
  ) => void;
  onDelete: () => void;
}

/**
 * Visual filter-condition chip with click-to-edit popover. Renders a
 * compact label summarising the condition; clicking opens the
 * per-kind config form so the admin can change details (or toggle
 * negate, or delete).
 */
export default function ConditionChip({
  condition,
  lookups,
  onPatch,
  onDelete,
}: Props) {
  const summary = summarizeCondition(condition, lookups);
  const accent = chipAccent(condition.kind);

  return (
    <Popover
      width={360}
      trigger={
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium cursor-pointer transition-colors ${accent} ${
            condition.negate ? "line-through opacity-75" : ""
          } hover:shadow-sm`}
        >
          {summary}
        </span>
      }
    >
      {(close) => (
        <div className="space-y-3">
          <header className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">
              {conditionKindLabel(condition.kind)}
            </h4>
            <span className="text-[10px] text-muted-foreground">
              chip popover
            </span>
          </header>

          {/* Per-kind config form */}
          <ConditionConfigForm
            kind={condition.kind}
            config={condition.config as Record<string, unknown>}
            lookups={lookups}
            onChange={(cfg) => onPatch({ config: cfg })}
          />

          {/* Negate toggle */}
          <label className="flex items-center gap-2 text-sm pt-2 border-t border-border">
            <input
              type="checkbox"
              checked={condition.negate}
              onChange={(e) => onPatch({ negate: e.target.checked })}
            />
            Αντιστροφή (όχι)
          </label>

          {/* Delete */}
          <div className="pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => {
                onDelete();
                close();
              }}
              className="text-xs text-destructive hover:underline"
            >
              ✕ Διαγραφή φίλτρου
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

// ─── Per-kind config forms ───────────────────────────────────────────

export function ConditionConfigForm({
  kind,
  config,
  lookups,
  onChange,
}: {
  kind: RelatedProductsConditionKind;
  config: Record<string, unknown>;
  lookups: FilterLookups;
  onChange: (cfg: Record<string, unknown>) => void;
}) {
  switch (kind) {
    case "category":
      return (
        <CategoryConfigForm
          config={config as unknown as CategoryConditionConfig}
          lookups={lookups}
          onChange={onChange}
        />
      );
    case "product":
      return (
        <ProductConfigForm
          config={config as unknown as ProductConditionConfig}
          lookups={lookups}
          onChange={onChange}
        />
      );
    case "variant":
      return (
        <VariantConfigForm
          config={config as unknown as VariantConditionConfig}
          lookups={lookups}
          onChange={onChange}
        />
      );
    case "attribute_value":
      return (
        <AttributeValueConfigForm
          config={config as unknown as AttributeValueConditionConfig}
          lookups={lookups}
          onChange={onChange}
        />
      );
    case "attribute_value_in":
      return (
        <AttributeValueInConfigForm
          config={config as unknown as AttributeValueInConditionConfig}
          lookups={lookups}
          onChange={onChange}
        />
      );
    case "attribute_present":
      return (
        <AttributePresentConfigForm
          config={config as unknown as AttributePresentConditionConfig}
          lookups={lookups}
          onChange={onChange}
        />
      );
    case "tag":
      return (
        <TagConfigForm
          config={config as unknown as TagConditionConfig}
          onChange={onChange}
        />
      );
  }
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

function CategoryConfigForm({
  config,
  lookups,
  onChange,
}: {
  config: CategoryConditionConfig;
  lookups: FilterLookups;
  onChange: (cfg: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2">
      <Field label="Κατηγορία">
        <select
          value={config.category_id ?? ""}
          onChange={(e) =>
            onChange({ ...config, category_id: e.target.value })
          }
          className="cms-input"
        >
          <option value="">— Επιλέξτε —</option>
          {lookups.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={config.include_descendants ?? true}
          onChange={(e) =>
            onChange({ ...config, include_descendants: e.target.checked })
          }
        />
        Συμπερίληψη υποκατηγοριών
      </label>
    </div>
  );
}

function ProductConfigForm({
  config,
  lookups,
  onChange,
}: {
  config: ProductConditionConfig;
  lookups: FilterLookups;
  onChange: (cfg: Record<string, unknown>) => void;
}) {
  return (
    <Field label="Προϊόν">
      <select
        value={config.product_id ?? ""}
        onChange={(e) => onChange({ ...config, product_id: e.target.value })}
        className="cms-input"
      >
        <option value="">— Επιλέξτε —</option>
        {lookups.products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

function VariantConfigForm({
  config,
  lookups,
  onChange,
}: {
  config: VariantConditionConfig;
  lookups: FilterLookups;
  onChange: (cfg: Record<string, unknown>) => void;
}) {
  return (
    <Field label="Παραλλαγή">
      <select
        value={config.variant_id ?? ""}
        onChange={(e) => onChange({ ...config, variant_id: e.target.value })}
        className="cms-input"
      >
        <option value="">— Επιλέξτε —</option>
        {lookups.variants.map((v) => (
          <option key={v.id} value={v.id}>
            {v.product_name} — {v.sku}
          </option>
        ))}
      </select>
    </Field>
  );
}

function AttributeValueConfigForm({
  config,
  lookups,
  onChange,
}: {
  config: AttributeValueConditionConfig;
  lookups: FilterLookups;
  onChange: (cfg: Record<string, unknown>) => void;
}) {
  const valuesForAttr = lookups.attributeValues.filter(
    (v) => v.attribute_id === config.attribute_id
  );
  return (
    <div className="space-y-2">
      <Field label="Χαρακτηριστικό">
        <select
          value={config.attribute_id ?? ""}
          onChange={(e) =>
            onChange({ ...config, attribute_id: e.target.value, value: "" })
          }
          className="cms-input"
        >
          <option value="">— Επιλέξτε —</option>
          {lookups.attributes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      {config.attribute_id && valuesForAttr.length > 0 ? (
        <Field label="Τιμή">
          {/* IMPORTANT: store the attribute_value's UUID, not its
              display label. product_variants.attribute_combo holds
              `{attribute_id: attribute_value_id}` UUIDs, and the
              resolver compares `variant.attributes[attr_id] === cfg.value`
              — passing the label here makes that comparison always
              false (the bug Phase 9 shipped with). */}
          <select
            value={config.value ?? ""}
            onChange={(e) => onChange({ ...config, value: e.target.value })}
            className="cms-input"
          >
            <option value="">— Επιλέξτε —</option>
            {valuesForAttr.map((v) => (
              <option key={v.id} value={v.id}>
                {v.value}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label="Τιμή (ελεύθερη)">
          <input
            type="text"
            value={config.value ?? ""}
            onChange={(e) => onChange({ ...config, value: e.target.value })}
            placeholder="π.χ. blue"
            maxLength={200}
            className="cms-input"
          />
        </Field>
      )}
    </div>
  );
}

function AttributeValueInConfigForm({
  config,
  lookups,
  onChange,
}: {
  config: AttributeValueInConditionConfig;
  lookups: FilterLookups;
  onChange: (cfg: Record<string, unknown>) => void;
}) {
  const valuesForAttr = lookups.attributeValues.filter(
    (v) => v.attribute_id === config.attribute_id
  );
  const selected = new Set(config.values ?? []);

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange({ ...config, values: Array.from(next) });
  }

  return (
    <div className="space-y-2">
      <Field label="Χαρακτηριστικό">
        <select
          value={config.attribute_id ?? ""}
          onChange={(e) =>
            onChange({ ...config, attribute_id: e.target.value, values: [] })
          }
          className="cms-input"
        >
          <option value="">— Επιλέξτε —</option>
          {lookups.attributes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      {config.attribute_id && valuesForAttr.length > 0 ? (
        <Field label="Τιμές (επιλέξτε μία ή περισσότερες)">
          {/* See the note on AttributeValueConfigForm — values stored
              here MUST be attribute_value UUIDs (not display labels),
              to match what product_variants.attribute_combo holds. */}
          <div className="rounded-md border border-border max-h-40 overflow-y-auto">
            {valuesForAttr.map((v) => (
              <label
                key={v.id}
                className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-muted cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(v.id)}
                  onChange={() => toggle(v.id)}
                />
                {v.value}
              </label>
            ))}
          </div>
        </Field>
      ) : config.attribute_id ? (
        <p className="text-[10px] text-muted-foreground italic">
          Το χαρακτηριστικό δεν έχει προ-καθορισμένες τιμές.
        </p>
      ) : null}
    </div>
  );
}

function AttributePresentConfigForm({
  config,
  lookups,
  onChange,
}: {
  config: AttributePresentConditionConfig;
  lookups: FilterLookups;
  onChange: (cfg: Record<string, unknown>) => void;
}) {
  return (
    <Field label="Χαρακτηριστικό">
      <select
        value={config.attribute_id ?? ""}
        onChange={(e) =>
          onChange({ ...config, attribute_id: e.target.value })
        }
        className="cms-input"
      >
        <option value="">— Επιλέξτε —</option>
        {lookups.attributes.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

function TagConfigForm({
  config,
  onChange,
}: {
  config: TagConditionConfig;
  onChange: (cfg: Record<string, unknown>) => void;
}) {
  return (
    <Field label="Tag">
      <input
        type="text"
        value={config.tag ?? ""}
        onChange={(e) => onChange({ ...config, tag: e.target.value })}
        placeholder="π.χ. summer"
        maxLength={100}
        className="cms-input"
      />
    </Field>
  );
}

// ─── Summaries + visual helpers ─────────────────────────────────────

export function summarizeCondition(
  condition: RelatedProductsFilterCondition,
  lookups: FilterLookups
): string {
  const prefix = condition.negate ? "ΟΧΙ " : "";
  switch (condition.kind) {
    case "category": {
      const cfg = condition.config as CategoryConditionConfig;
      const name =
        lookups.categories.find((c) => c.id === cfg.category_id)?.name ??
        "(μη ρυθμισμένη)";
      return `${prefix}Κατηγορία: ${name}${cfg.include_descendants ? " ⤵" : ""}`;
    }
    case "product": {
      const cfg = condition.config as ProductConditionConfig;
      const name =
        lookups.products.find((p) => p.id === cfg.product_id)?.name ??
        "(μη ρυθμισμένο)";
      return `${prefix}Προϊόν: ${name}`;
    }
    case "variant": {
      const cfg = condition.config as VariantConditionConfig;
      const v = lookups.variants.find((x) => x.id === cfg.variant_id);
      return v
        ? `${prefix}Παραλλαγή: ${v.sku}`
        : `${prefix}Παραλλαγή: (μη ρυθμισμένη)`;
    }
    case "attribute_value": {
      const cfg = condition.config as AttributeValueConditionConfig;
      const attr =
        lookups.attributes.find((a) => a.id === cfg.attribute_id)?.name ??
        "?";
      // cfg.value is the attribute_value UUID — resolve back to its
      // human label for display. Falls back to the raw string when
      // the value isn't found (legacy rows or free-text values).
      const valueLabel =
        lookups.attributeValues.find((v) => v.id === cfg.value)?.value ??
        cfg.value;
      return `${prefix}${attr} = ${valueLabel || "?"}`;
    }
    case "attribute_value_in": {
      const cfg = condition.config as AttributeValueInConditionConfig;
      const attr =
        lookups.attributes.find((a) => a.id === cfg.attribute_id)?.name ??
        "?";
      // Resolve each saved UUID to its display label.
      const labels = (cfg.values ?? []).map(
        (id) =>
          lookups.attributeValues.find((v) => v.id === id)?.value ?? id
      );
      const list = labels.join(", ") || "?";
      return `${prefix}${attr} ∈ {${list}}`;
    }
    case "attribute_present": {
      const cfg = condition.config as AttributePresentConditionConfig;
      const attr =
        lookups.attributes.find((a) => a.id === cfg.attribute_id)?.name ??
        "?";
      return `${prefix}Έχει: ${attr}`;
    }
    case "tag": {
      const cfg = condition.config as TagConditionConfig;
      return `${prefix}Tag: ${cfg.tag || "?"}`;
    }
  }
}

export function chipAccent(kind: RelatedProductsConditionKind): string {
  switch (kind) {
    case "category":
    case "product":
    case "variant":
      return "bg-amber-50 border-amber-200 text-amber-800";
    case "attribute_value":
    case "attribute_value_in":
    case "attribute_present":
      return "bg-sky-50 border-sky-200 text-sky-800";
    case "tag":
      return "bg-purple-50 border-purple-200 text-purple-800";
  }
}

export function conditionKindLabel(k: RelatedProductsConditionKind): string {
  switch (k) {
    case "category":
      return "Κατηγορία";
    case "product":
      return "Προϊόν";
    case "variant":
      return "Παραλλαγή";
    case "attribute_value":
      return "Τιμή χαρακτηριστικού";
    case "attribute_value_in":
      return "Σύνολο τιμών";
    case "attribute_present":
      return "Έχει χαρακτηριστικό";
    case "tag":
      return "Tag";
  }
}
