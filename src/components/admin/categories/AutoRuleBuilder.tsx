"use client";

import type { Attribute, AttributeValue } from "@/types/attribute-facets";
import type { AutoCategoryRules } from "@/types/category-navigation";

interface Props {
  attributes: Attribute[];
  values: AttributeValue[];
  rules: AutoCategoryRules;
  onChange: (rules: AutoCategoryRules) => void;
}

/**
 * Picks attribute values that variants must match to belong to this
 * auto-category. OR within an attribute, AND across attributes. Rule
 * documents store attribute_value UUIDs (not text); the form renders the
 * human-readable label via attribute_values lookup.
 *
 * Example shape:
 *   { "flavour-profile": ["<uuid-strawberry>", "<uuid-lemon>"],
 *     "bottle-size":     ["<uuid-30ml>"] }
 */
export default function AutoRuleBuilder({
  attributes,
  values,
  rules,
  onChange,
}: Props) {
  const filters = rules.attribute_filters ?? {};

  const valuesByAttribute = new Map<string, AttributeValue[]>();
  for (const v of values) {
    const list = valuesByAttribute.get(v.attribute_id) ?? [];
    list.push(v);
    valuesByAttribute.set(v.attribute_id, list);
  }
  for (const list of valuesByAttribute.values()) {
    list.sort((a, b) => a.display_order - b.display_order || a.value.localeCompare(b.value));
  }

  function toggleValue(slug: string, valueId: string) {
    const current = filters[slug] ?? [];
    const next = current.includes(valueId)
      ? current.filter((v) => v !== valueId)
      : [...current, valueId];
    const updated = { ...filters };
    if (next.length === 0) {
      delete updated[slug];
    } else {
      updated[slug] = next;
    }
    onChange({ attribute_filters: updated });
  }

  const filterCount = Object.values(filters).reduce((acc, vs) => acc + vs.length, 0);

  if (attributes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Δεν έχουν οριστεί χαρακτηριστικά. Προσθέστε χαρακτηριστικά πριν δημιουργήσετε αυτόματη κατηγορία.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Επιλέξτε τις τιμές που πρέπει να έχουν τα variants. Πολλές τιμές στο ίδιο
        χαρακτηριστικό ⇒ OR. Διαφορετικά χαρακτηριστικά ⇒ AND.
      </p>
      {filterCount === 0 && (
        <p className="text-xs text-amber-600">
          Απαιτείται τουλάχιστον μία τιμή για να αποθηκευτεί η αυτόματη κατηγορία.
        </p>
      )}
      <div className="space-y-3">
        {attributes.map((attr) => {
          const attrValues = valuesByAttribute.get(attr.id) ?? [];
          const selected = filters[attr.slug] ?? [];
          if (attrValues.length === 0) return null;
          return (
            <fieldset key={attr.id} className="border rounded p-3">
              <legend className="text-sm font-medium px-1">{attr.name}</legend>
              <div className="flex flex-wrap gap-2 pt-2">
                {attrValues.map((v) => {
                  const isOn = selected.includes(v.id);
                  return (
                    <label
                      key={v.id}
                      className={`text-xs px-2 py-1 rounded border cursor-pointer ${
                        isOn ? "bg-primary text-primary-foreground border-primary" : "bg-background"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={isOn}
                        onChange={() => toggleValue(attr.slug, v.id)}
                      />
                      {v.value}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
