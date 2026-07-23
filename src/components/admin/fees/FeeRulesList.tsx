"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FeeRuleForm from "./FeeRuleForm";
import { deleteFeeRule } from "@/actions/fees";
import { Pencil } from "@/components/admin/common/icons";
import type { FeeCategory, FeeRule } from "@/types/fee";

interface Props {
  category: FeeCategory;
  rules: FeeRule[];
}

const SCOPE_LABELS: Record<string, string> = {
  global: "Όλα τα προϊόντα",
  category: "Κατηγορία",
  product: "Προϊόν",
  variant: "Παραλλαγή",
};

/**
 * Rules table for a fee category. Each row can be inline-edited
 * (expands into a sub-row with the rule form); the table uses the
 * shared cms-table styling so it matches every other admin list.
 */
export default function FeeRulesList({ category, rules }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  function remove(rule: FeeRule) {
    setError(null);
    if (!confirm("Διαγραφή κανόνα;")) return;
    startTransition(async () => {
      const r = await deleteFeeRule({ id: rule.id });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          Κανόνες ({rules.length})
        </h3>
        {!showNew && (
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="btn btn-secondary btn-sm"
          >
            <span className="text-base leading-none">+</span> Νέος κανόνας
          </button>
        )}
      </header>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {rules.length === 0 && !showNew && (
        <div className="cms-empty">
          Κανένας κανόνας. Χωρίς κανόνα, η κατηγορία δεν χρεώνει τίποτα.
        </div>
      )}

      {rules.length > 0 && (
        <div className="cms-table-wrap">
          <table className="cms-table">
            <thead>
              <tr>
                <th>Scope</th>
                <th className="text-center">Ποσό</th>
                <th>Filters</th>
                <th className="text-center">Προτεραιότητα</th>
                <th>Σύνθεση</th>
                <th>Κατάσταση</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  category={category}
                  isEditing={editingId === rule.id}
                  onEdit={() => setEditingId(rule.id)}
                  onCloseEdit={() => setEditingId(null)}
                  onDelete={() => remove(rule)}
                  isPending={isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <div className="rounded-md border border-foreground/15 bg-muted/20 p-4">
          <h4 className="text-sm font-semibold mb-3">Νέος κανόνας</h4>
          <FeeRuleForm category={category} onDone={() => setShowNew(false)} />
          <button
            type="button"
            onClick={() => setShowNew(false)}
            className="mt-3 text-xs text-muted-foreground hover:text-foreground underline"
          >
            Ακύρωση
          </button>
        </div>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  category,
  isEditing,
  onEdit,
  onCloseEdit,
  onDelete,
  isPending,
}: {
  rule: FeeRule;
  category: FeeCategory;
  isEditing: boolean;
  onEdit: () => void;
  onCloseEdit: () => void;
  onDelete: () => void;
  isPending: boolean;
}) {
  const filters: string[] = [];
  if (rule.applies_to_payment_methods?.length)
    filters.push(`pay: ${rule.applies_to_payment_methods.join(", ")}`);
  if (rule.applies_to_delivery_methods?.length)
    filters.push(`deliv: ${rule.applies_to_delivery_methods.join(", ")}`);
  if (rule.applies_to_carriers?.length)
    filters.push(`carrier: ${rule.applies_to_carriers.join(", ")}`);

  return (
    <>
      <tr className={!rule.active ? "opacity-60" : ""}>
        <td>
          <p className="font-medium">
            {SCOPE_LABELS[rule.scope_type] ?? rule.scope_type}
          </p>
          {rule.scope_id && (
            <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
              {rule.scope_id.slice(0, 8)}…
            </p>
          )}
        </td>
        <td className="text-center font-mono tabular-nums">
          {rule.rate_type === "percentage"
            ? `${rule.amount}%`
            : `€${Number(rule.amount).toFixed(2)}`}
        </td>
        <td className="text-muted-foreground text-xs">
          {filters.length === 0 ? "—" : filters.join(" · ")}
        </td>
        <td className="text-center font-mono tabular-nums">{rule.priority}</td>
        <td className="text-xs">{rule.combination}</td>
        <td>
          {rule.active ? (
            <span className="cms-badge cms-badge-neutral">
              <span className="cms-badge-dot" aria-hidden />
              Ενεργός
            </span>
          ) : (
            <span className="cms-badge cms-badge-muted">Ανενεργός</span>
          )}
        </td>
        <td className="text-center">
          <div className="flex items-center justify-center gap-1.5">
            <button
              type="button"
              onClick={isEditing ? onCloseEdit : onEdit}
              className="btn btn-secondary btn-sm"
            >
              {isEditing ? (
                "Κλείσιμο"
              ) : (
                <>
                  <Pencil className="w-3.5 h-3.5" />
                  Επεξεργασία
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={isPending}
              className="btn btn-destructive btn-sm"
              aria-label="Διαγραφή κανόνα"
            >
              ✕
            </button>
          </div>
        </td>
      </tr>
      {isEditing && (
        <tr>
          <td colSpan={7} className="bg-muted/20">
            <div className="px-4 py-4">
              <FeeRuleForm
                category={category}
                initial={rule}
                onDone={onCloseEdit}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
