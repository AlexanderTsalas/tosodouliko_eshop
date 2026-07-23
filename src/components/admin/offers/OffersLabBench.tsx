"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Plus, BadgePercent, Wand2, Ticket, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  createOffer,
  createRule,
  createCode,
  assignRuleToOffer,
  attachCode,
  updateRule,
  updateOffer,
  updateCode,
  deleteRule,
  deleteOffer,
  deleteCode,
  groupRulesIntoOffer,
} from "@/actions/offers";
import RuleEditorClient from "./RuleEditorClient";
import OfferEditorClient from "./OfferEditorClient";
import Toggle from "./_Toggle";
import { CONDITION_KIND_LABELS } from "@/lib/offers/conditionLabels";
import type {
  Affiliate,
  Code,
  CodeAttachment,
  Offer,
  Rule,
  RuleAction,
  RuleCondition,
  RuleKind,
  RuleScope,
} from "@/types/offers";
import type { Category } from "@/types/category-navigation";

interface Props {
  offers: Offer[];
  rules: Rule[];
  codes: Code[];
  scopesByRule: Record<string, RuleScope[]>;
  codesByRule: Record<string, Code[]>;
  codesByOffer: Record<string, Code[]>;
  attachmentsByCode: Record<string, CodeAttachment[]>;
  conditionsByRule: Record<string, RuleCondition[]>;
  actionByRule: Record<string, RuleAction>;
  membershipsByRule: Record<string, string[]>;
  categories: Category[];
  affiliates: Affiliate[];
}

type StateFilter = "all" | "active" | "inactive";

/**
 * Lab bench overview — three card zones (offers / standalone rules /
 * codes) plus a top toolbar with search + state filter + create menu.
 *
 * Phase 1a: cards are read-only previews; no click navigation yet.
 * Phase 1b will wire each card to its dedicated editor page.
 * Phase 1c will add drag-to-assign + finished create flows.
 */
/**
 * Types attached to draggable/droppable elements via dnd-kit's `data`
 * field. The drag-end handler reads these to decide which mutation to
 * dispatch (or to ignore the drop as invalid).
 */
type DragData =
  | { kind: "rule"; id: string; name: string }
  | { kind: "code"; id: string; code: string };
type DropData =
  | { kind: "offer"; id: string }
  | { kind: "rule"; id: string }
  /** Column-level drop for rules → opens the new-offer modal with the
   *  rule pre-selected. Used by the Offers column's outer drop zone. */
  | { kind: "offer-column-new" };

export default function OffersLabBench({
  offers: initialOffers,
  rules: initialRules,
  codes: initialCodes,
  scopesByRule,
  codesByRule,
  codesByOffer,
  attachmentsByCode,
  conditionsByRule,
  actionByRule,
  membershipsByRule: initialMemberships,
  categories,
  affiliates,
}: Props) {
  const router = useRouter();
  const [_isPending, startTransition] = useTransition();
  void _isPending;

  // Memberships kept in local state so drag-drop can update the bench
  // instantly without waiting for router.refresh().
  const [membershipsByRule, setMembershipsByRule] = useState(initialMemberships);
  const [localCodesByRule, setLocalCodesByRule] = useState(codesByRule);
  const [localCodesByOffer, setLocalCodesByOffer] = useState(codesByOffer);
  // Entity lists kept in local state too so the active
  // toggle on each card can apply optimistic updates. The lists sync
  // back to props after router.refresh() via useEffect below.
  const [rules, setRules] = useState(initialRules);
  const [offers, setOffers] = useState(initialOffers);
  const [codes, setCodes] = useState(initialCodes);

  // Sync local state back to props when the server returns fresh data
  // (e.g. after router.refresh()). Without this, the bench would
  // drift from the canonical server state after the first mutation.
  useEffect(() => setRules(initialRules), [initialRules]);
  useEffect(() => setOffers(initialOffers), [initialOffers]);
  useEffect(() => setCodes(initialCodes), [initialCodes]);

  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  /** Which entity (if any) is currently morphed into its inline editor.
   *  Only one entity can be expanded at a time per the design — clicking
   *  another card auto-collapses the previous one. */
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [expandedOfferId, setExpandedOfferId] = useState<string | null>(null);

  // Closes any other expansion when a new one opens (single-expansion rule).
  function expandRule(id: string) {
    setExpandedOfferId(null);
    setExpandedRuleId(id);
  }
  function expandOffer(id: string) {
    setExpandedRuleId(null);
    setExpandedOfferId(id);
  }
  /** Multi-select state for rule grouping. Tick checkboxes
   *  on rule cards → sticky bar appears → click "Ομαδοποίηση" → modal
   *  prompts for offer name → groupRulesIntoOffer creates + assigns. */
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(
    new Set()
  );
  const [groupingModalOpen, setGroupingModalOpen] = useState(false);
  /** New-offer modal state. Carries an optional ruleId for the
   *  drag-rule-to-Offers-column path — on submit the bench creates the
   *  offer AND assigns that rule atomically via groupRulesIntoOffer. */
  const [newOfferModal, setNewOfferModal] = useState<{
    open: boolean;
    preAssignRuleId: string | null;
  }>({ open: false, preAssignRuleId: null });

  function toggleRuleSelected(id: string, next: boolean) {
    setSelectedRuleIds((prev) => {
      const cp = new Set(prev);
      if (next) cp.add(id);
      else cp.delete(id);
      return cp;
    });
  }
  function clearSelection() {
    setSelectedRuleIds(new Set());
  }

  // 8px activation distance lets cards stay clickable (Phase 1b
  // navigation) while still allowing drag. A pure click never reaches
  // the drag-end handler; an 8+ px drag suppresses the click.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  function showFlash(msg: string) {
    setFlash(msg);
    setError(null);
    setTimeout(() => setFlash(null), 2500);
  }
  function showError(msg: string) {
    setError(msg);
    setFlash(null);
    setTimeout(() => setError(null), 4000);
  }

  // Match query against name/description for offers, against name +
  // action.kind for rules, against the code text for codes.
  const q = query.toLowerCase().trim();
  const matchesQuery = (haystack: string) =>
    q.length === 0 || haystack.toLowerCase().includes(q);
  const matchesState = (active: boolean) =>
    stateFilter === "all" ||
    (stateFilter === "active" && active) ||
    (stateFilter === "inactive" && !active);

  // Standalone rules: rules with no parent offer. The lab bench shows
  // these in their own zone so they're easy to spot + drag onto an
  // offer.
  const standaloneRuleIds = useMemo(
    () =>
      new Set(rules.filter((r) => !membershipsByRule[r.id]?.length).map((r) => r.id)),
    [rules, membershipsByRule]
  );

  const filteredOffers = offers.filter(
    (o) => matchesQuery(o.name + " " + (o.description ?? "")) && matchesState(o.active)
  );
  const filteredStandaloneRules = rules.filter(
    (r) =>
      standaloneRuleIds.has(r.id) &&
      matchesQuery(r.name) &&
      matchesState(r.active)
  );
  const filteredCodes = codes.filter(
    (c) => matchesQuery(c.code) && matchesState(c.active)
  );

  // ─── Create flows ─────────────────────────────────────────────────
  // Phase 1a inline create flows. Each starts a transition and refreshes
  // the bench on success. Detailed config happens later in the entity's
  // own editor page.

  // ─── Drag-and-drop handlers ───────────────────────────────────────
  //
  // Three valid drop combinations:
  //   1. rule → offer   = assignRuleToOffer (M2M)
  //   2. code → offer   = attachCode(target_kind='offer')
  //   3. code → rule    = attachCode(target_kind='rule')
  //
  // Anything else is silently ignored (active.data.kind === over.data.kind
  // for "rule onto rule", etc.). We still surface a flash on success/fail.

  function handleDragStart(e: DragStartEvent) {
    setActiveDrag((e.active.data.current as DragData | undefined) ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDrag(null);
    const drag = e.active.data.current as DragData | undefined;
    const drop = e.over?.data.current as DropData | undefined;
    if (!drag || !drop) return;

    // rule → Offers column (empty area) — open new-offer modal with
    // this rule pre-selected. Card-level drops take priority because
    // those drop zones are smaller; this only fires when the user
    // released over the column itself, outside any card.
    if (drag.kind === "rule" && drop.kind === "offer-column-new") {
      setNewOfferModal({ open: true, preAssignRuleId: drag.id });
      return;
    }

    // rule → offer
    if (drag.kind === "rule" && drop.kind === "offer") {
      // Optimistic: mark rule as a member of offer.
      const ruleId = drag.id;
      const offerId = drop.id;
      if (membershipsByRule[ruleId]?.includes(offerId)) {
        showFlash(`«${drag.name}» είναι ήδη σε αυτή την προσφορά`);
        return;
      }
      setMembershipsByRule((m) => ({
        ...m,
        [ruleId]: Array.from(new Set([...(m[ruleId] ?? []), offerId])),
      }));
      startTransition(async () => {
        const r = await assignRuleToOffer({ rule_id: ruleId, offer_id: offerId });
        if (!r.success) {
          // Revert
          setMembershipsByRule((m) => ({
            ...m,
            [ruleId]: (m[ruleId] ?? []).filter((id) => id !== offerId),
          }));
          return showError(r.error);
        }
        const offer = offers.find((o) => o.id === offerId);
        showFlash(`«${drag.name}» μπήκε στην «${offer?.name}»`);
        router.refresh();
      });
      return;
    }

    // code → offer
    if (drag.kind === "code" && drop.kind === "offer") {
      const code = codes.find((c) => c.id === drag.id);
      const offer = offers.find((o) => o.id === drop.id);
      if (!code || !offer) return;
      if (localCodesByOffer[offer.id]?.some((c) => c.id === code.id)) {
        showFlash(`Ο κωδικός «${code.code}» είναι ήδη συνδεδεμένος`);
        return;
      }
      setLocalCodesByOffer((m) => ({
        ...m,
        [offer.id]: [...(m[offer.id] ?? []), code],
      }));
      startTransition(async () => {
        const r = await attachCode({
          code_id: code.id,
          target_kind: "offer",
          target_id: offer.id,
        });
        if (!r.success) {
          setLocalCodesByOffer((m) => ({
            ...m,
            [offer.id]: (m[offer.id] ?? []).filter((c) => c.id !== code.id),
          }));
          return showError(r.error);
        }
        showFlash(`«${code.code}» συνδέθηκε με «${offer.name}»`);
        router.refresh();
      });
      return;
    }

    // code → rule
    if (drag.kind === "code" && drop.kind === "rule") {
      const code = codes.find((c) => c.id === drag.id);
      const rule = rules.find((r) => r.id === drop.id);
      if (!code || !rule) return;
      if (localCodesByRule[rule.id]?.some((c) => c.id === code.id)) {
        showFlash(`Ο κωδικός «${code.code}» είναι ήδη συνδεδεμένος`);
        return;
      }
      setLocalCodesByRule((m) => ({
        ...m,
        [rule.id]: [...(m[rule.id] ?? []), code],
      }));
      startTransition(async () => {
        const r = await attachCode({
          code_id: code.id,
          target_kind: "rule",
          target_id: rule.id,
        });
        if (!r.success) {
          setLocalCodesByRule((m) => ({
            ...m,
            [rule.id]: (m[rule.id] ?? []).filter((c) => c.id !== code.id),
          }));
          return showError(r.error);
        }
        showFlash(`«${code.code}» συνδέθηκε με «${rule.name}»`);
        router.refresh();
      });
      return;
    }
  }

  // Creation handlers: values come from modal forms.
  // No auto-expansion after create — keeps the layout stable. The
  // new card just appears in its column; click to edit further.
  function handleCreateOffer(
    name: string,
    description: string | null,
    active: boolean,
    preAssignRuleId: string | null
  ) {
    startTransition(async () => {
      if (preAssignRuleId) {
        // Atomic create-and-assign via the existing grouping action —
        // saves a round-trip and avoids the partial-failure window.
        const r = await groupRulesIntoOffer({
          mode: "new",
          rule_ids: [preAssignRuleId],
          name,
          description,
          active,
        });
        if (!r.success) return showError(r.error);
        showFlash(`Δημιουργήθηκε «${r.data.offer.name}» με 1 κανόνα`);
        setOffers((os) => [r.data.offer, ...os]);
        setMembershipsByRule((m) => {
          const next = { ...m };
          const list = new Set(next[preAssignRuleId] ?? []);
          list.add(r.data.offer.id);
          next[preAssignRuleId] = Array.from(list);
          return next;
        });
        router.refresh();
        return;
      }
      const r = await createOffer({ name, description, active });
      if (!r.success) return showError(r.error);
      showFlash(`Δημιουργήθηκε «${r.data.name}»`);
      setOffers((os) => [r.data, ...os]);
      router.refresh();
    });
  }
  function handleCreateRule(kind: RuleKind, customName: string) {
    const defaults = defaultActionFor(kind);
    const finalName = customName || defaults.name;
    startTransition(async () => {
      const r = await createRule({
        name: finalName,
        action: { kind, config: defaults.config },
        scopes: [{ scope_kind: "all" }],
        offer_ids: [],
      });
      if (!r.success) return showError(r.error);
      showFlash(`Δημιουργήθηκε «${r.data.name}»`);
      router.refresh();
    });
  }
  function handleCreateCode(code: string) {
    if (!code.trim()) return;
    startTransition(async () => {
      const r = await createCode({ code: code.trim().toUpperCase() });
      if (!r.success) return showError(r.error);
      showFlash(`Δημιουργήθηκε «${r.data.code}»`);
      router.refresh();
    });
  }

  // ─── Active toggle handlers ───────────────────────────────────────
  // Optimistic update: flip the entity's active flag locally first,
  // then call the server. Revert on failure. router.refresh() pulls
  // fresh data on success — the useEffect sync above reconciles it.

  function handleToggleRule(id: string, next: boolean) {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, active: next } : r)));
    startTransition(async () => {
      const r = await updateRule({ id, active: next });
      if (!r.success) {
        setRules((rs) =>
          rs.map((r2) => (r2.id === id ? { ...r2, active: !next } : r2))
        );
        return showError(r.error);
      }
      router.refresh();
    });
  }
  function handleToggleOffer(id: string, next: boolean) {
    setOffers((os) => os.map((o) => (o.id === id ? { ...o, active: next } : o)));
    startTransition(async () => {
      const r = await updateOffer({ id, active: next });
      if (!r.success) {
        setOffers((os) =>
          os.map((o) => (o.id === id ? { ...o, active: !next } : o))
        );
        return showError(r.error);
      }
      router.refresh();
    });
  }
  function handleToggleCode(id: string, next: boolean) {
    setCodes((cs) => cs.map((c) => (c.id === id ? { ...c, active: next } : c)));
    startTransition(async () => {
      const r = await updateCode({ id, active: next });
      if (!r.success) {
        setCodes((cs) =>
          cs.map((c) => (c.id === id ? { ...c, active: !next } : c))
        );
        return showError(r.error);
      }
      router.refresh();
    });
  }

  // ─── Delete handlers ───────────────────────────────────
  // Confirmed deletes via the bin icon on each card. If the card
  // happens to be expanded, the expansion auto-collapses.
  function handleDeleteRule(id: string, name: string) {
    if (!confirm(`Διαγραφή κανόνα «${name}»; Δεν επαναφέρεται.`)) return;
    if (expandedRuleId === id) setExpandedRuleId(null);
    setRules((rs) => rs.filter((r) => r.id !== id));
    startTransition(async () => {
      const r = await deleteRule({ id });
      if (!r.success) return showError(r.error);
      router.refresh();
    });
  }
  function handleDeleteOffer(id: string, name: string) {
    if (
      !confirm(
        `Διαγραφή προσφοράς «${name}»; Οι κανόνες της παραμένουν — γίνονται αυτοτελείς.`
      )
    )
      return;
    if (expandedOfferId === id) setExpandedOfferId(null);
    setOffers((os) => os.filter((o) => o.id !== id));
    startTransition(async () => {
      const r = await deleteOffer({ id });
      if (!r.success) return showError(r.error);
      router.refresh();
    });
  }
  function handleBulkDeleteSelected() {
    const ids = Array.from(selectedRuleIds);
    if (ids.length === 0) return;
    if (
      !confirm(
        `Διαγραφή ${ids.length} ${ids.length === 1 ? "κανόνα" : "κανόνων"}; Δεν επαναφέρονται.`
      )
    )
      return;
    // Optimistically drop them from the visible list + clear selection.
    setRules((rs) => rs.filter((r) => !selectedRuleIds.has(r.id)));
    if (expandedRuleId && selectedRuleIds.has(expandedRuleId)) {
      setExpandedRuleId(null);
    }
    clearSelection();
    startTransition(async () => {
      // Run in parallel; first failure flashes the error.
      const results = await Promise.all(
        ids.map((id) => deleteRule({ id }))
      );
      const firstFail = results.find((r) => !r.success);
      if (firstFail && !firstFail.success) showError(firstFail.error);
      else showFlash(`Διαγράφηκαν ${ids.length} κανόνες`);
      router.refresh();
    });
  }
  function handleDeleteCode(id: string, codeText: string) {
    if (
      !confirm(
        `Διαγραφή κωδικού «${codeText}»; Όλες οι συνδέσεις του διαγράφονται επίσης.`
      )
    )
      return;
    setCodes((cs) => cs.filter((c) => c.id !== id));
    startTransition(async () => {
      const r = await deleteCode({ id });
      if (!r.success) return showError(r.error);
      router.refresh();
    });
  }

  // ─── Grouping ───────────────────────────────────────────
  function handleGroupSelected(
    name: string,
    description: string | null,
    active: boolean
  ) {
    const ids = Array.from(selectedRuleIds);
    if (ids.length === 0) return;
    startTransition(async () => {
      const r = await groupRulesIntoOffer({
        mode: "new",
        rule_ids: ids,
        name,
        description,
        active,
      });
      if (!r.success) return showError(r.error);
      showFlash(`Δημιουργήθηκε «${r.data.offer.name}» με ${ids.length} κανόνες`);
      // Optimistically reflect the new offer + new memberships.
      setOffers((os) => [r.data.offer, ...os]);
      setMembershipsByRule((m) => {
        const next = { ...m };
        for (const ruleId of ids) {
          const list = new Set(next[ruleId] ?? []);
          list.add(r.data.offer.id);
          next[ruleId] = Array.from(list);
        }
        return next;
      });
      clearSelection();
      setGroupingModalOpen(false);
      router.refresh();
    });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
    <div className="space-y-6">
      {/* ─── Toolbar ─── */}
      <div className="flex flex-wrap items-center gap-3 sticky top-0 z-10 bg-background py-2 -mx-2 px-2 border-b border-border">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Αναζήτηση σε προσφορές, κανόνες, κωδικούς…"
            className="cms-input pl-8"
          />
        </div>
        <div className="flex gap-0.5 border border-border rounded-md p-0.5 text-sm">
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
        {/* Toolbar's "+ Νέο" dropdown removed — each column now has
            its own dedicated dashed-card create affordance. */}
      </div>

      {/* Expanded editor renders full-width ABOVE the 3-column grid
          when any rule/offer is expanded. Closing returns to the
          3-column view. This is full-width because the sentence
          editor needs more space than a single column provides. */}
      {/* Rule + offer editors live in a centered modal (large, scrollable)
          instead of sitting inline above the workshop grid — the
          inline pattern was visually disruptive (the editor is too
          large; it pushed everything else off-screen). The modal
          shell stays consistent with every other CRUD flow on the
          bench. The Δοκιμή drawer (which is its own right-side
          overlay) still works on top of the modal. */}
      {expandedRuleId &&
        (() => {
          const r = rules.find((x) => x.id === expandedRuleId);
          if (!r) return null;
          return (
            <EditorModal onClose={() => setExpandedRuleId(null)}>
              <RuleEditorClient
                rule={r}
                action={actionByRule[r.id] ?? null}
                scopes={scopesByRule[r.id] ?? []}
                codes={codesByRule[r.id] ?? []}
                conditions={conditionsByRule[r.id] ?? []}
                memberships={membershipsByRule[r.id] ?? []}
                allOffers={offers}
                categories={categories}
                affiliates={affiliates}
                onClose={() => setExpandedRuleId(null)}
                onDeleted={() => setExpandedRuleId(null)}
              />
            </EditorModal>
          );
        })()}
      {expandedOfferId &&
        (() => {
          const o = offers.find((x) => x.id === expandedOfferId);
          if (!o) return null;
          const memberRuleIds = Object.entries(membershipsByRule)
            .filter(([, offerIds]) => offerIds.includes(o.id))
            .map(([ruleId]) => ruleId);
          const attachedCodes = localCodesByOffer[o.id] ?? [];
          const detachedCodes = codes.filter(
            (c) => !attachedCodes.some((a) => a.id === c.id)
          );
          return (
            <EditorModal onClose={() => setExpandedOfferId(null)}>
              <OfferEditorClient
                offer={o}
                allRules={rules}
                memberRuleIds={memberRuleIds}
                attachedCodes={attachedCodes}
                detachedCodes={detachedCodes}
                affiliates={affiliates}
                onClose={() => setExpandedOfferId(null)}
                onDeleted={() => setExpandedOfferId(null)}
                onOpenRule={(id) => expandRule(id)}
              />
            </EditorModal>
          );
        })()}

      {/* 3-column workshop grid — left-to-right: Offers, Rules, Codes.
          On smaller screens collapses to a single column. Items sit
          directly on the page background; vertical separators between
          columns come from `divide-x`. `min-h` so the separators
          extend a generous distance even when columns are sparse. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 lg:divide-x-2 divide-foreground/15 min-h-[calc(100vh-220px)]">
        {/* ─── Offers column (left) ─── */}
        <Column
          title="Προσφορές"
          icon={BadgePercent}
          accent="emerald"
          count={filteredOffers.length}
          helperText="Ομάδες κανόνων — ενεργοποιούνται/απενεργοποιούνται μαζί."
        >
          <OffersDropZone isRuleDragActive={activeDrag?.kind === "rule"}>
            <CardStack>
              <NewOfferCard
                onOpen={() =>
                  setNewOfferModal({ open: true, preAssignRuleId: null })
                }
              />
              {filteredOffers.map((o) => (
                <OfferCard
                  key={o.id}
                  offer={o}
                  memberRules={rules.filter((r) =>
                    membershipsByRule[r.id]?.includes(o.id)
                  )}
                  attachedCodes={localCodesByOffer[o.id] ?? []}
                  onSelect={() => expandOffer(o.id)}
                  onToggleActive={(next) => handleToggleOffer(o.id, next)}
                  onDelete={() => handleDeleteOffer(o.id, o.name)}
                />
              ))}
            </CardStack>
          </OffersDropZone>
          {query && filteredOffers.length === 0 && (
            <p className="text-xs text-muted-foreground italic mt-2">
              Καμία προσφορά δεν ταιριάζει με τα φίλτρα.
            </p>
          )}
        </Column>

        {/* ─── Rules column (middle) ─── */}
        <Column
          title="Αυτοτελείς κανόνες"
          icon={Wand2}
          accent="sky"
          count={filteredStandaloneRules.length}
          helperText="Κανόνες χωρίς γονική προσφορά — εφαρμόζονται μόνοι τους."
        >
          <CardStack>
            <NewRuleCard onSubmit={handleCreateRule} />
            {filteredStandaloneRules.map((r) => (
              <RuleCard
                key={r.id}
                rule={r}
                action={actionByRule[r.id] ?? null}
                conditions={conditionsByRule[r.id] ?? []}
                attachedCodes={localCodesByRule[r.id] ?? []}
                onSelect={() => expandRule(r.id)}
                onToggleActive={(next) => handleToggleRule(r.id, next)}
                selected={selectedRuleIds.has(r.id)}
                onToggleSelect={(next) => toggleRuleSelected(r.id, next)}
                onDelete={() => handleDeleteRule(r.id, r.name)}
              />
            ))}
          </CardStack>
          {query && filteredStandaloneRules.length === 0 && (
            <p className="text-xs text-muted-foreground italic mt-2">
              Κανείς αυτοτελής κανόνας δεν ταιριάζει με τα φίλτρα.
            </p>
          )}
        </Column>

        {/* ─── Codes column (right) ─── */}
        <Column
          title="Κωδικοί"
          icon={Ticket}
          accent="purple"
          count={filteredCodes.length}
          helperText="Συνδέονται με κανόνες ή προσφορές για κατά παραγγελία ενεργοποίηση."
        >
          <CardStack>
            <NewCodeCard onSubmit={handleCreateCode} />
            {filteredCodes.map((c) => (
              <CodeCardItem
                key={c.id}
                code={c}
                attachments={attachmentsByCode[c.id] ?? []}
                rulesById={Object.fromEntries(rules.map((r) => [r.id, r]))}
                offersById={Object.fromEntries(offers.map((o) => [o.id, o]))}
                onToggleActive={(next) => handleToggleCode(c.id, next)}
                onDelete={() => handleDeleteCode(c.id, c.code)}
              />
            ))}
          </CardStack>
          {query && filteredCodes.length === 0 && (
            <p className="text-xs text-muted-foreground italic mt-2">
              Κανένας κωδικός δεν ταιριάζει με τα φίλτρα.
            </p>
          )}
        </Column>
      </div>

      {/* Sticky grouping bar — appears when ≥1 rule card is ticked.
          Bottom-centered, above the flash pills. Shows count + action
          buttons. Clearing or grouping dismisses it. */}
      {selectedRuleIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 bg-foreground text-background rounded-full shadow-xl flex items-center gap-2 pl-4 pr-2 py-1.5">
          <span className="text-sm font-medium">
            {selectedRuleIds.size}{" "}
            {selectedRuleIds.size === 1 ? "επιλεγμένος" : "επιλεγμένοι"}{" "}
            {selectedRuleIds.size === 1 ? "κανόνας" : "κανόνες"}
          </span>
          <span className="w-px h-5 bg-background/30 mx-1" aria-hidden />
          <button
            type="button"
            onClick={() => setGroupingModalOpen(true)}
            className="text-sm font-semibold px-3 py-1 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
          >
            Ομαδοποίηση σε προσφορά
          </button>
          <button
            type="button"
            onClick={handleBulkDeleteSelected}
            className="text-sm font-semibold px-3 py-1 rounded-full bg-destructive hover:bg-destructive/90 text-white transition-colors flex items-center gap-1.5"
            aria-label="Διαγραφή επιλεγμένων"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Διαγραφή
          </button>
          <button
            type="button"
            onClick={clearSelection}
            aria-label="Ακύρωση επιλογής"
            className="text-sm font-medium w-7 h-7 rounded-full hover:bg-background/15 transition-colors flex items-center justify-center"
          >
            ✕
          </button>
        </div>
      )}

      {/* Grouping modal — triggered by the sticky bar's CTA */}
      {groupingModalOpen && (
        <GroupingModal
          ruleCount={selectedRuleIds.size}
          onCancel={() => setGroupingModalOpen(false)}
          onSubmit={handleGroupSelected}
        />
      )}

      {/* New-offer modal — same component opens from the dashed
          button (no pre-assigned rule) OR from drag-dropping a rule
          onto the Offers column (preAssignRuleId set). */}
      {newOfferModal.open && (
        <NewOfferModal
          preAssignRule={
            newOfferModal.preAssignRuleId
              ? rules.find((r) => r.id === newOfferModal.preAssignRuleId)
              : undefined
          }
          onCancel={() =>
            setNewOfferModal({ open: false, preAssignRuleId: null })
          }
          onSubmit={(name, description, active, preAssignRuleId) => {
            handleCreateOffer(name, description, active, preAssignRuleId);
            setNewOfferModal({ open: false, preAssignRuleId: null });
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

    {/* Drag preview: a floating clone of the dragged card follows the
        cursor while drag is active. Bench cards stay in place (no
        layout shift). Closes when drag ends. */}
    <DragOverlay dropAnimation={null}>
      {activeDrag ? (
        <div className="rounded-lg border border-foreground/40 bg-card p-3.5 shadow-2xl ring-2 ring-foreground/30 max-w-[280px] cursor-grabbing">
          {activeDrag.kind === "rule" ? (
            <div className="text-sm font-semibold">{activeDrag.name}</div>
          ) : (
            <code className="font-mono text-sm font-semibold">
              {activeDrag.code}
            </code>
          )}
        </div>
      ) : null}
    </DragOverlay>
    </DndContext>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

/**
 * A workshop column — three side-by-side workareas (Offers / Rules /
 * Codes). No container background; items sit directly on the page
 * background. Vertical separators between columns come from the
 * grid's `divide-x` utility. Each column has a colored icon-badged
 * header followed by a thin separator, then its items.
 */
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
  /** Tailwind color used for the icon badge — the only color
   *  accent the column carries now (containers are gone). */
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

/**
 * Vertical stack of items inside a column (replaces the old CardGrid
 * which was a multi-column grid).
 */
function CardStack({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}

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
      className={`px-2.5 py-1 rounded-sm transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Card components ────────────────────────────────────────────────

/**
 * Subtle bin-icon button placed on each card next to the active
 * toggle. Stops click propagation so it never triggers card
 * expansion. The confirm dialog lives in the parent handler.
 */
function BinButton({
  onClick,
  ariaLabel,
}: {
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${
        active ? "bg-emerald-500" : "bg-muted-foreground/30"
      }`}
      aria-hidden
    />
  );
}

function CardShell({
  children,
  href,
  onClick,
}: {
  children: ReactNode;
  /** Routes that still navigate via Link (legacy — being removed in
   *  Phase 4f as inline editing replaces page-based editing). */
  href?: string;
  /** Inline-expansion handler (Phase 4a+). Clicking the card morphs
   *  it into the inline editor on the bench. */
  onClick?: () => void;
}) {
  // Subtly darker than the page background so cards stand out from
  // the new containerless column layout. `bg-muted/40` tints the card
  // body just enough without competing with selected/drop-over rings.
  const className =
    "relative block rounded-lg border border-border bg-muted/40 p-3.5 shadow-sm hover:shadow-md hover:border-foreground/25 transition-all text-left";
  if (onClick) {
    // Use a role=button div instead of <button> to allow nesting
    // interactive controls inside the card (e.g. the iOS-style active
    // toggle in Phase 4c). Buttons can't legally contain buttons.
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={`${className} w-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40`}
      >
        {children}
      </div>
    );
  }
  if (href) {
    return (
      <Link href={href} className={`${className} cursor-pointer`}>
        {children}
      </Link>
    );
  }
  return <article className={`${className} cursor-default`}>{children}</article>;
}

function OfferCard({
  offer,
  memberRules,
  attachedCodes,
  onSelect,
  onToggleActive,
  onDelete,
}: {
  offer: Offer;
  memberRules: Rule[];
  attachedCodes: Code[];
  /** Called on card click → bench expands this offer into the inline
   *  editor. */
  onSelect: () => void;
  /** Called when the active toggle is flipped. */
  onToggleActive: (next: boolean) => void;
  /** Bin-icon delete. */
  onDelete: () => void;
}) {
  const previewRules = memberRules.slice(0, 3);
  const moreCount = memberRules.length - previewRules.length;

  // Drop target: accepts rule and code drops.
  const { isOver, setNodeRef } = useDroppable({
    id: `offer:${offer.id}`,
    data: { kind: "offer", id: offer.id } as DropData,
  });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg transition-shadow ${
        isOver ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background" : ""
      }`}
    >
    <CardShell onClick={onSelect}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate">{offer.name}</h3>
          {offer.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
              {offer.description}
            </p>
          )}
        </div>
        <Toggle
          active={offer.active}
          onChange={onToggleActive}
          ariaLabel={`Ενεργοποίηση προσφοράς ${offer.name}`}
        />
        <BinButton
          onClick={onDelete}
          ariaLabel={`Διαγραφή προσφοράς ${offer.name}`}
        />
      </div>

      <div className="mt-3 pt-3 border-t border-border space-y-1">
        {previewRules.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Κενή προσφορά
          </p>
        ) : (
          previewRules.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-1.5 text-xs"
              title={r.name}
            >
              <StatusDot active={r.active} />
              <span className="truncate">{r.name}</span>
            </div>
          ))
        )}
        {moreCount > 0 && (
          <p className="text-[11px] text-muted-foreground italic">
            + {moreCount} ακόμη
          </p>
        )}
      </div>

      {attachedCodes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {attachedCodes.slice(0, 3).map((c) => (
            <span
              key={c.id}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
            >
              {c.code}
            </span>
          ))}
          {attachedCodes.length > 3 && (
            <span className="text-[10px] text-muted-foreground">
              +{attachedCodes.length - 3}
            </span>
          )}
        </div>
      )}
    </CardShell>
    </div>
  );
}

function RuleCard({
  rule,
  action,
  conditions,
  attachedCodes,
  onSelect,
  onToggleActive,
  selected,
  onToggleSelect,
  onDelete,
}: {
  rule: Rule;
  action: RuleAction | null;
  conditions: RuleCondition[];
  attachedCodes: Code[];
  /** Called on card click → bench should expand this rule into the
   *  inline editor. */
  onSelect: () => void;
  /** Called when the active toggle is flipped. */
  onToggleActive: (next: boolean) => void;
  /** Multi-select state for grouping into offers. */
  selected: boolean;
  onToggleSelect: (next: boolean) => void;
  /** Bin-icon delete. Parent shows the confirm prompt. */
  onDelete: () => void;
}) {
  // Drag source: standalone rule that can be dropped onto an offer.
  const drag = useDraggable({
    id: `rule:${rule.id}`,
    data: { kind: "rule", id: rule.id, name: rule.name } as DragData,
  });
  // Drop target: accepts code drops to attach a code to this rule.
  const drop = useDroppable({
    id: `rule-drop:${rule.id}`,
    data: { kind: "rule", id: rule.id } as DropData,
  });

  const setRefs = (el: HTMLElement | null) => {
    drag.setNodeRef(el);
    drop.setNodeRef(el);
  };

  return (
    <div
      ref={setRefs}
      {...drag.attributes}
      {...drag.listeners}
      className={`rounded-lg transition ${
        drop.isOver
          ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background"
          : selected
            ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-background"
            : ""
      } ${drag.isDragging ? "opacity-40" : ""}`}
      style={{ touchAction: "none" }}
    >
    <CardShell onClick={onSelect}>
      <div className="flex items-start gap-2">
        {/* Multi-select checkbox — stops click propagation so it
            doesn't expand the card. Visible always; styles deeper
            when checked for at-a-glance scanning. */}
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelect(e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Επιλογή κανόνα ${rule.name} για ομαδοποίηση`}
          className="mt-1 w-4 h-4 rounded border-foreground/30 text-emerald-500 focus:ring-0 cursor-pointer shrink-0 accent-emerald-500"
        />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate">{rule.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {actionSummary(action)}
          </p>
        </div>
        <Toggle
          active={rule.active}
          onChange={onToggleActive}
          ariaLabel={`Ενεργοποίηση κανόνα ${rule.name}`}
        />
        <BinButton
          onClick={onDelete}
          ariaLabel={`Διαγραφή κανόνα ${rule.name}`}
        />
      </div>

      {conditions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {conditions.slice(0, 4).map((c) => (
            <span
              key={c.id}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/80"
            >
              {CONDITION_KIND_LABELS[c.kind]}
            </span>
          ))}
          {conditions.length > 4 && (
            <span className="text-[10px] text-muted-foreground">
              +{conditions.length - 4}
            </span>
          )}
        </div>
      )}

      {attachedCodes.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border flex flex-wrap gap-1">
          {attachedCodes.slice(0, 3).map((c) => (
            <span
              key={c.id}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
            >
              {c.code}
            </span>
          ))}
          {attachedCodes.length > 3 && (
            <span className="text-[10px] text-muted-foreground">
              +{attachedCodes.length - 3}
            </span>
          )}
        </div>
      )}
    </CardShell>
    </div>
  );
}

/**
 * Dashed-border placeholder card that opens a kind-picker popover and
 * creates a new rule on selection. Lives as the last item in the
 * Κανόνες grid — same visual footprint as a real rule card so the
 * "next rule goes here" affordance is unambiguous.
 *
 * After the rule is created, the bench auto-expands it into the
 * inline editor (via handleCreateRule setting expandedRuleId).
 */
/**
 * Modal for naming a new offer when grouping selected rules. Opened
 * from the sticky bottom bar. Submits via the parent's
 * onSubmit (which calls groupRulesIntoOffer + clears selection).
 */
/**
 * Centered overlay modal shell — backdrop click + ESC dismiss + a
 * standard header/body/footer layout. Used by every "+ Νέο…"
 * creation flow (rule / offer / code / grouping) so they all feel
 * the same.
 */
/**
 * Large modal shell wrapping the rule + offer inline editors. Unlike
 * `CenteredModal` below (which is form-shaped — header/body/footer),
 * `EditorModal` is just a tall scrollable container — the editor
 * supplies its own header (with Close + Δοκιμή + delete) and renders
 * its own sections. Click outside / ESC dismisses; the close button
 * inside the editor calls the same `onClose`.
 */
function EditorModal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 bg-foreground/40 flex items-start justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-background rounded-xl shadow-2xl w-full max-w-4xl my-8 p-6"
      >
        {children}
      </div>
    </div>
  );
}

function CenteredModal({
  title,
  subtitle,
  onCancel,
  children,
  footer,
  maxWidth = "max-w-md",
}: {
  title: string;
  subtitle?: string;
  onCancel: () => void;
  children: ReactNode;
  footer: ReactNode;
  maxWidth?: string;
}) {
  // ESC to dismiss. Runs once per mount; the modal unmounts when the
  // parent removes it, so no further teardown needed beyond cleanup.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-background rounded-lg shadow-2xl ${maxWidth} w-full p-5 space-y-4`}
      >
        <header>
          <h3 className="text-base font-semibold">{title}</h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </header>
        <div className="space-y-3">{children}</div>
        <footer className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          {footer}
        </footer>
      </div>
    </div>
  );
}

function GroupingModal({
  ruleCount,
  onCancel,
  onSubmit,
}: {
  ruleCount: number;
  onCancel: () => void;
  onSubmit: (name: string, description: string | null, active: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);

  function handleSubmit() {
    if (!name.trim()) return;
    onSubmit(name.trim(), description.trim() || null, active);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-background rounded-lg shadow-2xl max-w-md w-full p-5 space-y-4"
      >
        <header>
          <h3 className="text-base font-semibold">
            Νέα προσφορά από {ruleCount}{" "}
            {ruleCount === 1 ? "κανόνα" : "κανόνες"}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Οι επιλεγμένοι κανόνες θα ενεργοποιούνται/απενεργοποιούνται μαζί
            μέσω της προσφοράς.
          </p>
        </header>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">
              Όνομα προσφοράς
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="π.χ. Black Friday 2025"
              maxLength={200}
              autoFocus
              className="cms-input"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">
              Περιγραφή (προαιρετική)
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={2000}
              className="cms-input"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Ενεργή αμέσως
          </label>
        </div>

        <footer className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-secondary btn-sm"
          >
            Ακύρωση
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="btn btn-primary btn-sm"
          >
            Δημιουργία
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Dashed-border placeholder for creating an empty offer. Click →
 * createOffer with default name "Νέα προσφορά" + auto-expands the new
 * offer into the inline editor. The admin then renames it, assigns
 * rules, and attaches codes — all inline.
 *
 * Simpler than NewRuleCard (no kind picker — offers have no
 * action shape) so it's just a single-click affordance.
 */
/**
 * Dashed-border placeholder for creating a new code. Click prompts
 * for the code text (since codes are short identifiers — no inline
 * editor needed at the create step).
 */
/**
 * Compact dashed "+ Νέο…" button — used as the first item in every
 * workshop column. ~44px tall — small enough not to dominate the
 * column visually. Click opens a centered creation modal; the
 * created entity appears in the column. No more inline expansion
 * on create (which would push everything down).
 */
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

function NewCodeCard({
  onSubmit,
}: {
  onSubmit: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return (
    <>
      <DashedAddButton
        label="Νέος κωδικός"
        onClick={() => {
          setText("");
          setOpen(true);
        }}
      />
      {open && (
        <CenteredModal
          title="Νέος κωδικός"
          subtitle="Δημιουργήστε τον κωδικό. Συνδέεται με κανόνα ή προσφορά αργότερα."
          onCancel={() => setOpen(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn btn-secondary btn-sm"
              >
                Ακύρωση
              </button>
              <button
                type="button"
                disabled={!text.trim()}
                onClick={() => {
                  onSubmit(text.trim().toUpperCase());
                  setOpen(false);
                }}
                className="btn btn-primary btn-sm"
              >
                Δημιουργία
              </button>
            </>
          }
        >
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">
              Κωδικός
            </span>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value.toUpperCase())}
              placeholder="π.χ. SAVE10"
              maxLength={64}
              autoFocus
              className="cms-input font-mono"
            />
          </label>
        </CenteredModal>
      )}
    </>
  );
}

/**
 * Outer drop zone wrapping the Offers column's items. Accepts a rule
 * drop and signals the bench to open the new-offer modal pre-filled
 * with that rule. Visual hint (emerald tint) shows only when a rule
 * is actively being dragged.
 *
 * Nested OfferCard drop zones still win for hover targeting (they're
 * smaller); the bench's dispatch checks card-first to be safe.
 */
function OffersDropZone({
  isRuleDragActive,
  children,
}: {
  isRuleDragActive: boolean;
  children: ReactNode;
}) {
  const drop = useDroppable({
    id: "offer-column-new",
    data: { kind: "offer-column-new" } satisfies DropData,
  });
  return (
    <div
      ref={drop.setNodeRef}
      className={`rounded-lg transition-colors ${
        isRuleDragActive && drop.isOver
          ? "bg-emerald-50/40 outline-2 outline-dashed outline-emerald-400 outline-offset-2"
          : ""
      }`}
    >
      {children}
    </div>
  );
}

function NewOfferCard({ onOpen }: { onOpen: () => void }) {
  // Thin trigger button — the modal lives at the bench root so it can
  // also be opened by drag-drop (rule → Offers column).
  return <DashedAddButton label="Νέα προσφορά" onClick={onOpen} />;
}

/**
 * New-offer modal — opened either by clicking the dashed button OR
 * by drag-dropping a rule onto the Offers column. In the drag-drop
 * case, `preAssignRule` is set; on submit the modal calls onSubmit
 * with the rule id so the bench can create-and-assign atomically.
 */
function NewOfferModal({
  preAssignRule,
  onCancel,
  onSubmit,
}: {
  preAssignRule?: Rule;
  onCancel: () => void;
  onSubmit: (
    name: string,
    description: string | null,
    active: boolean,
    preAssignRuleId: string | null
  ) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  return (
    <CenteredModal
      title="Νέα προσφορά"
      subtitle={
        preAssignRule
          ? "Δημιουργία προσφοράς με τον κανόνα που ρίξατε ως πρώτο μέλος."
          : "Η προσφορά ομαδοποιεί κανόνες — προσθέστε τους αργότερα κάνοντας κλικ στην κάρτα."
      }
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
            disabled={!name.trim()}
            onClick={() =>
              onSubmit(
                name.trim(),
                description.trim() || null,
                active,
                preAssignRule?.id ?? null
              )
            }
            className="btn btn-primary btn-sm"
          >
            Δημιουργία
          </button>
        </>
      }
    >
      {preAssignRule && (
        <div className="rounded-md bg-sky-50 border border-sky-200 px-3 py-2 text-sm">
          <span className="block text-xs text-sky-700 mb-0.5">
            Πρώτο μέλος:
          </span>
          <span className="font-medium text-sky-900">
            {preAssignRule.name}
          </span>
        </div>
      )}
      <label className="block">
        <span className="block text-xs text-muted-foreground mb-1">
          Όνομα προσφοράς
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            preAssignRule
              ? `π.χ. Προσφορά ${preAssignRule.name}`
              : "π.χ. Black Friday 2025"
          }
          maxLength={200}
          autoFocus
          className="cms-input"
        />
      </label>
      <label className="block">
        <span className="block text-xs text-muted-foreground mb-1">
          Περιγραφή (προαιρετική)
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={2000}
          className="cms-input"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Ενεργή αμέσως
      </label>
    </CenteredModal>
  );
}

function NewRuleCard({
  onSubmit,
}: {
  onSubmit: (kind: RuleKind, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<RuleKind>("price_discount");
  const [name, setName] = useState("");

  const choices: Array<{
    kind: RuleKind;
    title: string;
    description: string;
  }> = [
    {
      kind: "price_discount",
      title: "Έκπτωση τιμής",
      description: "π.χ. −20% ή −5€",
    },
    {
      kind: "service_cost_exception",
      title: "Εξαίρεση εξόδων",
      description: "Δωρ. αποστολή / αντικαταβολή",
    },
    {
      kind: "product_bundle",
      title: "Δέσμη προϊόντων",
      description: "Β+Δ (διαθέσιμο σύντομα)",
    },
  ];

  return (
    <>
      <DashedAddButton
        label="Νέος κανόνας"
        onClick={() => {
          setKind("price_discount");
          setName("");
          setOpen(true);
        }}
      />
      {open && (
        <CenteredModal
          title="Νέος κανόνας"
          subtitle="Ο τύπος δεν αλλάζει μετά τη δημιουργία."
          onCancel={() => setOpen(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn btn-secondary btn-sm"
              >
                Ακύρωση
              </button>
              <button
                type="button"
                onClick={() => {
                  onSubmit(kind, name.trim());
                  setOpen(false);
                }}
                className="btn btn-primary btn-sm"
              >
                Δημιουργία
              </button>
            </>
          }
        >
          <div>
            <span className="block text-xs text-muted-foreground mb-2">
              Τύπος κανόνα
            </span>
            <div className="grid gap-1.5">
              {choices.map((c) => (
                <button
                  key={c.kind}
                  type="button"
                  onClick={() => setKind(c.kind)}
                  className={`w-full text-left px-3 py-2 rounded border transition-colors ${
                    kind === c.kind
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <div className="text-sm font-medium">{c.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1">
              Όνομα (προαιρετικό)
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="αυτόματη ονομασία αν αφεθεί κενό"
              maxLength={200}
              className="cms-input"
            />
          </label>
        </CenteredModal>
      )}
    </>
  );
}

function CodeCardItem({
  code,
  attachments,
  rulesById,
  offersById,
  onToggleActive,
  onDelete,
}: {
  code: Code;
  attachments: CodeAttachment[];
  rulesById: Record<string, Rule>;
  offersById: Record<string, Offer>;
  /** Called when the active toggle is flipped. */
  onToggleActive: (next: boolean) => void;
  /** Bin-icon delete. */
  onDelete: () => void;
}) {
  const ruleAttaches = attachments.filter((a) => a.target_kind === "rule");
  const offerAttaches = attachments.filter((a) => a.target_kind === "offer");

  // Drag source only: codes can be dragged onto rules or offers.
  const drag = useDraggable({
    id: `code:${code.id}`,
    data: { kind: "code", id: code.id, code: code.code } as DragData,
  });

  return (
    <div
      ref={drag.setNodeRef}
      {...drag.attributes}
      {...drag.listeners}
      className={`rounded-lg transition ${
        drag.isDragging ? "opacity-40" : ""
      }`}
      style={{ touchAction: "none" }}
    >
    <CardShell>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <code className="text-sm font-semibold font-mono block truncate">
            {code.code}
          </code>
          <div className="text-xs text-muted-foreground mt-0.5">
            {code.max_uses_total !== null ? (
              <span className="tabular-nums">
                {code.current_uses}/{code.max_uses_total} χρήσεις
              </span>
            ) : (
              <span className="tabular-nums">
                {code.current_uses} χρήσεις · χωρίς όριο
              </span>
            )}
          </div>
        </div>
        <Toggle
          active={code.active}
          onChange={onToggleActive}
          ariaLabel={`Ενεργοποίηση κωδικού ${code.code}`}
        />
        <BinButton
          onClick={onDelete}
          ariaLabel={`Διαγραφή κωδικού ${code.code}`}
        />
      </div>

      {attachments.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic mt-2 pt-2 border-t border-border">
          Δεν συνδέεται με κάτι ακόμη
        </p>
      ) : (
        <div className="mt-2 pt-2 border-t border-border text-xs space-y-1">
          {offerAttaches.map((a) => {
            const offer = offersById[a.target_id];
            return offer ? (
              <div key={a.id} className="truncate" title={offer.name}>
                <span className="text-muted-foreground">Προσφορά:</span>{" "}
                <span className="font-medium">{offer.name}</span>
              </div>
            ) : null;
          })}
          {ruleAttaches.map((a) => {
            const rule = rulesById[a.target_id];
            return rule ? (
              <div key={a.id} className="truncate" title={rule.name}>
                <span className="text-muted-foreground">Κανόνας:</span>{" "}
                <span className="font-medium">{rule.name}</span>
              </div>
            ) : null;
          })}
        </div>
      )}
    </CardShell>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * One-line description of what a rule's action does. Used in the rule
 * card to give a glance-able summary without needing to open the rule.
 */
function actionSummary(action: RuleAction | null): string {
  if (!action) return "—";
  switch (action.kind) {
    case "price_discount": {
      const { mode, value } = action.config;
      if (mode === "percent") {
        return `Έκπτωση −${Math.round(value * 100)}%`;
      }
      return `Έκπτωση −€${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
    }
    case "product_bundle":
      return "Δέσμη Β+Δ";
    case "service_cost_exception": {
      const { fee_kind } = action.config;
      if (fee_kind === "delivery") return "Δωρεάν αποστολή";
      if (fee_kind === "cod") return "Χωρίς έξοδα αντικ.";
      return "Χωρίς έξοδα υπηρεσιών";
    }
  }
}

function defaultActionFor(kind: RuleKind): {
  name: string;
  config: Record<string, unknown>;
} {
  switch (kind) {
    case "price_discount":
      return {
        name: "Νέα έκπτωση τιμής",
        config: { mode: "percent", value: 0.1 },
      };
    case "product_bundle":
      return {
        name: "Νέα δέσμη προϊόντων",
        config: {
          trigger_scope_kind: "product",
          trigger_scope_id: null,
          trigger_quantity: 2,
          reward_scope_kind: "product",
          reward_scope_id: null,
          reward_quantity: 1,
          reward_discount: 1,
          max_applications_per_cart: null,
        },
      };
    case "service_cost_exception":
      return {
        name: "Νέα εξαίρεση εξόδων",
        config: {
          fee_kind: "delivery",
          threshold: null,
          waive_customer_charge: true,
        },
      };
  }
}
