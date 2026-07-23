"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import {
  updateOffer,
  deleteOffer,
  assignRuleToOffer,
  unassignRuleFromOffer,
  attachCode,
  detachCode,
  createCode,
} from "@/actions/offers";
import { BinIcon } from "./_editorParts";
import OfferSentence from "./OfferSentence";
import type {
  Affiliate,
  Code,
  Offer,
  Rule,
} from "@/types/offers";

interface Props {
  offer: Offer;
  /** All rules in the system (so admin can attach any). */
  allRules: Rule[];
  /** Subset that's currently assigned to THIS offer. */
  memberRuleIds: string[];
  /** Codes attached directly to this offer (target_kind='offer'). */
  attachedCodes: Code[];
  /** Codes in the system that are NOT yet attached to this offer (for picker). */
  detachedCodes: Code[];
  /** Active affiliates — for the code-edit popovers' affiliate dropdown. */
  affiliates: Affiliate[];
  /** Collapse the inline editor back to its card on the bench. */
  onClose: () => void;
  /** Called after successful delete so the bench can clear its
   *  expansion state. */
  onDeleted: () => void;
  /** Hop to a member rule's inline editor without leaving the page.
   *  Wired by the bench to its expandRule helper. */
  onOpenRule?: (ruleId: string) => void;
}

/**
 * Inline offer editor — embedded into the lab bench when an offer
 * card is clicked. Owns local state for the offer + its rule
 * assignments + code attachments. No standalone route version
 * — Phase 4f removed `/admin/discounts/offers/[id]` entirely.
 */
export default function OfferEditorClient(props: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [offer, setOffer] = useState<Offer>(props.offer);
  const [memberRuleIds, setMemberRuleIds] = useState<string[]>(
    props.memberRuleIds
  );
  const [attachedCodes, setAttachedCodes] = useState<Code[]>(
    props.attachedCodes
  );
  const [error, setError] = useState<string | null>(null);

  function flashError(msg: string) {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  }

  function patchOffer(patch: Partial<Offer>) {
    setOffer((o) => ({ ...o, ...patch }));
    startTransition(async () => {
      const r = await updateOffer({
        id: offer.id,
        ...(patch as Record<string, unknown>),
      });
      if (!r.success) flashError(r.error);
    });
  }
  function handleDelete() {
    if (
      !confirm(
        "Διαγραφή προσφοράς; Οι κανόνες της παραμένουν — γίνονται απλώς ανεξάρτητοι."
      )
    )
      return;
    startTransition(async () => {
      const r = await deleteOffer({ id: offer.id });
      if (!r.success) return flashError(r.error);
      props.onDeleted();
    });
  }
  async function handleAssignRule(rule_id: string) {
    const r = await assignRuleToOffer({ rule_id, offer_id: offer.id });
    if (!r.success) return flashError(r.error);
    setMemberRuleIds((m) => Array.from(new Set([...m, rule_id])));
  }
  async function handleUnassignRule(rule_id: string) {
    const r = await unassignRuleFromOffer({ rule_id, offer_id: offer.id });
    if (!r.success) return flashError(r.error);
    setMemberRuleIds((m) => m.filter((id) => id !== rule_id));
  }
  async function handleAttachCode(code: Code) {
    const r = await attachCode({
      code_id: code.id,
      target_kind: "offer",
      target_id: offer.id,
    });
    if (!r.success) return flashError(r.error);
    setAttachedCodes((cs) => [...cs, code]);
  }
  async function handleDetachCode(code: Code) {
    const r = await detachCode({
      code_id: code.id,
      target_kind: "offer",
      target_id: offer.id,
    });
    if (!r.success) return flashError(r.error);
    setAttachedCodes((cs) => cs.filter((c) => c.id !== code.id));
  }

  return (
    <div className="space-y-6">
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
        <span className="text-xs text-muted-foreground ml-auto">Προσφορά</span>
      </div>

      <div>
        <div className="flex items-start gap-3">
          <input
            type="text"
            value={offer.name}
            onChange={(e) => patchOffer({ name: e.target.value })}
            className="cms-input text-lg font-semibold flex-1"
            placeholder="Όνομα προσφοράς"
            maxLength={200}
          />
          <label className="flex items-center gap-2 text-sm whitespace-nowrap pt-2">
            <input
              type="checkbox"
              checked={offer.active}
              onChange={(e) => patchOffer({ active: e.target.checked })}
            />
            Ενεργή
          </label>
          <button
            type="button"
            onClick={handleDelete}
            className="btn btn-ghost btn-sm text-destructive"
            title="Διαγραφή προσφοράς (οι κανόνες παραμένουν)"
            aria-label="Διαγραφή προσφοράς"
          >
            <BinIcon />
          </button>
        </div>
        <textarea
          value={offer.description ?? ""}
          onChange={(e) =>
            patchOffer({ description: e.target.value || null })
          }
          className="cms-input mt-2 w-full"
          placeholder="Περιγραφή (προαιρετική)"
          rows={2}
          maxLength={2000}
        />
      </div>

      {/* The sentence IS the editor (Phase 2c). Rules + codes are chips
          with popovers; "+" buttons open pickers. Mirrors the rule
          editor's structure for consistency. */}
      <OfferSentence
        offer={offer}
        allRules={props.allRules}
        memberRuleIds={memberRuleIds}
        attachedCodes={attachedCodes}
        detachedCodes={props.detachedCodes.filter(
          (c) => !attachedCodes.some((a) => a.id === c.id)
        )}
        affiliates={props.affiliates ?? []}
        onOpenRule={props.onOpenRule}
        onAssignRule={handleAssignRule}
        onUnassignRule={handleUnassignRule}
        onAttachCode={handleAttachCode}
        onCreateAndAttachCode={async (text) => {
          const create = await createCode({ code: text });
          if (!create.success) return flashError(create.error);
          const attach = await attachCode({
            code_id: create.data.id,
            target_kind: "offer",
            target_id: offer.id,
          });
          if (!attach.success) return flashError(attach.error);
          setAttachedCodes((cs) => [...cs, create.data]);
          router.refresh();
        }}
        onDetachCode={async (codeId) => {
          const c = attachedCodes.find((x) => x.id === codeId);
          if (c) await handleDetachCode(c);
        }}
        onUpdateCode={async (id, patch) => {
          // Local optimistic update of the attached codes list.
          setAttachedCodes((cs) =>
            cs.map((c) => (c.id === id ? ({ ...c, ...patch } as Code) : c))
          );
          // Server call via updateCode (standalone codes action).
          const { updateCode } = await import("@/actions/offers");
          const r = await updateCode({
            id,
            ...(patch as Record<string, unknown>),
          });
          if (!r.success) flashError(r.error);
        }}
      />

      {error && (
        <div className="fixed bottom-6 right-6 bg-destructive text-white text-sm px-4 py-2 rounded shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
}
