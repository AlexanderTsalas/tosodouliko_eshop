"use client";

import { useState, type ReactNode } from "react";
import Popover from "./_Popover";
import {
  Chip,
  AddChipButton,
  truncateUuid,
  formatDate,
  sameDay,
  type ChipAccent,
} from "./_chips";
import {
  ActionConfigForm,
  ConditionCard,
  Field,
} from "./_editorParts";
import {
  CONDITION_KIND_LABELS,
  ALL_CONDITION_KINDS,
} from "@/lib/offers/conditionLabels";
import type {
  Affiliate,
  Code,
  Rule,
  RuleAction,
  RuleCondition,
  RuleConditionKind,
  RuleScope,
  RuleScopeKind,
} from "@/types/offers";
import type { Category } from "@/types/category-navigation";

interface Props {
  rule: Rule;
  action: RuleAction | null;
  scopes: RuleScope[];
  conditions: RuleCondition[];
  codes: Code[];
  categories: Category[];
  affiliates: Affiliate[];

  // ── Mutation handlers ─────────────────────────────────────────────
  onSetAction: (
    kind: RuleAction["kind"],
    config: Record<string, unknown>
  ) => void;
  onSetScopes: (
    next: Array<{ scope_kind: RuleScopeKind; resource_id?: string | null }>
  ) => Promise<void>;
  onAddCondition: (kind: RuleConditionKind) => void;
  onUpdateCondition: (id: string, config: Record<string, unknown>) => void;
  onRemoveCondition: (id: string) => void;
  onAttachCode: (codeText: string, affiliateId?: string | null) => Promise<void>;
  onDetachCode: (codeId: string) => Promise<void>;
  onUpdateCode: (
    id: string,
    patch: Partial<{
      affiliate_id: string | null;
      max_uses_total: number | null;
      max_uses_per_customer: number | null;
      enforce_limits: boolean;
      active: boolean;
    }>
  ) => Promise<void>;
}

/**
 * Editable Greek-sentence rendering of a rule.
 *
 * Each chip is now a popover trigger: clicking it opens a small
 * floating editor with the relevant form. Inline "+" affordances at
 * the end of each section let admins add new scopes / conditions /
 * codes without leaving the sentence.
 *
 * The structured form sections that lived below this in Phase 2a are
 * retired in this phase — the sentence IS the editor now.
 */
export default function RuleSentence({
  rule,
  action,
  scopes,
  conditions,
  codes,
  categories,
  affiliates,
  onSetAction,
  onSetScopes,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
  onAttachCode,
  onDetachCode,
  onUpdateCode,
}: Props) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-5">
      {/* Outer wrapper is a <div>, NOT <p>: the editable chips contain
          popovers whose content includes block-level elements (h4,
          form fields, etc.). HTML spec forbids block descendants of
          <p> — the browser would auto-close the <p> and break SSR
          hydration. A <div> with the same leading/font preserves the
          prose reading without that constraint. */}
      <div className="text-[15px] leading-loose text-foreground/90 font-serif">
        {/* Action */}
        {action ? (
          <ActionClause action={action} onSetAction={onSetAction} />
        ) : (
          <Chip accent="muted">καμία ενέργεια</Chip>
        )}

        {/* Scopes (only relevant for price_discount + product_bundle;
            service_cost_exception applies cart-wide and the action
            phrase handles its own targets) */}
        {action?.kind !== "service_cost_exception" && (
          <ScopesClause
            scopes={scopes}
            categories={categories}
            onSetScopes={onSetScopes}
          />
        )}

        {/* Conditions */}
        <ConditionsClause
          conditions={conditions}
          onAddCondition={onAddCondition}
          onUpdateCondition={onUpdateCondition}
          onRemoveCondition={onRemoveCondition}
        />

        {/* Codes */}
        <CodesClause
          codes={codes}
          affiliates={affiliates}
          rule={rule}
          onAttachCode={onAttachCode}
          onDetachCode={onDetachCode}
          onUpdateCode={onUpdateCode}
        />

        <span className="text-muted-foreground">.</span>
      </div>
    </div>
  );
}

// ─── Action clause ──────────────────────────────────────────────────

function ActionClause({
  action,
  onSetAction,
}: {
  action: RuleAction;
  onSetAction: (
    kind: RuleAction["kind"],
    config: Record<string, unknown>
  ) => void;
}) {
  const verb =
    action.kind === "product_bundle"
      ? "Όταν ο πελάτης αγοράσει "
      : action.kind === "service_cost_exception"
        ? ""
        : "Εφαρμόζει ";
  const trailing =
    action.kind === "product_bundle"
      ? null
      : action.kind === "service_cost_exception"
        ? null
        : " στα ";

  return (
    <>
      {verb && <span className="text-muted-foreground">{verb}</span>}
      <Popover
        width={360}
        trigger={
          <Chip accent="discount" interactive>
            {actionLabel(action)}
          </Chip>
        }
      >
        {() => (
          <div className="space-y-3">
            <header className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Ενέργεια</h4>
            </header>
            <ActionConfigForm
              action={action}
              onUpdate={(cfg) => onSetAction(action.kind, cfg)}
            />
          </div>
        )}
      </Popover>
      {trailing && <span className="text-muted-foreground">{trailing}</span>}
    </>
  );
}

function actionLabel(action: RuleAction): string {
  switch (action.kind) {
    case "price_discount": {
      const { mode, value } = action.config;
      if (mode === "percent") return `−${Math.round(value * 100)}%`;
      return `−${value.toFixed(value % 1 === 0 ? 0 : 2)} €`;
    }
    case "service_cost_exception": {
      if (action.config.fee_kind === "delivery") return "Δωρεάν αποστολή";
      if (action.config.fee_kind === "cod") return "Χωρίς έξοδα αντικαταβολής";
      return "Χωρίς οποιαδήποτε έξοδα";
    }
    case "product_bundle": {
      const { trigger_quantity, reward_quantity, reward_discount } =
        action.config;
      const rewardLabel =
        reward_discount === 1
          ? "δωρεάν"
          : `−${Math.round(reward_discount * 100)}% off`;
      return `${trigger_quantity} → ${reward_quantity} ${rewardLabel}`;
    }
  }
}

// ─── Scopes clause ──────────────────────────────────────────────────

function ScopesClause({
  scopes,
  categories,
  onSetScopes,
}: {
  scopes: RuleScope[];
  categories: Category[];
  onSetScopes: (
    next: Array<{ scope_kind: RuleScopeKind; resource_id?: string | null }>
  ) => Promise<void>;
}) {
  // Helpers: build a fresh full list from a single mutation.
  function replaceAt(i: number, next: { scope_kind: RuleScopeKind; resource_id?: string | null }) {
    const list = scopes.map((s, idx) =>
      idx === i
        ? next
        : { scope_kind: s.scope_kind, resource_id: s.resource_id }
    );
    return onSetScopes(list);
  }
  function removeAt(i: number) {
    const list = scopes
      .filter((_, idx) => idx !== i)
      .map((s) => ({ scope_kind: s.scope_kind, resource_id: s.resource_id }));
    return onSetScopes(list);
  }
  function appendScope(next: { scope_kind: RuleScopeKind; resource_id?: string | null }) {
    const list: Array<{ scope_kind: RuleScopeKind; resource_id?: string | null }> = [
      ...scopes.map((s) => ({
        scope_kind: s.scope_kind,
        resource_id: s.resource_id,
      })),
      next,
    ];
    return onSetScopes(list);
  }

  if (scopes.length === 0) {
    return (
      <ScopeAddPopover categories={categories} onAdd={appendScope}>
        <Chip accent="muted" interactive>
          + πεδίο εφαρμογής
        </Chip>
      </ScopeAddPopover>
    );
  }

  // "all" override — if any scope is "all", render just that single chip.
  if (scopes.some((s) => s.scope_kind === "all")) {
    const idx = scopes.findIndex((s) => s.scope_kind === "all");
    return (
      <ScopeChipEditable
        scope={scopes[idx]}
        categories={categories}
        onReplace={(next) => replaceAt(idx, next)}
        onRemove={() => removeAt(idx)}
      />
    );
  }

  return (
    <>
      {scopes.map((s, i) => (
        <span key={s.id ?? i}>
          {i > 0 && <span className="text-muted-foreground"> και </span>}
          <ScopeChipEditable
            scope={s}
            categories={categories}
            onReplace={(next) => replaceAt(i, next)}
            onRemove={() => removeAt(i)}
          />
        </span>
      ))}
      <ScopeAddPopover categories={categories} onAdd={appendScope}>
        <AddChipButton label="πεδίο" />
      </ScopeAddPopover>
    </>
  );
}

function ScopeChipEditable({
  scope,
  categories,
  onReplace,
  onRemove,
}: {
  scope: RuleScope;
  categories: Category[];
  onReplace: (next: {
    scope_kind: RuleScopeKind;
    resource_id?: string | null;
  }) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  return (
    <Popover
      width={340}
      trigger={
        <Chip accent="scope" interactive>
          {scopeLabel(scope, categories)}
        </Chip>
      }
    >
      {(close) => (
        <ScopeForm
          initial={{ scope_kind: scope.scope_kind, resource_id: scope.resource_id }}
          categories={categories}
          onSave={async (next) => {
            await onReplace(next);
            close();
          }}
          onRemove={async () => {
            await onRemove();
            close();
          }}
        />
      )}
    </Popover>
  );
}

function ScopeAddPopover({
  categories,
  onAdd,
  children,
}: {
  categories: Category[];
  onAdd: (next: {
    scope_kind: RuleScopeKind;
    resource_id?: string | null;
  }) => Promise<void>;
  children: ReactNode;
}) {
  return (
    <Popover width={340} trigger={children}>
      {(close) => (
        <ScopeForm
          initial={{ scope_kind: "all", resource_id: null }}
          categories={categories}
          onSave={async (next) => {
            await onAdd(next);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function ScopeForm({
  initial,
  categories,
  onSave,
  onRemove,
}: {
  initial: { scope_kind: RuleScopeKind; resource_id: string | null };
  categories: Category[];
  onSave: (next: {
    scope_kind: RuleScopeKind;
    resource_id?: string | null;
  }) => Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  const [kind, setKind] = useState<RuleScopeKind>(initial.scope_kind);
  const [resourceId, setResourceId] = useState<string>(initial.resource_id ?? "");
  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Πεδίο εφαρμογής</h4>
      </header>
      <Field label="Τύπος">
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as RuleScopeKind);
            setResourceId("");
          }}
          className="cms-input"
        >
          <option value="all">Όλα τα προϊόντα</option>
          <option value="category">Κατηγορία</option>
          <option value="product">Συγκεκριμένο προϊόν (UUID)</option>
          <option value="variant">Συγκεκριμένη παραλλαγή (UUID)</option>
        </select>
      </Field>
      {kind === "category" && (
        <Field label="Κατηγορία">
          <select
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            className="cms-input"
          >
            <option value="">— Επιλέξτε —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {(kind === "product" || kind === "variant") && (
        <Field label="UUID">
          <input
            type="text"
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            placeholder="UUID"
            className="cms-input font-mono text-xs"
          />
        </Field>
      )}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-destructive hover:underline"
          >
            ✕ Αφαίρεση πεδίου
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() =>
            onSave({
              scope_kind: kind,
              resource_id: kind === "all" ? null : resourceId || null,
            })
          }
          className="btn btn-primary btn-sm"
        >
          Αποθήκευση
        </button>
      </div>
    </div>
  );
}

function scopeLabel(scope: RuleScope, categories: Category[]): string {
  if (scope.scope_kind === "all") return "όλα τα προϊόντα";
  if (scope.scope_kind === "category") {
    const cat = categories.find((c) => c.id === scope.resource_id);
    return `Κατηγορία: ${cat?.name ?? truncateUuid(scope.resource_id)}`;
  }
  if (scope.scope_kind === "product") {
    return `προϊόν: ${truncateUuid(scope.resource_id)}`;
  }
  return `παραλλαγή: ${truncateUuid(scope.resource_id)}`;
}

// ─── Conditions clause ──────────────────────────────────────────────

function ConditionsClause({
  conditions,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
}: {
  conditions: RuleCondition[];
  onAddCondition: (kind: RuleConditionKind) => void;
  onUpdateCondition: (id: string, config: Record<string, unknown>) => void;
  onRemoveCondition: (id: string) => void;
}) {
  const existingKinds = new Set(conditions.map((c) => c.kind));
  const remainingKinds = ALL_CONDITION_KINDS.filter((k) => !existingKinds.has(k));

  return (
    <>
      {conditions.length > 0 && (
        <span className="text-muted-foreground"> όταν </span>
      )}
      {conditions.map((c, i) => (
        <span key={c.id}>
          {i > 0 && <span className="text-muted-foreground"> και </span>}
          <Popover
            width={380}
            trigger={
              <Chip accent={chipAccentForCondition(c.kind)} interactive>
                {conditionLabel(c)}
              </Chip>
            }
          >
            {(close) => (
              <ConditionCard
                condition={c}
                onUpdate={(cfg) => onUpdateCondition(c.id, cfg)}
                onDelete={() => {
                  onRemoveCondition(c.id);
                  close();
                }}
              />
            )}
          </Popover>
        </span>
      ))}
      {remainingKinds.length > 0 && (
        <Popover
          width={280}
          trigger={
            <AddChipButton
              label={conditions.length === 0 ? "συνθήκη" : "ακόμη συνθήκη"}
            />
          }
        >
          {(close) => (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold mb-2">Επιλογή συνθήκης</h4>
              <div className="grid grid-cols-1 gap-1">
                {remainingKinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      onAddCondition(k);
                      close();
                    }}
                    className="text-left text-sm px-2 py-1.5 rounded hover:bg-muted transition-colors"
                  >
                    {CONDITION_KIND_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Popover>
      )}
    </>
  );
}

function chipAccentForCondition(kind: RuleConditionKind): ChipAccent {
  if (kind === "user_type") return "user";
  if (kind === "available_quantity") return "scope";
  return "time";
}

function conditionLabel(c: RuleCondition): string {
  switch (c.kind) {
    case "timeframe": {
      const { starts_at, ends_at } = c.config;
      if (!starts_at && !ends_at) return "Χρ. πλαίσιο (μη ρυθμισμένο)";
      const start = starts_at ? formatDate(starts_at) : "αρχή";
      const end = ends_at ? formatDate(ends_at) : "συνεχόμενο";
      if (starts_at && ends_at && sameDay(starts_at, ends_at)) return start;
      return `${start} – ${end}`;
    }
    case "user_type": {
      const v = c.config.value;
      if (v === "guest") return "Επισκέπτες μόνο";
      if (v === "authenticated") return "Εγγεγραμμένοι μόνο";
      return "Συγκεκριμένος χρήστης";
    }
    case "min_subtotal":
      return `Υποσύνολο ≥ €${c.config.threshold}`;
    case "min_item_count":
      return `≥ ${c.config.threshold} προϊόντα`;
    case "available_quantity": {
      if (c.config.mode === "until_oos") return "Μέχρι εξαντλήσεως";
      const { min, max } = c.config;
      if (max === null) return `Απόθεμα ≥ ${min}`;
      return `Απόθεμα ${min}–${max}`;
    }
  }
}

// ─── Codes clause ───────────────────────────────────────────────────

function CodesClause({
  codes,
  affiliates,
  rule,
  onAttachCode,
  onDetachCode,
  onUpdateCode,
}: {
  codes: Code[];
  affiliates: Affiliate[];
  rule: Rule;
  onAttachCode: (codeText: string, affiliateId?: string | null) => Promise<void>;
  onDetachCode: (codeId: string) => Promise<void>;
  onUpdateCode: (
    id: string,
    patch: Partial<{
      affiliate_id: string | null;
      max_uses_total: number | null;
      max_uses_per_customer: number | null;
      enforce_limits: boolean;
      active: boolean;
    }>
  ) => Promise<void>;
}) {
  void rule;
  return (
    <>
      {codes.length > 0 ? (
        <>
          <span className="text-muted-foreground">
            {" "}
            και ο πελάτης εισάγει τον κωδικό{" "}
          </span>
          {codes.map((c, i) => (
            <span key={c.id}>
              {i > 0 && <span className="text-muted-foreground"> ή </span>}
              <Popover
                width={340}
                trigger={
                  <Chip accent="code" interactive>
                    #{c.code}
                  </Chip>
                }
              >
                {(close) => (
                  <CodeForm
                    code={c}
                    affiliates={affiliates}
                    onUpdate={onUpdateCode}
                    onDetach={async () => {
                      await onDetachCode(c.id);
                      close();
                    }}
                  />
                )}
              </Popover>
            </span>
          ))}
        </>
      ) : null}
      <Popover
        width={320}
        trigger={
          <AddChipButton
            label={codes.length === 0 ? "κωδικός" : "ακόμη κωδικός"}
          />
        }
      >
        {(close) => (
          <CodeAttachForm
            affiliates={affiliates}
            onAttach={async (text, aff) => {
              await onAttachCode(text, aff);
              close();
            }}
          />
        )}
      </Popover>
    </>
  );
}

function CodeForm({
  code,
  affiliates,
  onUpdate,
  onDetach,
}: {
  code: Code;
  affiliates: Affiliate[];
  onUpdate: (
    id: string,
    patch: Partial<{
      affiliate_id: string | null;
      max_uses_total: number | null;
      max_uses_per_customer: number | null;
      enforce_limits: boolean;
      active: boolean;
    }>
  ) => Promise<void>;
  onDetach: () => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Κωδικός</h4>
        <code className="text-xs font-mono text-muted-foreground">
          #{code.code}
        </code>
      </header>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Συν. χρήσεις">
          <input
            type="number"
            min="1"
            value={code.max_uses_total ?? ""}
            placeholder="χωρίς όριο"
            onChange={(e) =>
              onUpdate(code.id, {
                max_uses_total: e.target.value
                  ? parseInt(e.target.value, 10)
                  : null,
              })
            }
            className="cms-input"
          />
        </Field>
        <Field label="Ανά πελάτη">
          <input
            type="number"
            min="1"
            value={code.max_uses_per_customer ?? ""}
            placeholder="χωρίς όριο"
            onChange={(e) =>
              onUpdate(code.id, {
                max_uses_per_customer: e.target.value
                  ? parseInt(e.target.value, 10)
                  : null,
              })
            }
            className="cms-input"
          />
        </Field>
      </div>
      {affiliates.length > 0 && (
        <Field label="Συνεργάτης">
          <select
            value={code.affiliate_id ?? ""}
            onChange={(e) =>
              onUpdate(code.id, { affiliate_id: e.target.value || null })
            }
            className="cms-input"
          >
            <option value="">(κανείς)</option>
            {affiliates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={code.active}
            onChange={(e) => onUpdate(code.id, { active: e.target.checked })}
          />
          Ενεργός
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={code.enforce_limits}
            onChange={(e) =>
              onUpdate(code.id, { enforce_limits: e.target.checked })
            }
          />
          Αυστηρή επιβολή
        </label>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums pt-2 border-t border-border">
        Χρήσεις: {code.current_uses}
        {code.max_uses_total !== null ? ` / ${code.max_uses_total}` : ""}
      </div>
      <div className="pt-2 border-t border-border flex justify-between">
        <button
          type="button"
          onClick={onDetach}
          className="text-xs text-destructive hover:underline"
        >
          ✕ Αφαίρεση από κανόνα
        </button>
      </div>
    </div>
  );
}

function CodeAttachForm({
  affiliates,
  onAttach,
}: {
  affiliates: Affiliate[];
  onAttach: (codeText: string, affiliateId?: string | null) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [affiliateId, setAffiliateId] = useState("");
  return (
    <div className="space-y-3">
      <header>
        <h4 className="text-sm font-semibold">Νέος κωδικός</h4>
      </header>
      <Field label="Κωδικός">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value.toUpperCase())}
          placeholder="ΝΕΟΣ_ΚΩΔΙΚΟΣ"
          className="cms-input font-mono"
          maxLength={64}
          autoFocus
        />
      </Field>
      {affiliates.length > 0 && (
        <Field label="Συνεργάτης (προαιρετικά)">
          <select
            value={affiliateId}
            onChange={(e) => setAffiliateId(e.target.value)}
            className="cms-input"
          >
            <option value="">(κανείς)</option>
            {affiliates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => onAttach(text.trim(), affiliateId || null)}
        className="btn btn-primary btn-sm w-full"
      >
        Προσθήκη + σύνδεση
      </button>
    </div>
  );
}

