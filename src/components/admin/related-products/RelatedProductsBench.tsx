"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Plus,
  FlaskConical,
  ChevronDown,
  ArrowRight,
  Trash2,
} from "lucide-react";
import {
  createRelatedProductsAssociation,
  updateRelatedProductsAssociation,
  deleteRelatedProductsAssociation,
} from "@/actions/related-products";
import WorkshopToggle from "@/components/admin/common/WorkshopToggle";
import AssociationEditor from "./AssociationEditor";
import DebugResolverDrawer from "./DebugResolverDrawer";
import {
  summarizeCondition,
  chipAccent,
} from "./ConditionChip";
import type { FilterLookups } from "./_lookups";
import type {
  RelatedProductsAssociationFull,
  RelatedProductsFilterGroupWithConditions,
} from "@/types/related-products";

interface Props {
  associations: RelatedProductsAssociationFull[];
  categories: FilterLookups["categories"];
  products: FilterLookups["products"];
  variants: FilterLookups["variants"];
  attributes: FilterLookups["attributes"];
  attributeValues: FilterLookups["attributeValues"];
}

type StateFilter = "all" | "active" | "inactive";

/**
 * Related-products workshop bench — multi-accordion.
 *
 * Every association is always rendered as an accordion item: a header
 * row that's always visible (CMS name + chip sentence + active toggle
 * + delete + chevron) and a body that expands inline to show the full
 * `AssociationEditor`. Multiple items can be expanded at once, so the
 * merchant can compare configurations side by side.
 *
 * "+ Νέα συσχέτιση" creates a blank inactive row and immediately marks
 * it expanded so the merchant lands in the editor without an extra
 * click.
 *
 * Two test entry points:
 *   - Toolbar "Τέστ Live Προτεινόμενων" button (bench-wide drawer)
 *     runs the resolver against ALL active associations for a chosen
 *     product. Same as the storefront behaviour.
 *   - Per-item panel at the bottom of each editor body runs the
 *     resolver against ONE association in isolation (active or not).
 */
export default function RelatedProductsBench({
  associations: initialAssociations,
  categories,
  products,
  variants,
  attributes,
  attributeValues,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const lookups: FilterLookups = {
    categories,
    products,
    variants,
    attributes,
    attributeValues,
  };

  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Local-state mirror so the bench can do optimistic updates for
  // toggle / delete / create. Re-syncs from props after refresh.
  const [associations, setAssociations] = useState<
    RelatedProductsAssociationFull[]
  >(initialAssociations);
  useEffect(() => setAssociations(initialAssociations), [initialAssociations]);

  // Multi-accordion: more than one item can be expanded at a time.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // `?expand=<id>` on mount → pre-expand that one. Used by the product
  // editor's "Νέα συσχέτιση από αυτό το προϊόν" flow.
  const searchParams = useSearchParams();
  useEffect(() => {
    const expand = searchParams.get("expand");
    if (!expand) return;
    if (initialAssociations.some((a) => a.id === expand)) {
      setExpandedIds((prev) => new Set(prev).add(expand));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [debugDrawerOpen, setDebugDrawerOpen] = useState(false);
  /** Sticky badge counter — number of distinct associations that
   *  produced any kind of resolver warning in this session. Reset on
   *  page reload. */
  const [warnedAssociationIds, setWarnedAssociationIds] = useState<
    Set<string>
  >(new Set());

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }
  function showError(msg: string) {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  }

  function handleToggleAssociation(id: string, next: boolean) {
    setAssociations((as) =>
      as.map((a) => (a.id === id ? { ...a, active: next } : a))
    );
    startTransition(async () => {
      const r = await updateRelatedProductsAssociation({
        id,
        active: next,
      });
      if (!r.success) {
        setAssociations((as) =>
          as.map((a) => (a.id === id ? { ...a, active: !next } : a))
        );
        return showError(r.error);
      }
      router.refresh();
    });
  }

  function handleDeleteAssociation(id: string, name: string) {
    if (
      !confirm(`Διαγραφή συσχέτισης «${name}»; Δεν επαναφέρεται.`)
    )
      return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setAssociations((as) => as.filter((a) => a.id !== id));
    startTransition(async () => {
      const r = await deleteRelatedProductsAssociation({ id });
      if (!r.success) return showError(r.error);
      router.refresh();
    });
  }

  /**
   * Create a blank inactive association at the top of the list and
   * immediately expand its accordion so the merchant can start
   * configuring without an extra click. Stays inactive until they
   * explicitly toggle it on, which gives them a chance to set source +
   * target first.
   */
  function handleCreateInline() {
    startTransition(async () => {
      const nextDisplayOrder =
        Math.max(0, ...associations.map((a) => a.display_order)) + 1;
      const r = await createRelatedProductsAssociation({
        name: "Νέα συσχέτιση",
        active: false,
        display_order: nextDisplayOrder,
      });
      if (!r.success) return showError(r.error);
      showFlash("Δημιουργήθηκε νέα συσχέτιση");
      setAssociations((as) => [
        {
          ...r.data,
          source_groups: [],
          target_groups: [],
          manual_picks: [],
        },
        ...as,
      ]);
      setExpandedIds((prev) => new Set(prev).add(r.data.id));
      router.refresh();
    });
  }

  const q = query.trim().toLowerCase();

  const filteredAssociations = useMemo(() => {
    return associations.filter((a) => {
      if (stateFilter === "active" && !a.active) return false;
      if (stateFilter === "inactive" && a.active) return false;
      if (!q) return true;
      const nameMatch = a.name.toLowerCase().includes(q);
      const titleGr = (a.message_title_translations.el ?? "").toLowerCase();
      const titleEn = (a.message_title_translations.en ?? "").toLowerCase();
      return nameMatch || titleGr.includes(q) || titleEn.includes(q);
    });
  }, [associations, q, stateFilter]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Αναζήτηση συσχετίσεων…"
            className="cms-input pl-8"
          />
        </div>
        <div className="flex items-center gap-1 text-sm">
          <FilterChip
            active={stateFilter === "all"}
            onClick={() => setStateFilter("all")}
          >
            Όλες
          </FilterChip>
          <FilterChip
            active={stateFilter === "active"}
            onClick={() => setStateFilter("active")}
          >
            Ενεργές
          </FilterChip>
          <FilterChip
            active={stateFilter === "inactive"}
            onClick={() => setStateFilter("inactive")}
          >
            Ανενεργές
          </FilterChip>
        </div>

        <button
          type="button"
          onClick={() => setDebugDrawerOpen((x) => !x)}
          className={`btn btn-sm flex items-center gap-1.5 ml-auto relative ${
            debugDrawerOpen ? "btn-primary" : "btn-secondary"
          }`}
          aria-pressed={debugDrawerOpen}
        >
          <FlaskConical className="w-4 h-4" />
          <span>Τέστ Live Προτεινόμενων</span>
          {warnedAssociationIds.size > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold tabular-nums flex items-center justify-center border border-white"
              aria-label={`${warnedAssociationIds.size} προειδοποιήσεις διαμόρφωσης`}
            >
              {warnedAssociationIds.size}
            </span>
          )}
        </button>
      </div>

      {/* Left-aligned, full-width workshop column. The page-level
          AdminPageHeader (rendered by page.tsx) carries the title +
          subtitle for this surface, so the bench itself jumps straight
          from the toolbar into the items list — no in-bench section
          header or icon. */}
      <section>
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleCreateInline}
            className="w-full min-h-[44px] rounded-lg border-2 border-dashed border-foreground/20 flex items-center justify-center gap-1.5 px-3 py-2 text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted/30 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">Νέα συσχέτιση</span>
          </button>

          {filteredAssociations.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-1 py-3">
              {q || stateFilter !== "all"
                ? "Καμία συσχέτιση δεν ταιριάζει με τα φίλτρα."
                : "Δεν υπάρχουν συσχετίσεις ακόμη."}
            </p>
          ) : (
            filteredAssociations.map((a) => (
              <AssociationAccordionItem
                key={a.id}
                association={a}
                lookups={lookups}
                products={products}
                variants={variants}
                expanded={expandedIds.has(a.id)}
                onToggleExpanded={() => toggleExpanded(a.id)}
                onToggleActive={(next) =>
                  handleToggleAssociation(a.id, next)
                }
                onDelete={() => handleDeleteAssociation(a.id, a.name)}
                onFiltersChanged={() => router.refresh()}
              />
            ))
          )}
        </div>
      </section>

      {/* Bench-wide debug drawer — runs the resolver against every
          active association for a chosen product. The per-relationship
          test panel inside each accordion handles single-association
          previews. */}
      {debugDrawerOpen && (
        <DebugResolverDrawer
          products={products}
          variants={variants}
          onClose={() => setDebugDrawerOpen(false)}
          onWarnings={(warnings) => {
            if (warnings.length === 0) return;
            setWarnedAssociationIds((prev) => {
              const next = new Set(prev);
              for (const w of warnings) next.add(w.association_id);
              return next;
            });
          }}
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

// ─── Association accordion item ─────────────────────────────────────

/**
 * One association as an accordion:
 *   - Header (always visible): CMS name + inline chip sentence preview
 *     + active toggle + delete + expand/collapse chevron
 *   - Body (only when expanded): the full <AssociationEditor>
 *
 * Clicking the header (excluding the toggle / delete / chevron) also
 * expands/collapses, so the whole top row is a hit target.
 */
function AssociationAccordionItem({
  association,
  lookups,
  products,
  variants,
  expanded,
  onToggleExpanded,
  onToggleActive,
  onDelete,
  onFiltersChanged,
}: {
  association: RelatedProductsAssociationFull;
  lookups: FilterLookups;
  products: Array<{ id: string; name: string }>;
  variants: Array<{
    id: string;
    sku: string;
    product_id: string;
    product_name: string;
  }>;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleActive: (next: boolean) => void;
  onDelete: () => void;
  onFiltersChanged: () => void;
}) {
  return (
    <article
      className={`rounded-lg border bg-muted/40 transition-shadow ${
        expanded
          ? "border-foreground/30 shadow-md"
          : "border-border shadow-sm hover:shadow-md hover:border-foreground/20"
      }`}
    >
      {/* Header — always visible. The whole row is clickable; the
          toggle and bin live INSIDE the title row and stopPropagation
          so they never accidentally collapse the accordion. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleExpanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpanded();
          }
        }}
        className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/60 rounded-t-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
        aria-expanded={expanded}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpanded();
          }}
          className="shrink-0 mt-1 text-muted-foreground hover:text-foreground"
          aria-label={expanded ? "Σύμπτυξη" : "Επέκταση"}
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ease-out ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>

        <div className="flex-1 min-w-0">
          {/* Title row: name + activation toggle + delete bin all on
              one line. The hairline separator below the title is a
              border on the <p> only, so it spans the title text width
              and stops there — not under the controls beside it. The
              controls match the title's pb-2 so items-center vertically
              aligns everything cleanly. */}
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-base font-semibold leading-tight pb-2 border-b border-border/60 truncate min-w-0">
              {association.name}
            </p>
            <span
              className="flex items-center gap-2 pb-2"
              onClick={(e) => e.stopPropagation()}
            >
              <WorkshopToggle
                active={association.active}
                onChange={onToggleActive}
                ariaLabel={`Ενεργή ${association.name}`}
              />
              <button
                type="button"
                aria-label={`Διαγραφή ${association.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-md text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </span>
          </div>

          <InlineSentencePreview
            sourceGroups={association.source_groups}
            targetGroups={association.target_groups}
            lookups={lookups}
          />
        </div>
      </div>

      {/* Body — full editor. Always rendered; expand/collapse is a
          smooth grid-rows height transition (0fr → 1fr) so the body
          slides open and the chevron rotates in sync without any
          height-measuring JavaScript. The inner div has overflow:hidden
          so content above the implicit min track is clipped during the
          animation. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
        aria-hidden={!expanded}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border p-4">
            <AssociationEditor
              association={association}
              lookups={lookups}
              products={products}
              variants={variants}
              onFiltersChanged={onFiltersChanged}
              onDeleted={onDelete}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

// ─── Inline sentence preview ─────────────────────────────────────────

/**
 * Read-only "Όταν βλέπει [chips] → προτείνει [chips]" line that lives
 * inside the always-visible accordion header. Uses the same chip
 * accent colors and condition summaries as the editor, but with no
 * popovers / delete affordances — clicking does nothing on the chips
 * themselves; the surrounding header expands the accordion to reveal
 * the editable version.
 */
function InlineSentencePreview({
  sourceGroups,
  targetGroups,
  lookups,
}: {
  sourceGroups: RelatedProductsFilterGroupWithConditions[];
  targetGroups: RelatedProductsFilterGroupWithConditions[];
  lookups: FilterLookups;
}) {
  const sourceEmpty = sourceGroups.every((g) => g.conditions.length === 0);
  const targetEmpty = targetGroups.every((g) => g.conditions.length === 0);
  // items-center on the wrapping flex aligns the chip middles with
  // the surrounding text x-height — without it the chips ride a few
  // pixels above the baseline because of their internal padding.
  return (
    <div className="mt-3 text-base text-foreground/85 flex items-center gap-2 flex-wrap leading-8">
      <span className="whitespace-nowrap">Όταν ο πελάτης βλέπει</span>
      {sourceEmpty ? (
        <span className="italic">—</span>
      ) : (
        <GroupChips groups={sourceGroups} lookups={lookups} />
      )}
      <ArrowRight className="w-4 h-4 text-muted-foreground" />
      <span className="whitespace-nowrap">Η σελίδα του προτείνει</span>
      {targetEmpty ? (
        <span className="italic">—</span>
      ) : (
        <GroupChips groups={targetGroups} lookups={lookups} />
      )}
    </div>
  );
}

function GroupChips({
  groups,
  lookups,
}: {
  groups: RelatedProductsFilterGroupWithConditions[];
  lookups: FilterLookups;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      {groups.map((g, gi) => (
        <span key={g.id} className="inline-flex items-center gap-1.5 flex-wrap">
          {gi > 0 && (
            <span className="text-xs uppercase tracking-wider text-muted-foreground/80 mx-1">
              ή
            </span>
          )}
          {g.conditions.length === 0 ? (
            <span className="italic">(κενή ομάδα)</span>
          ) : (
            g.conditions.map((c) => (
              <span
                key={c.id}
                className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${chipAccent(
                  c.kind
                )} ${c.negate ? "line-through opacity-70" : ""}`}
              >
                {summarizeCondition(c, lookups)}
              </span>
            ))
          )}
        </span>
      ))}
    </span>
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
