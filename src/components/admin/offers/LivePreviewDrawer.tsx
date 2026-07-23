"use client";

import { useEffect, useState, useTransition } from "react";
import { X, Loader2, Check, AlertTriangle } from "lucide-react";
import { previewEvaluation, traceRule, type RuleTrace } from "@/actions/offers";
import { Field } from "./_editorParts";
import type { EvalResult, Rule } from "@/types/offers";
import type { Category } from "@/types/category-navigation";

interface Props {
  /** The rule being edited — used to highlight whether it specifically
   *  fires for the simulated cart. */
  rule: Rule;
  categories: Category[];
  onClose: () => void;
}

// Synthetic UUIDs used as preview-line identifiers. Real product/variant
// UUIDs will never collide with these (probability ~ 0). Rules scoped
// to a specific product_id or variant_id won't match these — that's
// intentional; admins testing such rules need a real variant picker
// (Phase 3b extension).
const PREVIEW_VARIANT_UUID = "00000000-0000-0000-0000-000000000001";
const PREVIEW_PRODUCT_UUID = "00000000-0000-0000-0000-000000000002";

type CustomerMode = "guest" | "authenticated" | "individual";

/**
 * Live-preview drawer — slides in from the right of the rule editor,
 * shows a mock cart with editable inputs, and re-runs the offers engine
 * (read-only) every time any input changes (400ms debounce).
 *
 * What admins can verify:
 *   ✓ Category-scoped rules        (set category in cart)
 *   ✓ "All products" scoped rules  (any cart triggers)
 *   ✓ Min subtotal / item count    (set those values)
 *   ✓ Time-based conditions        (set evaluation date)
 *   ✓ User-type conditions         (set customer mode)
 *   ✓ Code-required rules          (paste code into the codes input)
 *
 * What needs a real variant (deferred to Phase 3b):
 *   ✗ Product / variant-scoped rules
 *   ✗ available_quantity conditions (no real stock available)
 */
export default function LivePreviewDrawer({
  rule,
  categories,
  onClose,
}: Props) {
  const [isPending, startTransition] = useTransition();

  const [subtotal, setSubtotal] = useState(50);
  const [itemCount, setItemCount] = useState(2);
  const [categoryId, setCategoryId] = useState<string>(
    categories[0]?.id ?? ""
  );
  const [customerMode, setCustomerMode] = useState<CustomerMode>("authenticated");
  const [customerId, setCustomerId] = useState("");
  const [evaluationDate, setEvaluationDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [codesText, setCodesText] = useState("");

  const [result, setResult] = useState<EvalResult | null>(null);
  const [trace, setTrace] = useState<RuleTrace | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounced re-eval on any input change. The 400ms debounce keeps
  // the engine quiet while the admin types (every keystroke would
  // otherwise fire the server action).
  useEffect(() => {
    const t = setTimeout(() => {
      const cartPayload = {
        lines: [
          {
            variant_id: PREVIEW_VARIANT_UUID,
            product_id: PREVIEW_PRODUCT_UUID,
            category_ids: categoryId ? [categoryId] : [],
            quantity: itemCount,
            unit_price: itemCount > 0 ? subtotal / itemCount : subtotal,
          },
        ],
        subtotal,
        itemCount,
        customerId:
          customerMode === "individual" ? customerId || null : null,
        isAuthenticated: customerMode !== "guest",
        codes: codesText
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
        evaluationTime: new Date(evaluationDate).toISOString(),
      };
      startTransition(async () => {
        // Run both in parallel — one round-trip for the engine eval,
        // one for the per-condition trace of THIS rule. Both feed
        // distinct parts of the result panel below.
        const [evalRes, traceRes] = await Promise.all([
          previewEvaluation(cartPayload),
          traceRule({ ruleId: rule.id, cart: cartPayload }),
        ]);
        if (!evalRes.success) {
          setError(evalRes.error);
          return;
        }
        if (!traceRes.success) {
          setError(traceRes.error);
          return;
        }
        setError(null);
        setResult(evalRes.data);
        setTrace(traceRes.data);
      });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    subtotal,
    itemCount,
    categoryId,
    customerMode,
    customerId,
    evaluationDate,
    codesText,
    rule.id,
  ]);

  // Whether the rule being edited specifically fired in the result.
  const currentRuleApplied =
    result?.applied.some((a) => a.rule_id === rule.id) ?? false;
  const otherRulesApplied =
    (result?.applied.length ?? 0) - (currentRuleApplied ? 1 : 0);

  const total = Math.max(0, subtotal - (result?.total_discount ?? 0));

  return (
    <aside
      className="fixed right-0 top-0 h-screen w-[400px] max-w-[92vw] bg-background border-l border-border shadow-2xl z-40 overflow-y-auto"
      aria-label="Δοκιμή κανόνα"
    >
      <header className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Δοκιμή</h3>
          <p className="text-xs text-muted-foreground">
            Έλεγχος αν εφαρμόζεται ο κανόνας
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Κλείσιμο"
          className="text-muted-foreground hover:text-foreground p-1"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="px-4 py-4 space-y-5">
        {/* ── Cart inputs ── */}
        <section>
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Δοκιμαστικό καλάθι
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Σύνολο (€)">
              <input
                type="number"
                step="0.01"
                min="0"
                value={subtotal}
                onChange={(e) => setSubtotal(Number(e.target.value) || 0)}
                className="cms-input"
              />
            </Field>
            <Field label="Πλήθος προϊόντων">
              <input
                type="number"
                step="1"
                min="1"
                value={itemCount}
                onChange={(e) =>
                  setItemCount(parseInt(e.target.value, 10) || 1)
                }
                className="cms-input"
              />
            </Field>
          </div>
          <Field label="Κατηγορία προϊόντος">
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="cms-input"
            >
              <option value="">— χωρίς κατηγορία —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </section>

        {/* ── Customer ── */}
        <section>
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Πελάτης
          </h4>
          <Field label="Τύπος">
            <select
              value={customerMode}
              onChange={(e) => setCustomerMode(e.target.value as CustomerMode)}
              className="cms-input"
            >
              <option value="guest">Επισκέπτης (μη εγγεγραμμένος)</option>
              <option value="authenticated">Εγγεγραμμένος λογαριασμός</option>
              <option value="individual">Συγκεκριμένος χρήστης</option>
            </select>
          </Field>
          {customerMode === "individual" && (
            <Field label="UUID πελάτη">
              <input
                type="text"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="UUID από /admin/customers"
                className="cms-input font-mono text-xs"
              />
            </Field>
          )}
        </section>

        {/* ── Time + codes ── */}
        <section>
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Πλαίσιο
          </h4>
          <Field label="Ημερομηνία αξιολόγησης">
            <input
              type="date"
              value={evaluationDate}
              onChange={(e) => setEvaluationDate(e.target.value)}
              className="cms-input"
            />
          </Field>
          <Field label="Κωδικοί (χωρίς #, διαχωρισμός με κόμμα)">
            <input
              type="text"
              value={codesText}
              onChange={(e) => setCodesText(e.target.value)}
              placeholder="BLACKFRIDAY, WELCOME10"
              className="cms-input font-mono"
            />
          </Field>
        </section>

        {/* ── Result ── */}
        <section
          className={`rounded-lg border p-3 ${
            currentRuleApplied
              ? "border-emerald-200 bg-emerald-50/50"
              : result
                ? "border-amber-200 bg-amber-50/30"
                : "border-border bg-muted/20"
          }`}
        >
          <header className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              Αποτέλεσμα
              {isPending && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              )}
            </h4>
          </header>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
              {error}
            </p>
          )}

          {!error && !result && (
            <p className="text-xs text-muted-foreground italic">
              Φόρτωση…
            </p>
          )}

          {!error && result && (
            <>
              {/* Verdict */}
              <div className="mb-3">
                {currentRuleApplied ? (
                  <p className="text-sm font-semibold text-emerald-700">
                    ✓ Ο κανόνας «{rule.name}» εφαρμόζεται
                  </p>
                ) : (
                  <p className="text-sm font-semibold text-amber-800">
                    ✗ Ο κανόνας «{rule.name}» δεν εφαρμόζεται
                  </p>
                )}
                {otherRulesApplied > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {otherRulesApplied} άλλος/οι κανόνας/ες εφαρμόζονται επίσης
                  </p>
                )}
              </div>

              {/* Totals */}
              <div className="grid grid-cols-3 gap-2 text-xs tabular-nums pt-2 border-t border-border">
                <div>
                  <div className="text-muted-foreground">Υποσύνολο</div>
                  <div className="font-semibold">€{subtotal.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Έκπτωση</div>
                  <div className="font-semibold text-emerald-700">
                    −€{result.total_discount.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Σύνολο</div>
                  <div className="font-semibold">€{total.toFixed(2)}</div>
                </div>
              </div>

              {/* Fee waivers */}
              {(result.total_fee_waiver.shipping > 0 ||
                result.total_fee_waiver.cod > 0) && (
                <div className="mt-2 pt-2 border-t border-border text-xs">
                  <div className="text-muted-foreground mb-1">
                    Εξαιρέσεις εξόδων υπηρεσιών:
                  </div>
                  {result.total_fee_waiver.shipping > 0 && (
                    <div>· Αποστολή: δωρεάν</div>
                  )}
                  {result.total_fee_waiver.cod > 0 && (
                    <div>· Αντικαταβολή: δωρεάν</div>
                  )}
                </div>
              )}

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border text-xs space-y-1">
                  {result.warnings.map((w, i) => (
                    <p key={i} className="text-amber-800">
                      ⚠ {w.message}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* ── Per-condition trace ─────────────────────────────────── */}
        {trace && (
          <section>
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Ανάλυση κανόνα
            </h4>
            <ul className="space-y-1.5 border border-border rounded-lg overflow-hidden bg-card">
              {trace.steps.map((step, i) => (
                <li
                  key={i}
                  className={`flex items-start gap-2 px-3 py-2 text-xs ${
                    i > 0 ? "border-t border-border" : ""
                  } ${step.passed ? "" : "bg-amber-50/40"}`}
                >
                  <span className="shrink-0 mt-0.5">
                    {step.passed ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground/90">
                      {step.name}
                    </div>
                    <div
                      className={`mt-0.5 ${
                        step.passed
                          ? "text-muted-foreground"
                          : "text-amber-900"
                      }`}
                    >
                      {step.detail}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-[10px] text-muted-foreground italic">
          Read-only προεπισκόπηση — δεν αυξάνει counters χρήσεων ούτε
          δημιουργεί παραγγελία. Για πραγματικό έλεγχο, κάντε δοκιμαστική
          παραγγελία.
        </p>
      </div>
    </aside>
  );
}
