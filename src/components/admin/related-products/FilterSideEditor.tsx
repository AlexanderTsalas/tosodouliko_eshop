"use client";

import { Plus, X } from "lucide-react";
import ConditionChip from "./ConditionChip";
import NewConditionPopover from "./NewConditionPopover";
import type {
  RelatedProductsFilterGroupWithConditions,
  RelatedProductsSide,
  RelatedProductsConditionKind,
} from "@/types/related-products";
import type { FilterLookups } from "./_lookups";

interface Props {
  side: RelatedProductsSide;
  groups: RelatedProductsFilterGroupWithConditions[];
  lookups: FilterLookups;

  onAddGroup: () => void;
  onDeleteGroup: (group_id: string) => void;
  onAddCondition: (
    group_id: string,
    input: {
      kind: RelatedProductsConditionKind;
      config: Record<string, unknown>;
      negate: boolean;
    }
  ) => void;
  onPatchCondition: (
    condition_id: string,
    patch: Partial<{
      config: Record<string, unknown>;
      negate: boolean;
    }>
  ) => void;
  onDeleteCondition: (condition_id: string) => void;
}

/**
 * One full side of an association (source or target). Renders all
 * filter groups stacked vertically with "ή" (OR) separators between
 * them; each group is its own AND-box containing condition chips.
 */
export default function FilterSideEditor({
  side,
  groups,
  lookups,
  onAddGroup,
  onDeleteGroup,
  onAddCondition,
  onPatchCondition,
  onDeleteCondition,
}: Props) {
  // The owning sentence in the editor already says "Όταν ο πελάτης βλέπει…"
  // / "Η σελίδα του προτείνει…", so we don't re-label the side here —
  // the chips themselves are the qualifier list inside the sentence.
  return (
    <div className="space-y-2">
      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          {side === "source"
            ? "Χωρίς φίλτρα — η συσχέτιση δεν θα ενεργοποιηθεί ποτέ."
            : "Χωρίς φίλτρα — δεν θα προταθεί τίποτα."}
        </p>
      ) : (
        groups.map((g, gi) => (
          <div key={g.id}>
            {gi > 0 && (
              <div className="text-center text-[10px] uppercase tracking-wider text-muted-foreground my-1.5">
                ή
              </div>
            )}
            <FilterGroup
              group={g}
              lookups={lookups}
              onDelete={() => onDeleteGroup(g.id)}
              onAddCondition={(input) => onAddCondition(g.id, input)}
              onPatchCondition={onPatchCondition}
              onDeleteCondition={onDeleteCondition}
              canDelete={groups.length > 1}
            />
          </div>
        ))
      )}

      <button
        type="button"
        onClick={onAddGroup}
        className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-dashed border-foreground/20 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted/30 transition-colors"
      >
        <Plus className="w-3 h-3" />
        {groups.length === 0 ? "Νέα ομάδα φίλτρων" : "Νέα ομάδα (ή)"}
      </button>
    </div>
  );
}

// ─── Single filter group ────────────────────────────────────────────

function FilterGroup({
  group,
  lookups,
  onDelete,
  onAddCondition,
  onPatchCondition,
  onDeleteCondition,
  canDelete,
}: {
  group: RelatedProductsFilterGroupWithConditions;
  lookups: FilterLookups;
  onDelete: () => void;
  onAddCondition: (input: {
    kind: RelatedProductsConditionKind;
    config: Record<string, unknown>;
    negate: boolean;
  }) => void;
  onPatchCondition: (
    condition_id: string,
    patch: Partial<{
      config: Record<string, unknown>;
      negate: boolean;
    }>
  ) => void;
  onDeleteCondition: (condition_id: string) => void;
  canDelete: boolean;
}) {
  return (
    <div className="rounded-md bg-background border border-border p-2.5 relative">
      {canDelete && (
        <button
          type="button"
          onClick={() => {
            if (
              !confirm(
                group.conditions.length > 0
                  ? "Διαγραφή ομάδας με τα φίλτρα της;"
                  : "Διαγραφή ομάδας;"
              )
            )
              return;
            onDelete();
          }}
          className="absolute top-1.5 right-1.5 w-5 h-5 inline-flex items-center justify-center rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
          aria-label="Διαγραφή ομάδας"
        >
          <X className="w-3 h-3" />
        </button>
      )}

      {/* Chips read as a list of qualifiers — all in the same boxed
          group implicitly AND together. Explicit AND tokens used to
          live between chips; removed so the sentence reads naturally
          instead of like SQL. */}
      <div className="flex flex-wrap items-center gap-1.5 pr-6">
        {group.conditions.length === 0 ? (
          <span className="text-[10px] text-muted-foreground italic">
            Κενή ομάδα
          </span>
        ) : (
          group.conditions.map((c) => (
            <ConditionChip
              key={c.id}
              condition={c}
              lookups={lookups}
              onPatch={(p) => onPatchCondition(c.id, p)}
              onDelete={() => onDeleteCondition(c.id)}
            />
          ))
        )}
        <NewConditionPopover lookups={lookups} onSubmit={onAddCondition} />
      </div>
    </div>
  );
}
