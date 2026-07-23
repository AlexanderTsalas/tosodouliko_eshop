"use client";

import { useState, type ReactNode } from "react";
import { CONDITION_KIND_LABELS, ALL_CONDITION_KINDS } from "@/lib/offers/conditionLabels";
import type {
  Affiliate,
  Code,
  Rule,
  RuleAction,
  RuleCondition,
  RuleConditionKind,
  RuleKind,
  RuleScope,
  RuleScopeKind,
} from "@/types/offers";
import type { Category } from "@/types/category-navigation";

/**
 * Shared editor sub-components + helpers used by both the rule editor
 * and the offer editor pages. Extracted from the old OffersWorkspace
 * splitscreen so the new full-page editors can reuse the same primitives.
 */

// ─── Layout primitives ──────────────────────────────────────────────

export function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="pt-6 mt-6 border-t border-border first:pt-0 first:mt-0 first:border-t-0">
      <div className="mb-4">
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block mb-2">
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}

export function BinIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

export function ruleKindShort(kind: RuleKind): string {
  switch (kind) {
    case "price_discount":
      return "έκπτωση";
    case "product_bundle":
      return "δέσμη";
    case "service_cost_exception":
      return "εξαίρεση";
  }
}

export function ruleKindFullLabel(kind: RuleKind): string {
  switch (kind) {
    case "price_discount":
      return "Έκπτωση τιμής";
    case "product_bundle":
      return "Δέσμη προϊόντων";
    case "service_cost_exception":
      return "Εξαίρεση εξόδων υπηρεσίας";
  }
}

export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function toStartOfDayISO(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toISOString();
}
export function toEndOfDayISO(dateStr: string): string {
  const d = new Date(dateStr + "T23:59:59");
  return d.toISOString();
}

export function defaultConfigForCondition(
  kind: RuleConditionKind
): Record<string, unknown> {
  switch (kind) {
    case "timeframe":
      return { starts_at: null, ends_at: null };
    case "user_type":
      return { value: "authenticated" };
    case "min_subtotal":
      return { threshold: 50 };
    case "min_item_count":
      return { threshold: 2 };
    case "available_quantity":
      return { mode: "until_oos", scope_kind: "variant", scope_id: null };
  }
}

// ─── Action editor ──────────────────────────────────────────────────

export function ActionConfigForm({
  action,
  onUpdate,
}: {
  action: RuleAction;
  onUpdate: (config: Record<string, unknown>) => void;
}) {
  switch (action.kind) {
    case "price_discount":
      return (
        <div className="space-y-3">
          <Field label="Τύπος έκπτωσης">
            <select
              value={action.config.mode}
              onChange={(e) =>
                onUpdate({
                  ...action.config,
                  mode: e.target.value as "percent" | "flat",
                })
              }
              className="cms-input"
            >
              <option value="percent">Ποσοστιαία (%)</option>
              <option value="flat">Σταθερό ποσό (€)</option>
            </select>
          </Field>
          {action.config.mode === "percent" ? (
            <Field label="Ποσοστό (0.20 για −20%)">
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={action.config.value}
                onChange={(e) =>
                  onUpdate({
                    ...action.config,
                    value: Number(e.target.value) || 0,
                  })
                }
                className="cms-input w-40"
                placeholder="0.20"
              />
            </Field>
          ) : (
            <Field label="Ποσό σε € (αφαιρείται από το υποσύνολο)">
              <input
                type="number"
                step="0.01"
                min="0"
                value={action.config.value}
                onChange={(e) =>
                  onUpdate({
                    ...action.config,
                    value: Number(e.target.value) || 0,
                  })
                }
                className="cms-input w-40"
                placeholder="5.00"
              />
            </Field>
          )}
        </div>
      );

    case "product_bundle":
      return (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Δέσμη Β+Δ: «αγοράζεις X από προϊόν A, παίρνεις Y από προϊόν B».
            Υπολογισμός Β+Δ έρχεται σύντομα.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ποσότητα ενεργοποίησης (X)">
              <input
                type="number"
                min="1"
                value={action.config.trigger_quantity}
                onChange={(e) =>
                  onUpdate({
                    ...action.config,
                    trigger_quantity: parseInt(e.target.value, 10) || 1,
                  })
                }
                className="cms-input"
              />
            </Field>
            <Field label="Ποσότητα δώρου (Y)">
              <input
                type="number"
                min="1"
                value={action.config.reward_quantity}
                onChange={(e) =>
                  onUpdate({
                    ...action.config,
                    reward_quantity: parseInt(e.target.value, 10) || 1,
                  })
                }
                className="cms-input"
              />
            </Field>
          </div>
          <Field label="Έκπτωση στο δώρο (1 = δωρεάν)">
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={action.config.reward_discount}
              onChange={(e) =>
                onUpdate({
                  ...action.config,
                  reward_discount: Number(e.target.value) || 0,
                })
              }
              className="cms-input w-40"
            />
          </Field>
        </div>
      );

    case "service_cost_exception":
      return (
        <div className="space-y-3">
          <Field label="Ποια έξοδα μηδενίζονται">
            <select
              value={action.config.fee_kind}
              onChange={(e) =>
                onUpdate({
                  ...action.config,
                  fee_kind: e.target.value as "delivery" | "cod" | "all",
                })
              }
              className="cms-input"
            >
              <option value="delivery">Έξοδα αποστολής</option>
              <option value="cod">Έξοδα αντικαταβολής</option>
              <option value="all">Όλα τα έξοδα υπηρεσιών</option>
            </select>
          </Field>
          <Field label="Προαιρετική προϋπόθεση (κενό = πάντα ενεργό)">
            <select
              value={action.config.threshold?.kind ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) onUpdate({ ...action.config, threshold: null });
                else
                  onUpdate({
                    ...action.config,
                    threshold: {
                      kind: v as "cart_total" | "products_total",
                      value: action.config.threshold?.value ?? 0,
                    },
                  });
              }}
              className="cms-input"
            >
              <option value="">(χωρίς προϋπόθεση)</option>
              <option value="cart_total">Σύνολο καλαθιού ≥ X €</option>
              <option value="products_total">Επιλέξιμα προϊόντα ≥ X €</option>
            </select>
          </Field>
          {action.config.threshold !== null && (
            <Field label="Κατώφλι (€)">
              <input
                type="number"
                step="0.01"
                min="0"
                value={action.config.threshold.value}
                onChange={(e) =>
                  onUpdate({
                    ...action.config,
                    threshold: {
                      kind: action.config.threshold!.kind,
                      value: Number(e.target.value) || 0,
                    },
                  })
                }
                className="cms-input w-40"
              />
            </Field>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={action.config.waive_customer_charge}
              onChange={(e) =>
                onUpdate({
                  ...action.config,
                  waive_customer_charge: e.target.checked,
                })
              }
              className="mt-0.5"
            />
            <span>
              Ο πελάτης πληρώνει 0€ ακόμα κι αν η μεταφορική χρεώσει το κατάστημα
              <span className="block text-xs text-muted-foreground mt-0.5">
                Αν off, το έξοδο εμφανίζεται μηδενισμένο στην παραγγελία αλλά
                εσωτερικά κρατάμε την api_quote για λογιστική.
              </span>
            </span>
          </label>
        </div>
      );
  }
}

// ─── Scopes editor ──────────────────────────────────────────────────

export function ScopesEditor({
  scopes,
  categories,
  onChange,
}: {
  scopes: RuleScope[];
  categories: Category[];
  onChange: (
    next: Array<{ scope_kind: RuleScopeKind; resource_id?: string | null }>
  ) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState(
    scopes.map((s) => ({
      scope_kind: s.scope_kind,
      resource_id: s.resource_id,
    }))
  );

  function addScope() {
    setDrafts((d) => [
      ...d,
      { scope_kind: "all" as RuleScopeKind, resource_id: null },
    ]);
  }
  function removeScope(i: number) {
    setDrafts((d) => d.filter((_, idx) => idx !== i));
  }
  function patchScope(
    i: number,
    patch: Partial<{ scope_kind: RuleScopeKind; resource_id: string | null }>
  ) {
    setDrafts((d) => d.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  async function save() {
    await onChange(
      drafts.map((d) => ({
        scope_kind: d.scope_kind,
        resource_id: d.scope_kind === "all" ? null : d.resource_id,
      }))
    );
  }

  return (
    <div className="space-y-2">
      {drafts.map((s, i) => (
        <div key={i} className="flex gap-2 items-center">
          <select
            value={s.scope_kind}
            onChange={(e) =>
              patchScope(i, {
                scope_kind: e.target.value as RuleScopeKind,
                resource_id: null,
              })
            }
            className="cms-input w-40"
          >
            <option value="all">Όλα τα προϊόντα</option>
            <option value="category">Κατηγορία</option>
            <option value="product">Συγκεκριμένο προϊόν (UUID)</option>
            <option value="variant">Συγκεκριμένη παραλλαγή (UUID)</option>
          </select>
          {s.scope_kind === "category" && (
            <select
              value={s.resource_id ?? ""}
              onChange={(e) =>
                patchScope(i, { resource_id: e.target.value || null })
              }
              className="cms-input flex-1"
            >
              <option value="">— Επιλέξτε —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {(s.scope_kind === "product" || s.scope_kind === "variant") && (
            <input
              type="text"
              value={s.resource_id ?? ""}
              onChange={(e) =>
                patchScope(i, { resource_id: e.target.value || null })
              }
              placeholder="UUID"
              className="cms-input font-mono text-xs flex-1"
            />
          )}
          <button
            type="button"
            onClick={() => removeScope(i)}
            className="text-muted-foreground hover:text-destructive text-xs"
            aria-label="Αφαίρεση"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={addScope}
          className="btn btn-secondary btn-sm"
        >
          + Πεδίο
        </button>
        <button
          type="button"
          onClick={save}
          className="btn btn-primary btn-sm"
        >
          Αποθήκευση πεδίων
        </button>
      </div>
    </div>
  );
}

// ─── Condition editor ───────────────────────────────────────────────

export function ConditionCard({
  condition,
  onUpdate,
  onDelete,
}: {
  condition: RuleCondition;
  onUpdate: (config: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="border border-border rounded p-3 bg-background">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium">
          {CONDITION_KIND_LABELS[condition.kind]}
        </h4>
        <button
          type="button"
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive text-xs"
          aria-label="Αφαίρεση συνθήκης"
        >
          ✕ Αφαίρεση
        </button>
      </div>
      <ConditionConfigForm condition={condition} onUpdate={onUpdate} />
    </div>
  );
}

function ConditionConfigForm({
  condition,
  onUpdate,
}: {
  condition: RuleCondition;
  onUpdate: (config: Record<string, unknown>) => void;
}) {
  switch (condition.kind) {
    case "timeframe":
      return <TimeframeForm condition={condition} onUpdate={onUpdate} />;
    case "user_type":
      return <UserTypeForm condition={condition} onUpdate={onUpdate} />;
    case "min_subtotal":
      return (
        <Field label="Ελάχιστο υποσύνολο (€)">
          <input
            type="number"
            step="0.01"
            min="0"
            value={condition.config.threshold}
            onChange={(e) =>
              onUpdate({ threshold: Number(e.target.value) || 0 })
            }
            className="cms-input w-40"
          />
        </Field>
      );
    case "min_item_count":
      return (
        <Field label="Ελάχιστος αριθμός προϊόντων">
          <input
            type="number"
            step="1"
            min="1"
            value={condition.config.threshold}
            onChange={(e) =>
              onUpdate({ threshold: parseInt(e.target.value, 10) || 1 })
            }
            className="cms-input w-40"
          />
        </Field>
      );
    case "available_quantity":
      return (
        <AvailableQuantityForm condition={condition} onUpdate={onUpdate} />
      );
  }
}

function TimeframeForm({
  condition,
  onUpdate,
}: {
  condition: Extract<RuleCondition, { kind: "timeframe" }>;
  onUpdate: (config: Record<string, unknown>) => void;
}) {
  const start = condition.config.starts_at ?? null;
  const end = condition.config.ends_at ?? null;
  const [mode, setMode] = useState<"range" | "single">(
    start && !end ? "single" : "range"
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setMode("range")}
          className={`px-3 py-1.5 rounded border ${
            mode === "range"
              ? "bg-foreground text-background border-foreground"
              : "border-border hover:bg-muted"
          }`}
        >
          Διάστημα ημερών
        </button>
        <button
          type="button"
          onClick={() => setMode("single")}
          className={`px-3 py-1.5 rounded border ${
            mode === "single"
              ? "bg-foreground text-background border-foreground"
              : "border-border hover:bg-muted"
          }`}
        >
          Μία ημέρα
        </button>
      </div>
      {mode === "range" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Από">
            <input
              type="date"
              value={toDateInput(start)}
              onChange={(e) =>
                onUpdate({
                  ...condition.config,
                  starts_at: e.target.value
                    ? toStartOfDayISO(e.target.value)
                    : null,
                })
              }
              className="cms-input"
            />
          </Field>
          <Field label="Έως (περιλαμβάνεται)">
            <input
              type="date"
              value={toDateInput(end)}
              onChange={(e) =>
                onUpdate({
                  ...condition.config,
                  ends_at: e.target.value
                    ? toEndOfDayISO(e.target.value)
                    : null,
                })
              }
              className="cms-input"
            />
          </Field>
        </div>
      ) : (
        <Field label="Ημέρα">
          <input
            type="date"
            value={toDateInput(start)}
            onChange={(e) => {
              const v = e.target.value;
              onUpdate({
                starts_at: v ? toStartOfDayISO(v) : null,
                ends_at: v ? toEndOfDayISO(v) : null,
              });
            }}
            className="cms-input"
          />
        </Field>
      )}
    </div>
  );
}

function UserTypeForm({
  condition,
  onUpdate,
}: {
  condition: Extract<RuleCondition, { kind: "user_type" }>;
  onUpdate: (config: Record<string, unknown>) => void;
}) {
  const value = condition.config.value;
  const customerId =
    value === "individual"
      ? (condition.config as { customer_id: string | null }).customer_id
      : null;

  return (
    <div className="space-y-3">
      <Field label="Σε ποιον εφαρμόζεται">
        <select
          value={value}
          onChange={(e) => {
            const next = e.target.value as
              | "guest"
              | "authenticated"
              | "individual";
            if (next === "individual") {
              onUpdate({ value: "individual", customer_id: null });
            } else {
              onUpdate({ value: next });
            }
          }}
          className="cms-input"
        >
          <option value="guest">Επισκέπτες (μη εγγεγραμμένοι)</option>
          <option value="authenticated">
            Λογαριασμοί (όλοι οι εγγεγραμμένοι)
          </option>
          <option value="individual">Συγκεκριμένος χρήστης</option>
        </select>
      </Field>
      {value === "individual" && (
        <Field label="UUID πελάτη">
          <input
            type="text"
            value={customerId ?? ""}
            onChange={(e) =>
              onUpdate({
                value: "individual",
                customer_id: e.target.value || null,
              })
            }
            placeholder="UUID από τη λίστα πελατών"
            className="cms-input font-mono text-xs"
          />
        </Field>
      )}
    </div>
  );
}

function AvailableQuantityForm({
  condition,
  onUpdate,
}: {
  condition: Extract<RuleCondition, { kind: "available_quantity" }>;
  onUpdate: (config: Record<string, unknown>) => void;
}) {
  const { mode, scope_kind, scope_id } = condition.config;

  return (
    <div className="space-y-3">
      <Field label="Τρόπος">
        <select
          value={mode}
          onChange={(e) => {
            const next = e.target.value as "range" | "until_oos";
            if (next === "until_oos") {
              onUpdate({ mode: "until_oos", scope_kind, scope_id });
            } else {
              onUpdate({
                mode: "range",
                min: 0,
                max: 5,
                scope_kind,
                scope_id,
              });
            }
          }}
          className="cms-input"
        >
          <option value="until_oos">Μέχρι εξαντλήσεως (απόθεμα &gt; 0)</option>
          <option value="range">Εντός εύρους ποσοτήτων</option>
        </select>
      </Field>
      {mode === "range" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ελάχιστο απόθεμα">
            <input
              type="number"
              step="1"
              min="0"
              value={condition.config.min}
              onChange={(e) =>
                onUpdate({
                  ...condition.config,
                  min: parseInt(e.target.value, 10) || 0,
                })
              }
              className="cms-input w-32"
            />
          </Field>
          <Field label="Μέγιστο απόθεμα (κενό = χωρίς όριο)">
            <input
              type="number"
              step="1"
              min="0"
              value={condition.config.max ?? ""}
              onChange={(e) =>
                onUpdate({
                  ...condition.config,
                  max: e.target.value ? parseInt(e.target.value, 10) : null,
                })
              }
              className="cms-input w-32"
            />
          </Field>
        </div>
      )}
      <Field label="Σε τι μετριέται το απόθεμα">
        <select
          value={scope_kind}
          onChange={(e) =>
            onUpdate({
              ...condition.config,
              scope_kind: e.target.value as "variant" | "product",
            })
          }
          className="cms-input"
        >
          <option value="variant">Συγκεκριμένη παραλλαγή</option>
          <option value="product">Όλες οι παραλλαγές προϊόντος</option>
        </select>
      </Field>
      <Field label="UUID αναφοράς">
        <input
          type="text"
          value={scope_id ?? ""}
          onChange={(e) =>
            onUpdate({ ...condition.config, scope_id: e.target.value || null })
          }
          className="cms-input font-mono text-xs"
          placeholder="UUID της παραλλαγής/προϊόντος"
        />
        {!scope_id && (
          <p className="text-xs text-muted-foreground mt-1">
            Όσο δεν έχει συμπληρωθεί, ο κανόνας δεν εφαρμόζεται.
          </p>
        )}
      </Field>
    </div>
  );
}

export function ConditionPicker({
  existingKinds,
  onCancel,
  onPick,
}: {
  existingKinds: Set<RuleConditionKind>;
  onCancel: () => void;
  onPick: (kind: RuleConditionKind) => void;
}) {
  const available = ALL_CONDITION_KINDS.filter((k) => !existingKinds.has(k));
  return (
    <div className="border border-border rounded p-3 mt-2 bg-muted/30">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium">Επιλογή τύπου συνθήκης</h4>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          Ακύρωση
        </button>
      </div>
      {available.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Όλοι οι διαθέσιμοι τύποι έχουν ήδη προστεθεί.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {available.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onPick(k)}
              className="text-left text-sm px-3 py-2 bg-background border border-border rounded hover:bg-muted transition"
            >
              {CONDITION_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Code card (per-rule attached code with limits config) ──────────

export function CodeCardItem({
  code,
  affiliates,
  onUpdate,
  onDelete,
}: {
  code: Code;
  affiliates: Affiliate[];
  onUpdate: (
    patch: Partial<{
      affiliate_id: string | null;
      max_uses_total: number | null;
      max_uses_per_customer: number | null;
      enforce_limits: boolean;
      active: boolean;
    }>
  ) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="border border-border rounded p-3 bg-background">
      <div className="flex items-center gap-2">
        <code className="font-mono text-sm flex-1">{code.code}</code>
        {code.max_uses_total !== null && (
          <span className="text-xs text-muted-foreground">
            {code.current_uses}/{code.max_uses_total}
          </span>
        )}
        {!code.active && (
          <span className="text-xs text-muted-foreground italic">ανενεργός</span>
        )}
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Σύμπτυξη" : "Όρια & ρυθμίσεις"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive text-xs"
          aria-label="Διαγραφή κωδικού"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="mt-3 grid grid-cols-2 gap-3 pt-3 border-t border-border">
          <Field label="Συνολικές χρήσεις (όλοι μαζί)">
            <input
              type="number"
              min="1"
              value={code.max_uses_total ?? ""}
              placeholder="χωρίς όριο"
              onChange={(e) =>
                onUpdate({
                  max_uses_total: e.target.value
                    ? parseInt(e.target.value, 10)
                    : null,
                })
              }
              className="cms-input"
            />
          </Field>
          <Field label="Χρήσεις ανά πελάτη">
            <input
              type="number"
              min="1"
              value={code.max_uses_per_customer ?? ""}
              placeholder="χωρίς όριο"
              onChange={(e) =>
                onUpdate({
                  max_uses_per_customer: e.target.value
                    ? parseInt(e.target.value, 10)
                    : null,
                })
              }
              className="cms-input"
            />
          </Field>
          <Field label="Συνεργάτης">
            <select
              value={code.affiliate_id ?? ""}
              onChange={(e) =>
                onUpdate({ affiliate_id: e.target.value || null })
              }
              className="cms-input"
            >
              <option value="">(χωρίς συνεργάτη)</option>
              {affiliates.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm pt-1.5">
            <input
              type="checkbox"
              checked={code.active}
              onChange={(e) => onUpdate({ active: e.target.checked })}
            />
            Ενεργός
          </label>
          <div className="col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={code.enforce_limits}
                onChange={(e) => onUpdate({ enforce_limits: e.target.checked })}
              />
              Αυστηρή επιβολή ορίων
            </label>
            <p className="text-xs text-muted-foreground mt-1 ml-6">
              Όταν είναι off, ο κωδικός εφαρμόζεται ακόμη και αν περάσει τα όρια.
            </p>
          </div>
        </div>
      )}
    </li>
  );
}

// Re-export the types consumers want to use
export type { Rule, RuleAction, RuleCondition, RuleScope, Code, Affiliate, Category };
