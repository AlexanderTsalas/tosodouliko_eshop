"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import {
  updateRule,
  deleteRule,
  setRuleAction,
  setRuleScopes,
  createRuleCondition,
  updateRuleCondition,
  deleteRuleCondition,
  createRuleCode,
  updateRuleCode,
  deleteRuleCode,
  assignRuleToOffer,
  unassignRuleFromOffer,
} from "@/actions/offers";
import {
  Section,
  Field,
  BinIcon,
  ruleKindFullLabel,
  defaultConfigForCondition,
} from "./_editorParts";
import RuleSentence from "./RuleSentence";
import LivePreviewDrawer from "./LivePreviewDrawer";
import { FlaskConical } from "lucide-react";
import type {
  Affiliate,
  Code,
  Offer,
  Rule,
  RuleAction,
  RuleCondition,
  RuleConditionKind,
  RuleScope,
} from "@/types/offers";
import type { Category } from "@/types/category-navigation";

interface Props {
  rule: Rule;
  action: RuleAction | null;
  scopes: RuleScope[];
  codes: Code[];
  conditions: RuleCondition[];
  memberships: string[];
  allOffers: Offer[];
  categories: Category[];
  affiliates: Affiliate[];
  /** Collapse the inline editor back to its card on the bench. */
  onClose: () => void;
  /** Called after successful delete so the bench can clear its
   *  expansion state. */
  onDeleted: () => void;
}

/**
 * Inline rule editor — embedded into the lab bench when a rule card
 * is clicked. Owns local state for the rule + its action + scopes +
 * conditions + codes + memberships; each mutation is optimistic
 * (local state updates first, server action confirms in the
 * background).
 *
 * There's no longer a standalone route version — Phase 4f removed
 * `/admin/discounts/rules/[id]` entirely. All editing happens on the
 * bench in-place.
 */
export default function RuleEditorClient(props: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [rule, setRule] = useState<Rule>(props.rule);
  const [action, setAction] = useState<RuleAction | null>(props.action);
  const [scopes, setScopes] = useState<RuleScope[]>(props.scopes);
  const [codes, setCodes] = useState<Code[]>(props.codes);
  const [conditions, setConditions] = useState<RuleCondition[]>(
    props.conditions
  );
  const [memberships, setMemberships] = useState<string[]>(props.memberships);

  const [error, setError] = useState<string | null>(null);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  function flashError(msg: string) {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  }

  // ─── Mutations ────────────────────────────────────────────────────

  function patchRule(patch: Partial<Rule>) {
    setRule((r) => ({ ...r, ...patch }));
    startTransition(async () => {
      const r = await updateRule({
        id: rule.id,
        ...(patch as Record<string, unknown>),
      });
      if (!r.success) flashError(r.error);
    });
  }
  function handleDelete() {
    if (!confirm("Διαγραφή κανόνα; Δεν επαναφέρεται.")) return;
    startTransition(async () => {
      const r = await deleteRule({ id: rule.id });
      if (!r.success) return flashError(r.error);
      props.onDeleted();
    });
  }
  function handleSetAction(kind: RuleAction["kind"], config: Record<string, unknown>) {
    setAction((a) => (a ? ({ ...a, kind, config } as RuleAction) : a));
    setRule((r) => ({ ...r, kind }));
    startTransition(async () => {
      const r = await setRuleAction({ rule_id: rule.id, kind, config });
      if (!r.success) flashError(r.error);
    });
  }
  function handleAddCondition(kind: RuleConditionKind) {
    const config = defaultConfigForCondition(kind);
    startTransition(async () => {
      const r = await createRuleCondition({
        rule_id: rule.id,
        kind,
        config,
      });
      if (!r.success) return flashError(r.error);
      setConditions((c) => [...c, r.data]);
      router.refresh();
    });
  }
  function handleUpdateCondition(
    id: string,
    config: Record<string, unknown>
  ) {
    setConditions((c) =>
      c.map((x) => (x.id === id ? ({ ...x, config } as RuleCondition) : x))
    );
    startTransition(async () => {
      const r = await updateRuleCondition({ id, config });
      if (!r.success) flashError(r.error);
    });
  }
  function handleDeleteCondition(id: string) {
    startTransition(async () => {
      const r = await deleteRuleCondition({ id });
      if (!r.success) return flashError(r.error);
      setConditions((c) => c.filter((x) => x.id !== id));
    });
  }
  async function handleSetScopes(
    next: Array<{ scope_kind: RuleScope["scope_kind"]; resource_id?: string | null }>
  ) {
    const r = await setRuleScopes({ rule_id: rule.id, scopes: next });
    if (!r.success) return flashError(r.error);
    router.refresh();
  }
  async function handleAddCode(
    code: string,
    affiliate_id: string | null = null
  ) {
    const r = await createRuleCode({
      rule_id: rule.id,
      code,
      affiliate_id,
    });
    if (!r.success) return flashError(r.error);
    setCodes((cs) => [...cs, r.data]);
    setRule((r) => ({ ...r, requires_code: true }));
  }
  async function handleDeleteCode(id: string) {
    const r = await deleteRuleCode({ id });
    if (!r.success) return flashError(r.error);
    setCodes((cs) => cs.filter((c) => c.id !== id));
  }
  async function handleUpdateCode(
    id: string,
    patch: Partial<{
      affiliate_id: string | null;
      max_uses_total: number | null;
      max_uses_per_customer: number | null;
      enforce_limits: boolean;
      active: boolean;
    }>
  ) {
    setCodes((cs) =>
      cs.map((c) => (c.id === id ? ({ ...c, ...patch } as Code) : c))
    );
    const r = await updateRuleCode({
      id,
      ...(patch as Record<string, unknown>),
    });
    if (!r.success) flashError(r.error);
  }
  async function handleAssignOffer(offer_id: string) {
    const r = await assignRuleToOffer({ rule_id: rule.id, offer_id });
    if (!r.success) return flashError(r.error);
    setMemberships((m) => Array.from(new Set([...m, offer_id])));
  }
  async function handleUnassignOffer(offer_id: string) {
    const r = await unassignRuleFromOffer({ rule_id: rule.id, offer_id });
    if (!r.success) return flashError(r.error);
    setMemberships((m) => m.filter((id) => id !== offer_id));
  }

  return (
    <div className="space-y-6 transition-[margin] duration-200">
      {/* Header — close button collapses the inline editor */}
      <div className="flex items-center gap-3 pb-4 border-b border-border">
        <button
          type="button"
          onClick={props.onClose}
          className="btn btn-ghost btn-sm flex items-center gap-1.5"
          aria-label="Κλείσιμο επεξεργασίας"
        >
          <X className="w-4 h-4" />
          <span>Κλείσιμο</span>
        </button>
        <button
          type="button"
          onClick={() => setPreviewOpen((x) => !x)}
          className={`btn btn-sm flex items-center gap-1.5 ml-auto ${
            previewOpen ? "btn-primary" : "btn-secondary"
          }`}
          aria-pressed={previewOpen}
        >
          <FlaskConical className="w-4 h-4" />
          <span>Δοκιμή</span>
        </button>
        <span className="text-xs text-muted-foreground">
          {ruleKindFullLabel(rule.kind)}
        </span>
      </div>

      {/* Name + description + active + delete */}
      <div>
        <div className="flex items-start gap-3">
          <input
            type="text"
            value={rule.name}
            onChange={(e) => patchRule({ name: e.target.value })}
            className="cms-input text-lg font-semibold flex-1"
            placeholder="Όνομα κανόνα"
            maxLength={200}
          />
          <label className="flex items-center gap-2 text-sm whitespace-nowrap pt-2">
            <input
              type="checkbox"
              checked={rule.active}
              onChange={(e) => patchRule({ active: e.target.checked })}
            />
            Ενεργός
          </label>
          <button
            type="button"
            onClick={handleDelete}
            className="btn btn-ghost btn-sm text-destructive"
            title="Διαγραφή"
            aria-label="Διαγραφή κανόνα"
          >
            <BinIcon />
          </button>
        </div>
        <textarea
          value={rule.description ?? ""}
          onChange={(e) =>
            patchRule({ description: e.target.value || null })
          }
          className="cms-input mt-2 w-full"
          placeholder="Περιγραφή (προαιρετική)"
          rows={2}
          maxLength={2000}
        />
      </div>

      {/* The sentence IS the editor (Phase 2b). Each chip is a popover
          trigger that opens the relevant config form inline. "+ X"
          buttons add new conditions / scopes / codes.

          Membership + behaviour stay as separate sections below because
          they're not part of the natural rule-statement (membership is
          relational; stacking/priority are global rule attributes). */}
      <RuleSentence
        rule={rule}
        action={action}
        scopes={scopes}
        conditions={conditions}
        codes={codes}
        categories={props.categories}
        affiliates={props.affiliates}
        onSetAction={handleSetAction}
        onSetScopes={handleSetScopes}
        onAddCondition={handleAddCondition}
        onUpdateCondition={handleUpdateCondition}
        onRemoveCondition={handleDeleteCondition}
        onAttachCode={handleAddCode}
        onDetachCode={handleDeleteCode}
        onUpdateCode={handleUpdateCode}
      />

      <Section title="Μέλος προσφορών">
        {memberships.length > 0 ? (
          <ul className="space-y-1.5 mb-3">
            {memberships.map((offerId) => {
              const offer = props.allOffers.find((o) => o.id === offerId);
              return (
                <li
                  key={offerId}
                  className="flex items-center justify-between gap-2 p-2 bg-muted/50 rounded text-sm"
                >
                  <span>{offer?.name ?? offerId}</span>
                  <button
                    type="button"
                    onClick={() => handleUnassignOffer(offerId)}
                    className="text-muted-foreground hover:text-destructive text-xs"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground mb-3">
            Δεν ανήκει σε καμία προσφορά (εφαρμόζεται αυτοτελώς).
          </p>
        )}
        {memberPickerOpen ? (
          <select
            autoFocus
            onChange={(e) => {
              if (e.target.value) {
                handleAssignOffer(e.target.value);
                setMemberPickerOpen(false);
              }
            }}
            onBlur={() => setMemberPickerOpen(false)}
            className="cms-input"
          >
            <option value="">— Επιλέξτε προσφορά —</option>
            {props.allOffers
              .filter((o) => !memberships.includes(o.id))
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
        ) : (
          <button
            type="button"
            onClick={() => setMemberPickerOpen(true)}
            className="btn btn-secondary btn-sm"
          >
            + Προσθήκη σε προσφορά
          </button>
        )}
      </Section>

      <Section
        title="Συμπεριφορά"
        subtitle="Πώς συμπεριφέρεται όταν εφαρμόζεται μαζί με άλλους κανόνες."
      >
        <Field label="Στοίβαξη">
          <select
            value={rule.stacking_mode}
            onChange={(e) =>
              patchRule({
                stacking_mode: e.target.value as Rule["stacking_mode"],
              })
            }
            className="cms-input"
          >
            <option value="stack">Επιτρέπει στοίβαξη</option>
            <option value="exclusive_within_kind">
              Αποκλειστικός εντός τύπου
            </option>
            <option value="global_exclusive">Καθολικά αποκλειστικός</option>
          </select>
        </Field>
        <Field label="Προτεραιότητα">
          <input
            type="number"
            value={rule.priority}
            onChange={(e) =>
              patchRule({ priority: parseInt(e.target.value, 10) || 0 })
            }
            className="cms-input w-32"
          />
        </Field>
      </Section>

      {error && (
        <div className="fixed bottom-6 right-6 bg-destructive text-white text-sm px-4 py-2 rounded shadow-lg">
          {error}
        </div>
      )}

      {previewOpen && (
        <LivePreviewDrawer
          rule={rule}
          categories={props.categories}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}
