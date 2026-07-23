"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import Popover from "@/components/admin/offers/_Popover";
import { ConditionConfigForm, conditionKindLabel } from "./ConditionChip";
import type { RelatedProductsConditionKind } from "@/types/related-products";
import type { FilterLookups } from "./_lookups";

interface Props {
  lookups: FilterLookups;
  onSubmit: (input: {
    kind: RelatedProductsConditionKind;
    config: Record<string, unknown>;
    negate: boolean;
  }) => void;
}

const KIND_CHOICES: Array<{
  kind: RelatedProductsConditionKind;
  title: string;
  description: string;
}> = [
  {
    kind: "category",
    title: "Κατηγορία",
    description: "Το προϊόν ανήκει σε συγκεκριμένη κατηγορία",
  },
  {
    kind: "product",
    title: "Συγκεκριμένο προϊόν",
    description: "Ταυτοποίηση από ID προϊόντος",
  },
  {
    kind: "variant",
    title: "Συγκεκριμένη παραλλαγή",
    description: "Ταυτοποίηση από ID παραλλαγής",
  },
  {
    kind: "attribute_value",
    title: "Τιμή χαρακτηριστικού",
    description: "π.χ. χρώμα = μπλε",
  },
  {
    kind: "attribute_value_in",
    title: "Σύνολο τιμών",
    description: "π.χ. χρώμα ∈ {μπλε, κόκκινο, πράσινο}",
  },
  {
    kind: "attribute_present",
    title: "Έχει χαρακτηριστικό",
    description: "Το προϊόν ορίζει αυτό το χαρακτηριστικό",
  },
];

/**
 * "+ Νέο φίλτρο" affordance inside a filter group. Two stages:
 *   1. Kind picker — list of available condition kinds
 *   2. Config form — kind-specific inputs + Add button
 *
 * Stage transitions happen INSIDE the same popover so it doesn't feel
 * like multiple steps.
 */
export default function NewConditionPopover({ lookups, onSubmit }: Props) {
  return (
    <Popover
      width={360}
      trigger={
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-dashed border-foreground/30 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/60 cursor-pointer transition-colors">
          <Plus className="w-3 h-3" />
          Νέο φίλτρο
        </span>
      }
    >
      {(close) => (
        <NewConditionFlow
          lookups={lookups}
          onSubmit={(input) => {
            onSubmit(input);
            close();
          }}
          onCancel={close}
        />
      )}
    </Popover>
  );
}

function NewConditionFlow({
  lookups,
  onSubmit,
  onCancel,
}: {
  lookups: FilterLookups;
  onSubmit: (input: {
    kind: RelatedProductsConditionKind;
    config: Record<string, unknown>;
    negate: boolean;
  }) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<RelatedProductsConditionKind | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [negate, setNegate] = useState(false);

  if (!kind) {
    return (
      <div className="space-y-2">
        <h4 className="text-sm font-semibold mb-2">Επιλέξτε τύπο φίλτρου</h4>
        <div className="space-y-1">
          {KIND_CHOICES.map((c) => (
            <button
              key={c.kind}
              type="button"
              onClick={() => {
                setKind(c.kind);
                // Seed config with sensible defaults per kind.
                setConfig(defaultsForKind(c.kind));
              }}
              className="w-full text-left px-2.5 py-2 rounded hover:bg-muted transition-colors"
            >
              <div className="text-sm font-medium">{c.title}</div>
              <div className="text-xs text-muted-foreground">
                {c.description}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{conditionKindLabel(kind)}</h4>
        <button
          type="button"
          onClick={() => {
            setKind(null);
            setConfig({});
          }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Άλλος τύπος
        </button>
      </header>

      <ConditionConfigForm
        kind={kind}
        config={config}
        lookups={lookups}
        onChange={setConfig}
      />

      <label className="flex items-center gap-2 text-sm pt-2 border-t border-border">
        <input
          type="checkbox"
          checked={negate}
          onChange={(e) => setNegate(e.target.checked)}
        />
        Αντιστροφή (όχι)
      </label>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Ακύρωση
        </button>
        <button
          type="button"
          onClick={() => onSubmit({ kind, config, negate })}
          className="btn btn-primary btn-sm"
        >
          Προσθήκη
        </button>
      </div>
    </div>
  );
}

function defaultsForKind(
  kind: RelatedProductsConditionKind
): Record<string, unknown> {
  switch (kind) {
    case "category":
      return { include_descendants: true };
    case "attribute_value_in":
      return { values: [] };
    default:
      return {};
  }
}
