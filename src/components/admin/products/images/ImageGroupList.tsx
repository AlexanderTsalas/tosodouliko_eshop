"use client";

import { useMemo } from "react";
import type { ProductImage } from "@/types/products";
import type { ProductVariant } from "@/types/product-variants";
import type {
  Attribute,
  AttributeValue,
} from "@/types/attribute-facets";

/**
 * Left scrollable list of attribute-combo groups. Each entry is one
 * place an admin can attach images.
 *
 * Entries:
 *   1. "General" at the top — combo = {} (always-shown images: box
 *      shots, lifestyle, size charts)
 *   2. For each distinct attribute_combo across this product's
 *      variants restricted to the selected image-axes, one entry.
 *
 * Examples:
 *   - image_axes = ['color'] → entries: General + Red + Blue + Green + Black
 *   - image_axes = ['color','size'] → entries: General + Red×S, Red×M, Blue×S, …
 *   - image_axes = [] → entries: General only (no axes drive imagery)
 */

export type ComboKey = string; // serialized: "" for general, or sorted-keys JSON

export function comboToKey(combo: Record<string, string> | null): ComboKey {
  if (combo === null || Object.keys(combo).length === 0) return "";
  // Sort keys for stable serialization
  const sorted = Object.keys(combo).sort();
  return JSON.stringify(sorted.map((k) => [k, combo[k]]));
}

export function keyToCombo(key: ComboKey): Record<string, string> {
  if (key === "") return {};
  try {
    const entries = JSON.parse(key) as Array<[string, string]>;
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

interface GroupEntry {
  key: ComboKey;
  combo: Record<string, string>;
  label: string;
  imageCount: number;
}

export default function ImageGroupList({
  selectedAxes,
  selectedKey,
  images,
  variants,
  attributes,
  attributeValues,
  onSelect,
}: {
  selectedAxes: string[];
  selectedKey: ComboKey;
  images: ProductImage[];
  variants: ProductVariant[];
  attributes: Attribute[];
  attributeValues: AttributeValue[];
  onSelect: (key: ComboKey) => void;
}) {
  const groups = useMemo<GroupEntry[]>(() => {
    return buildGroups({
      selectedAxes,
      images,
      variants,
      attributes,
      attributeValues,
    });
  }, [selectedAxes, images, variants, attributes, attributeValues]);

  return (
    <div className="flex flex-col">
      <header className="px-4 py-3 border-b border-foreground/10 bg-muted/30">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Ομάδες εικόνων
        </h3>
        <p className="text-xs text-muted-foreground/80 mt-0.5">
          Επιλέξτε ομάδα για να προσθέσετε/επεξεργαστείτε εικόνες
        </p>
      </header>
      <nav
        aria-label="Ομάδες εικόνων"
        className="p-2 space-y-0.5 overflow-y-auto max-h-[calc(100vh-300px)]"
      >
        {groups.map((g) => {
          const isActive = g.key === selectedKey;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => onSelect(g.key)}
              className={`w-full text-left px-3 py-2.5 rounded-md transition-all text-sm flex items-center justify-between gap-2 ${
                isActive
                  ? "bg-foreground text-background font-medium shadow-sm"
                  : "hover:bg-muted/60 text-foreground/80"
              }`}
            >
              <span className="truncate">{g.label}</span>
              <span
                className={`text-xs tabular-nums px-1.5 py-0.5 rounded ${
                  isActive
                    ? "bg-background/15 text-background"
                    : g.imageCount > 0
                      ? "bg-muted/70 text-foreground/70"
                      : "text-muted-foreground/60"
                }`}
              >
                {g.imageCount}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

function buildGroups(input: {
  selectedAxes: string[];
  images: ProductImage[];
  variants: ProductVariant[];
  attributes: Attribute[];
  attributeValues: AttributeValue[];
}): GroupEntry[] {
  const { selectedAxes, images, variants, attributes, attributeValues } = input;

  // General bucket — always present at top.
  const generalImageCount = images.filter(
    (img) => !img.attribute_combo || Object.keys(img.attribute_combo).length === 0
  ).length;
  const generalEntry: GroupEntry = {
    key: "",
    combo: {},
    label: "Κοινές Φωτογραφίες (όλες οι παραλλαγές)",
    imageCount: generalImageCount,
  };

  if (selectedAxes.length === 0) {
    return [generalEntry];
  }

  // Build distinct combos restricted to selectedAxes from variants.
  const seenKeys = new Set<string>();
  const combos: Array<Record<string, string>> = [];
  for (const v of variants) {
    if (!v.attribute_combo) continue;
    const restricted: Record<string, string> = {};
    for (const axis of selectedAxes) {
      const value = v.attribute_combo[axis];
      if (value === undefined) continue;
      restricted[axis] = value;
    }
    if (Object.keys(restricted).length !== selectedAxes.length) continue;
    const key = comboToKey(restricted);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    combos.push(restricted);
  }

  // Stable order: sort by label
  const attributeBySlug = new Map(attributes.map((a) => [a.slug, a]));
  const valueLabelById = new Map(
    attributeValues.map((v) => [v.id, v.value])
  );

  const entries: GroupEntry[] = combos.map((combo) => {
    const labelParts: string[] = [];
    for (const axis of selectedAxes) {
      const attr = attributeBySlug.get(axis);
      const valueLabel = valueLabelById.get(combo[axis]) ?? "—";
      labelParts.push(attr ? `${attr.name}: ${valueLabel}` : valueLabel);
    }
    const label = labelParts.join(" · ");

    // Image count = images whose combo matches this group exactly
    const imageCount = images.filter((img) => {
      if (!img.attribute_combo) return false;
      const keys = Object.keys(img.attribute_combo);
      if (keys.length !== selectedAxes.length) return false;
      return selectedAxes.every(
        (axis) => img.attribute_combo![axis] === combo[axis]
      );
    }).length;

    return {
      key: comboToKey(combo),
      combo,
      label,
      imageCount,
    };
  });

  entries.sort((a, b) => a.label.localeCompare(b.label));
  return [generalEntry, ...entries];
}
