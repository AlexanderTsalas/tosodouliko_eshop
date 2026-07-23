"use client";

import { useState, useTransition, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  updateCustomFieldBinding,
  deleteCustomFieldBinding,
} from "@/actions/custom-fields";
import WorkshopToggle from "@/components/admin/common/WorkshopToggle";
import BinButton from "@/components/admin/common/BinButton";
import type {
  ResolvedCustomFieldBinding,
  CustomFieldScopeKind,
} from "@/types/custom-fields";

interface Props {
  binding: ResolvedCustomFieldBinding;
  /** Resolved name of the scope target (e.g. category name) — used in
   *  the read-only scope display. The bench resolves UUIDs upstream. */
  scopeTargetName: string;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Inline editor for a single scope binding. The target (field/group)
 * and scope (kind + resource_id) are immutable here — to change them,
 * delete and recreate. Only `active` and `override_required` are
 * editable.
 */
export default function BindingEditor({
  binding,
  scopeTargetName,
  onClose,
  onDeleted,
}: Props) {
  const [, startTransition] = useTransition();
  const [active, setActive] = useState(binding.active);
  const [overrideRequired, setOverrideRequired] = useState(
    binding.override_required
  );
  const [error, setError] = useState<string | null>(null);

  const targetName = binding.field
    ? (binding.field.label_translations.el ?? binding.field.key)
    : (binding.group?.name_translations.el ?? "(χωρίς όνομα)");
  const targetIsGroup = !!binding.group;

  function flashError(msg: string) {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  }

  function patchActive(next: boolean) {
    setActive(next);
    startTransition(async () => {
      const r = await updateCustomFieldBinding({
        id: binding.id,
        active: next,
      });
      if (!r.success) {
        setActive(!next);
        flashError(r.error);
      }
    });
  }

  function patchOverride(next: boolean | null) {
    setOverrideRequired(next);
    startTransition(async () => {
      const r = await updateCustomFieldBinding({
        id: binding.id,
        override_required: next,
      });
      if (!r.success) {
        setOverrideRequired(binding.override_required);
        flashError(r.error);
      }
    });
  }

  function handleDelete() {
    if (!confirm("Διαγραφή σύνδεσης;")) return;
    startTransition(async () => {
      const r = await deleteCustomFieldBinding({ id: binding.id });
      if (!r.success) return flashError(r.error);
      onDeleted();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 pb-3 border-b border-border">
        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost btn-sm flex items-center gap-1.5"
          aria-label="Κλείσιμο επεξεργασίας"
        >
          <X className="w-4 h-4" />
          <span>Κλείσιμο</span>
        </button>
        <WorkshopToggle
          active={active}
          onChange={patchActive}
          ariaLabel="Ενεργή σύνδεση"
        />
        <BinButton onClick={handleDelete} ariaLabel="Διαγραφή σύνδεσης" />
      </div>

      {/* Read-only scope + target (immutable post-creation) */}
      <Section title="Σύνδεση">
        <p className="text-sm leading-relaxed">
          <span className="text-muted-foreground">Στο </span>
          <span className="inline-flex items-center px-1.5 py-0 rounded border text-xs font-medium align-baseline bg-amber-50 border-amber-200 text-amber-800">
            {scopeKindLabel(binding.scope_kind)}: {scopeTargetName}
          </span>
          <span className="text-muted-foreground">
            {" "}
            εφαρμόζεται{targetIsGroup ? " η ομάδα" : " το πεδίο"}{" "}
          </span>
          <span className="inline-flex items-center px-1.5 py-0 rounded border text-xs font-medium align-baseline bg-sky-50 border-sky-200 text-sky-800">
            {targetName}
          </span>
          <span className="text-muted-foreground">.</span>
        </p>
      </Section>

      {/* Override required — only relevant for field bindings (groups
          have no per-binding required override). */}
      {binding.field && (
        <Section title="Υποχρεωτικό σε αυτό το scope">
          <div className="flex gap-1">
            <SegBtn
              active={overrideRequired === null}
              onClick={() => patchOverride(null)}
            >
              Κληρονομικό
              {binding.field.required_default ? " (υποχρεωτικό)" : " (προαιρετικό)"}
            </SegBtn>
            <SegBtn
              active={overrideRequired === true}
              onClick={() => patchOverride(true)}
            >
              Υποχρεωτικό
            </SegBtn>
            <SegBtn
              active={overrideRequired === false}
              onClick={() => patchOverride(false)}
            >
              Προαιρετικό
            </SegBtn>
          </div>
        </Section>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-xs px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </h4>
      {children}
    </section>
  );
}

function SegBtn({
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
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function scopeKindLabel(k: CustomFieldScopeKind): string {
  switch (k) {
    case "category":
      return "Κατηγορία";
    case "product":
      return "Προϊόν";
    case "variant":
      return "Παραλλαγή";
  }
}
