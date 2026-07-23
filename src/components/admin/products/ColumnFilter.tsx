"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Filter, X } from "@/components/admin/common/icons";
import type { TextOp, NumOp } from "@/lib/admin-products-filter/productFilters";

/**
 * Per-column filter control for the products table header.
 *
 * Renders inline next to a column title. Two visual states:
 *   - inactive → a small funnel icon; click opens the editor popover.
 *   - active   → a chip summarising the rule (click to edit) + an ✕ to
 *                clear it.
 *
 * The editor popover is portaled to <body> (escaping the table's stacking
 * context) and anchored under the trigger. "Εφαρμογή" writes the rule into
 * the URL query (resetting pagination); clicking outside discards the draft.
 *
 * Three column kinds:
 *   - text     → name / base_sku: contains / not_contains / empty / not_empty
 *   - numeric  → price: between-range + comparison ops (=, >, <, >=, <=)
 *   - dropdown → category / supplier / volume prefix: multi-select set (any-of)
 *
 * URL params follow AdminProductFilterParams: text uses `<field>` +
 * `<field>Op`; numeric uses priceValue / minPrice / maxPrice / priceOp;
 * dropdown uses a comma-joined id list under `<field>`.
 */

type Option = { id: string; name: string };

export type ColumnFilterDef =
  | { kind: "text"; field: "name" | "baseSku"; label: string }
  | { kind: "numeric"; field: "price"; label: string }
  | {
      kind: "dropdown";
      field: "categoryIds" | "supplierIds" | "volumePrefixIds";
      label: string;
      options: Option[];
    };

const TEXT_OP_LABELS: Record<TextOp, string> = {
  contains: "Περιέχει",
  not_contains: "Δεν περιέχει",
  empty: "Κενό",
  not_empty: "Μη κενό",
};

const NUM_OP_LABELS: Record<NumOp, string> = {
  between: "Ανάμεσα σε",
  eq: "Ίσο με (=)",
  gt: "Μεγαλύτερο (>)",
  lt: "Μικρότερο (<)",
  gte: "Μεγ. ή ίσο (≥)",
  lte: "Μικρ. ή ίσο (≤)",
  empty: "Κενό",
  not_empty: "Μη κενό",
};

const SINGLE_OPERAND = new Set<NumOp>(["eq", "gt", "lt", "gte", "lte"]);
const NO_OPERAND = new Set<string>(["empty", "not_empty"]);
const NUM_SYMBOL: Partial<Record<NumOp, string>> = {
  eq: "=",
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
};

export default function ColumnFilter({ def }: { def: ColumnFilterDef }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // ── Read the current (committed) rule for this column from the URL.
  const current = readCurrent(def, sp);

  // ── Draft editor state, seeded each time the popover opens.
  const [draft, setDraft] = useState(current);
  useEffect(() => {
    if (open) setDraft(readCurrent(def, sp));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close (discard) on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        wrapRef.current &&
        !wrapRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openPopover() {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) {
      // Anchor below the trigger; clamp so the popover stays on-screen.
      const left = Math.min(rect.left, window.innerWidth - 288);
      setPos({ top: rect.bottom + 6, left: Math.max(8, left) });
    }
    setOpen(true);
  }

  function pushParams(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(sp.toString());
    mutate(params);
    params.delete("page"); // result set changed → back to page 1
    const qs = params.toString();
    setOpen(false);
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  function clear() {
    pushParams((params) => writeRule(def, params, emptyDraft()));
  }

  function apply() {
    pushParams((params) => writeRule(def, params, draft));
  }

  const active = isActive(def, current);
  const summary = active ? summarise(def, current) : null;

  const editor = open
    ? createPortal(
        <div
          ref={popoverRef}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          onKeyDown={(e) => {
            // Enter applies the filter from anywhere in the popover.
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
          className="z-[60] w-72 rounded-md border border-foreground/20 bg-card p-3 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.25)] normal-case tracking-normal"
        >
          <p className="text-xs font-semibold text-foreground mb-2">
            {def.label}
          </p>
          <Editor def={def} draft={draft} setDraft={setDraft} />
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-foreground/10">
            <button
              type="button"
              onClick={clear}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Καθαρισμός
            </button>
            <button
              type="button"
              onClick={apply}
              className="btn btn-primary btn-sm"
            >
              Εφαρμογή
            </button>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <span ref={wrapRef} className="inline-flex items-center align-middle">
      {active ? (
        <span className="inline-flex items-center gap-1 ml-1.5 rounded-full bg-primary text-primary-foreground shadow-sm pl-2.5 pr-1 py-0.5 normal-case tracking-normal">
          <Filter className="w-3 h-3 shrink-0 text-primary-foreground/80" />
          <button
            type="button"
            onClick={openPopover}
            title="Επεξεργασία φίλτρου"
            className="text-[11px] font-semibold text-primary-foreground max-w-[140px] truncate hover:underline"
          >
            {summary}
          </button>
          <button
            type="button"
            onClick={clear}
            title="Αφαίρεση φίλτρου"
            aria-label="Αφαίρεση φίλτρου"
            className="inline-flex items-center justify-center w-4 h-4 rounded-full text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/25"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={openPopover}
          title={`Φιλτράρισμα: ${def.label}`}
          aria-label={`Φιλτράρισμα: ${def.label}`}
          className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-foreground/10"
        >
          <Filter className="w-3.5 h-3.5" />
        </button>
      )}
      {editor}
    </span>
  );
}

/* ── Draft model ──────────────────────────────────────────────────── */

interface Draft {
  textOp: TextOp;
  text: string;
  numOp: NumOp;
  value: string;
  min: string;
  max: string;
  ids: string[];
}

function emptyDraft(): Draft {
  return {
    textOp: "contains",
    text: "",
    numOp: "between",
    value: "",
    min: "",
    max: "",
    ids: [],
  };
}

function readCurrent(def: ColumnFilterDef, sp: URLSearchParams): Draft {
  const d = emptyDraft();
  if (def.kind === "text") {
    d.text = sp.get(def.field) ?? "";
    const op = sp.get(`${def.field}Op`) as TextOp | null;
    if (op) d.textOp = op;
  } else if (def.kind === "numeric") {
    d.value = sp.get("priceValue") ?? "";
    d.min = sp.get("minPrice") ?? "";
    d.max = sp.get("maxPrice") ?? "";
    const op = sp.get("priceOp") as NumOp | null;
    d.numOp = op ?? "between";
  } else {
    const raw = sp.get(def.field) ?? "";
    d.ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return d;
}

function writeRule(def: ColumnFilterDef, params: URLSearchParams, d: Draft) {
  if (def.kind === "text") {
    params.delete(def.field);
    params.delete(`${def.field}Op`);
    if (NO_OPERAND.has(d.textOp)) {
      params.set(`${def.field}Op`, d.textOp);
    } else if (d.text.trim()) {
      params.set(def.field, d.text.trim());
      params.set(`${def.field}Op`, d.textOp);
    }
  } else if (def.kind === "numeric") {
    params.delete("priceValue");
    params.delete("minPrice");
    params.delete("maxPrice");
    params.delete("priceOp");
    if (NO_OPERAND.has(d.numOp)) {
      params.set("priceOp", d.numOp);
    } else if (SINGLE_OPERAND.has(d.numOp)) {
      if (d.value.trim()) {
        params.set("priceValue", d.value.trim());
        params.set("priceOp", d.numOp);
      }
    } else {
      // between
      if (d.min.trim() || d.max.trim()) {
        if (d.min.trim()) params.set("minPrice", d.min.trim());
        if (d.max.trim()) params.set("maxPrice", d.max.trim());
        params.set("priceOp", "between");
      }
    }
  } else {
    params.delete(def.field);
    if (d.ids.length > 0) params.set(def.field, d.ids.join(","));
  }
}

function isActive(def: ColumnFilterDef, d: Draft): boolean {
  if (def.kind === "text") {
    return NO_OPERAND.has(d.textOp) || d.text.trim().length > 0;
  }
  if (def.kind === "numeric") {
    if (NO_OPERAND.has(d.numOp)) return true;
    if (SINGLE_OPERAND.has(d.numOp)) return d.value.trim().length > 0;
    return d.min.trim().length > 0 || d.max.trim().length > 0;
  }
  return d.ids.length > 0;
}

function summarise(def: ColumnFilterDef, d: Draft): string {
  if (def.kind === "text") {
    if (d.textOp === "empty") return "κενό";
    if (d.textOp === "not_empty") return "μη κενό";
    if (d.textOp === "not_contains") return `δεν περιέχει "${d.text}"`;
    return `περιέχει "${d.text}"`;
  }
  if (def.kind === "numeric") {
    if (d.numOp === "empty") return "κενό";
    if (d.numOp === "not_empty") return "μη κενό";
    if (SINGLE_OPERAND.has(d.numOp)) return `${NUM_SYMBOL[d.numOp]} ${d.value}`;
    if (d.min && d.max) return `${d.min} – ${d.max}`;
    if (d.min) return `≥ ${d.min}`;
    if (d.max) return `≤ ${d.max}`;
    return "—";
  }
  // dropdown
  if (d.ids.length === 1) {
    const opt = def.options.find((o) => o.id === d.ids[0]);
    return opt?.name ?? "1 επιλεγμένο";
  }
  return `${d.ids.length} επιλεγμένα`;
}

/* ── Editors ──────────────────────────────────────────────────────── */

function Editor({
  def,
  draft,
  setDraft,
}: {
  def: ColumnFilterDef;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
}) {
  if (def.kind === "text") {
    const showInput = !NO_OPERAND.has(draft.textOp);
    return (
      <div className="space-y-2">
        <select
          value={draft.textOp}
          onChange={(e) =>
            setDraft((d) => ({ ...d, textOp: e.target.value as TextOp }))
          }
          className="cms-input w-full text-sm"
        >
          {(["contains", "not_contains", "empty", "not_empty"] as TextOp[]).map(
            (op) => (
              <option key={op} value={op}>
                {TEXT_OP_LABELS[op]}
              </option>
            )
          )}
        </select>
        {showInput && (
          <input
            type="text"
            autoFocus
            value={draft.text}
            onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
            placeholder="Τιμή…"
            className="cms-input w-full text-sm"
          />
        )}
      </div>
    );
  }

  if (def.kind === "numeric") {
    const single = SINGLE_OPERAND.has(draft.numOp);
    const none = NO_OPERAND.has(draft.numOp);
    return (
      <div className="space-y-2">
        <select
          value={draft.numOp}
          onChange={(e) =>
            setDraft((d) => ({ ...d, numOp: e.target.value as NumOp }))
          }
          className="cms-input w-full text-sm"
        >
          {(
            [
              "between",
              "eq",
              "gt",
              "lt",
              "gte",
              "lte",
              "empty",
              "not_empty",
            ] as NumOp[]
          ).map((op) => (
            <option key={op} value={op}>
              {NUM_OP_LABELS[op]}
            </option>
          ))}
        </select>
        {none ? null : single ? (
          <input
            type="number"
            step="0.01"
            autoFocus
            value={draft.value}
            onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
            placeholder="Τιμή…"
            className="cms-input w-full text-sm tabular-nums"
          />
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              value={draft.min}
              onChange={(e) => setDraft((d) => ({ ...d, min: e.target.value }))}
              placeholder="Από"
              className="cms-input w-full text-sm tabular-nums"
            />
            <span className="text-muted-foreground">–</span>
            <input
              type="number"
              step="0.01"
              value={draft.max}
              onChange={(e) => setDraft((d) => ({ ...d, max: e.target.value }))}
              placeholder="Έως"
              className="cms-input w-full text-sm tabular-nums"
            />
          </div>
        )}
      </div>
    );
  }

  // dropdown — multi-select checkbox list
  function toggle(id: string) {
    setDraft((d) => {
      const next = new Set(d.ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...d, ids: Array.from(next) };
    });
  }
  return (
    <div className="max-h-56 overflow-y-auto -mx-1 px-1">
      {def.options.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic px-1 py-2">
          Δεν υπάρχουν διαθέσιμες τιμές.
        </p>
      ) : (
        def.options.map((o) => {
          const checked = draft.ids.includes(o.id);
          return (
            <label
              key={o.id}
              className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-sm ${
                checked ? "bg-foreground/5" : "hover:bg-foreground/5"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(o.id)}
                className="shrink-0"
              />
              <span className="truncate">{o.name}</span>
            </label>
          );
        })
      )}
    </div>
  );
}
