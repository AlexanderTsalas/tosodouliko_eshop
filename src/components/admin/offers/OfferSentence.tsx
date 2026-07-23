"use client";

import { useState } from "react";
import Popover from "./_Popover";
import { Chip, AddChipButton } from "./_chips";
import { Field, ruleKindShort } from "./_editorParts";
import type { Affiliate, Code, Offer, Rule } from "@/types/offers";

interface Props {
  offer: Offer;
  /** All rules in the system (not just members) — needed for the
   *  "add rule" picker to show non-member options. */
  allRules: Rule[];
  /** Subset that's currently in this offer. */
  memberRuleIds: string[];
  /** Codes attached directly to this offer. */
  attachedCodes: Code[];
  /** Codes in the system NOT yet attached to this offer (picker source). */
  detachedCodes: Code[];
  affiliates: Affiliate[];

  // ── Mutation handlers ─────────────────────────────────────────────
  onAssignRule: (rule_id: string) => Promise<void>;
  onUnassignRule: (rule_id: string) => Promise<void>;
  onAttachCode: (code: Code) => Promise<void>;
  onCreateAndAttachCode: (text: string) => Promise<void>;
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
  /** When provided, the rule-chip popover shows an "Άνοιγμα κανόνα"
   *  button that calls this with the rule id. The bench wires this to
   *  expandRule() so clicking jumps to the inline rule editor. */
  onOpenRule?: (ruleId: string) => void;
}

/**
 * Greek-sentence rendering of an offer's composition.
 *
 * Pattern mirrors RuleSentence: the offer reads as prose with chips
 * for each member rule and each attached code; clicking a chip opens
 * a popover with the relevant editor; "+ X" inline affordances add
 * new pieces.
 *
 * Sentence shape:
 *   "Ομαδοποιεί τους κανόνες [Rule A] και [Rule B] [+ κανόνας].
 *    Ενεργοποιείται με τους κωδικούς [#X] ή [#Y] [+ κωδικός]."
 *
 * The codes line is omitted entirely when the offer has no codes —
 * member rules will still apply auto-magically if their `requires_code`
 * is false, so no codes is a valid resting state.
 */
export default function OfferSentence({
  offer,
  allRules,
  memberRuleIds,
  attachedCodes,
  detachedCodes,
  affiliates,
  onAssignRule,
  onUnassignRule,
  onAttachCode,
  onCreateAndAttachCode,
  onDetachCode,
  onUpdateCode,
  onOpenRule,
}: Props) {
  void offer;
  const memberRules = allRules.filter((r) => memberRuleIds.includes(r.id));
  const nonMemberRules = allRules.filter((r) => !memberRuleIds.includes(r.id));

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-5">
      {/* <div> not <p>: chip popovers contain block-level content
          (h4 headers, form fields). <p> would auto-close at the first
          block descendant and break SSR hydration. */}
      <div className="text-[15px] leading-loose text-foreground/90 font-serif">
        {/* Member rules line */}
        {memberRules.length === 0 ? (
          <span className="text-muted-foreground italic">
            Κενή προσφορά —{" "}
          </span>
        ) : (
          <span className="text-muted-foreground">
            Ομαδοποιεί τους κανόνες{" "}
          </span>
        )}
        {memberRules.map((r, i) => (
          <span key={r.id}>
            {i > 0 && <span className="text-muted-foreground"> και </span>}
            <Popover
              width={300}
              trigger={
                <Chip accent="rule" interactive>
                  {r.name}
                </Chip>
              }
            >
              {(close) => (
                <RuleMemberCard
                  rule={r}
                  onUnassign={async () => {
                    await onUnassignRule(r.id);
                    close();
                  }}
                  onOpen={
                    onOpenRule
                      ? () => {
                          onOpenRule(r.id);
                          close();
                        }
                      : undefined
                  }
                />
              )}
            </Popover>
          </span>
        ))}
        {nonMemberRules.length > 0 && (
          <Popover
            width={320}
            trigger={
              <AddChipButton
                label={
                  memberRules.length === 0 ? "προσθέστε κανόνα" : "κανόνας"
                }
              />
            }
          >
            {(close) => (
              <RulePicker
                candidates={nonMemberRules}
                onPick={async (id) => {
                  await onAssignRule(id);
                  close();
                }}
              />
            )}
          </Popover>
        )}
        <span className="text-muted-foreground">.</span>

        {/* Codes line — only render the leading text if codes exist OR
            the user wants to add one (we always render the "+" button) */}
        <br />
        {attachedCodes.length > 0 ? (
          <>
            <span className="text-muted-foreground">
              Ενεργοποιείται με τους κωδικούς{" "}
            </span>
            {attachedCodes.map((c, i) => (
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
                    <CodeEditCard
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
        ) : (
          <span className="text-muted-foreground">
            Χωρίς κωδικό — οι κανόνες εφαρμόζονται αυτόματα όταν η προσφορά
            είναι ενεργή.{" "}
          </span>
        )}
        <Popover
          width={340}
          trigger={
            <AddChipButton
              label={
                attachedCodes.length === 0 ? "κωδικός" : "ακόμη κωδικός"
              }
            />
          }
        >
          {(close) => (
            <CodeAttachOrCreateForm
              detachedCodes={detachedCodes}
              onAttachExisting={async (code) => {
                await onAttachCode(code);
                close();
              }}
              onCreateAndAttach={async (text) => {
                await onCreateAndAttachCode(text);
                close();
              }}
            />
          )}
        </Popover>
        {attachedCodes.length > 0 && <span className="text-muted-foreground">.</span>}
      </div>
    </div>
  );
}

// ─── Rule chip popover ──────────────────────────────────────────────

function RuleMemberCard({
  rule,
  onUnassign,
  onOpen,
}: {
  rule: Rule;
  onUnassign: () => Promise<void>;
  onOpen?: () => void;
}) {
  return (
    <div className="space-y-3">
      <header>
        <h4 className="text-sm font-semibold">{rule.name}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          {ruleKindShort(rule.kind)} · {rule.active ? "Ενεργός" : "Ανενεργός"}
        </p>
      </header>
      {onOpen && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="btn btn-secondary btn-sm flex-1"
          >
            Άνοιγμα κανόνα
          </button>
        </div>
      )}
      <div className="pt-2 border-t border-border">
        <button
          type="button"
          onClick={onUnassign}
          className="text-xs text-destructive hover:underline"
        >
          ✕ Αφαίρεση από προσφορά (ο κανόνας δεν διαγράφεται)
        </button>
      </div>
    </div>
  );
}

// ─── Rule picker (add member) ───────────────────────────────────────

function RulePicker({
  candidates,
  onPick,
}: {
  candidates: Rule[];
  onPick: (rule_id: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const q = query.toLowerCase().trim();
  const filtered =
    q.length === 0
      ? candidates
      : candidates.filter((r) => r.name.toLowerCase().includes(q));

  return (
    <div className="space-y-2">
      <header>
        <h4 className="text-sm font-semibold">Προσθήκη κανόνα</h4>
      </header>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Αναζήτηση..."
        className="cms-input"
        autoFocus
      />
      <div className="max-h-64 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-2 py-3">
            Κανείς κανόνας δεν ταιριάζει.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(r.id)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-sm flex items-center gap-2"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      r.active ? "bg-emerald-500" : "bg-muted-foreground/30"
                    }`}
                  />
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {ruleKindShort(r.kind)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Code chip popover ──────────────────────────────────────────────

function CodeEditCard({
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
      <div className="pt-2 border-t border-border">
        <button
          type="button"
          onClick={onDetach}
          className="text-xs text-destructive hover:underline"
        >
          ✕ Αφαίρεση από προσφορά
        </button>
      </div>
    </div>
  );
}

// ─── Code attach-or-create form ─────────────────────────────────────

function CodeAttachOrCreateForm({
  detachedCodes,
  onAttachExisting,
  onCreateAndAttach,
}: {
  detachedCodes: Code[];
  onAttachExisting: (code: Code) => Promise<void>;
  onCreateAndAttach: (text: string) => Promise<void>;
}) {
  const [newText, setNewText] = useState("");
  return (
    <div className="space-y-3">
      <header>
        <h4 className="text-sm font-semibold">Προσθήκη κωδικού</h4>
      </header>
      <Field label="Νέος κωδικός">
        <div className="flex gap-2">
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value.toUpperCase())}
            placeholder="ΝΕΟΣ_ΚΩΔΙΚΟΣ"
            className="cms-input font-mono flex-1"
            maxLength={64}
            autoFocus
          />
          <button
            type="button"
            disabled={!newText.trim()}
            onClick={() => {
              onCreateAndAttach(newText.trim());
              setNewText("");
            }}
            className="btn btn-primary btn-sm"
          >
            Δημιουργία
          </button>
        </div>
      </Field>
      {detachedCodes.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">
            ή επιλέξτε υπάρχοντα:
          </p>
          <div className="max-h-48 overflow-y-auto border border-border rounded">
            {detachedCodes.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onAttachExisting(c)}
                className="w-full text-left px-2 py-1.5 hover:bg-muted text-sm font-mono flex items-center justify-between gap-2"
              >
                <span>#{c.code}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {c.current_uses}
                  {c.max_uses_total !== null
                    ? `/${c.max_uses_total}`
                    : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
