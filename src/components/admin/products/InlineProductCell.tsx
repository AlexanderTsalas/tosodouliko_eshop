"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateProduct } from "@/actions/products/updateProduct";
import { bulkUpdateProducts } from "@/actions/products/bulkUpdateProducts";
import { usePanelController } from "@/components/admin/products/PanelControllerContext";
import { useSelection } from "@/components/admin/common/SelectionContext";
import { useBulkPropagation } from "@/components/admin/products/BulkPropagationContext";

/**
 * One-click → navigate (with a ~250ms wait to see if it's actually a
 * double-click); double-click → enter inline edit mode. Blur or Enter
 * saves; Escape cancels. Used for the products-list table cells that
 * the admin wants to edit without opening the side panel.
 *
 * The cell uses `data-row-action` so the row's stretched-link doesn't
 * intercept its clicks — our own onClick handler is the navigation
 * source. Cells that should drive nav via the stretched-link instead
 * (e.g., the dedicated name cell that owns `cms-row-link-target`)
 * should set `isRowLinkTarget={true}` so they apply the link's
 * pseudo-element via the span itself.
 */

const NAV_DELAY_MS = 250;

type Field = "name" | "baseSku" | "basePrice";

interface CommonProps {
  productId: string;
  field: Field;
  /** The current persisted value, used as initial input value on edit. */
  initialValue: string;
  /** Display string when not editing. */
  displayValue: string;
  /** Tailwind class applied to the visible display span. */
  displayClassName?: string;
  /** Tailwind class applied to the input in edit mode. */
  inputClassName?: string;
  /** Width class for the input. */
  inputWidth?: string;
  /** When true, this cell owns the stretched-link pseudo across the
   *  whole row — the span itself carries `cms-row-link-target`. */
  isRowLinkTarget?: boolean;
}

interface TextProps extends CommonProps {
  fieldType: "text";
}

interface NumberProps extends CommonProps {
  fieldType: "number";
  step?: number;
  min?: number;
}

type Props = TextProps | NumberProps;

export default function InlineProductCell(props: Props) {
  const {
    productId,
    field,
    initialValue,
    displayValue,
    displayClassName = "",
    inputClassName = "",
    inputWidth = "w-32",
    isRowLinkTarget = false,
  } = props;

  const router = useRouter();
  const { open } = usePanelController();
  const { isSelected, selectedIds, selectedCount } = useSelection();
  const { confirmPropagate } = useBulkPropagation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(initialValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep draft in sync with upstream when not editing.
  useEffect(() => {
    if (!editing) setDraft(initialValue);
  }, [initialValue, editing]);

  // Focus + select-all when entering edit.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    // When this cell is the row-link target, the cms-row-link-target
    // pseudo-element extends the click area across the entire row.
    // Click events still fire on the span, but the cursor position can
    // be OUTSIDE the span's visible bounds (e.g. user clicked on
    // Margin/Avg cost cells). Distinguish:
    //   - Click INSIDE the span's rect (on the actual name text)
    //     → 250ms timer so a follow-up dblclick can open the editor.
    //   - Click OUTSIDE the rect (caught by the stretched-link pseudo)
    //     → user is navigating, not editing — fire router.push
    //     immediately so the side panel opens optimistically.
    if (isRowLinkTarget) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const insideSpan =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!insideSpan) {
        // Click landed OUTSIDE the name span (caught by the row's
        // stretched-link pseudo on another cell) → the user is opening
        // the row, not editing. Open the panel immediately — open state
        // is local client state, so the panel slides in instantly.
        open(productId);
        return;
      }
    }

    // Click on the actual editable cell content — schedule the open after
    // NAV_DELAY_MS so a second click within that window cancels it and
    // the double-click handler runs the editor instead.
    if (navTimerRef.current) {
      return;
    }
    navTimerRef.current = setTimeout(() => {
      open(productId);
      navTimerRef.current = null;
    }, NAV_DELAY_MS);
  }

  function handleDoubleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (navTimerRef.current) {
      clearTimeout(navTimerRef.current);
      navTimerRef.current = null;
    }
    setEditing(true);
    setError(null);
  }

  async function commit(value: string) {
    if (value === initialValue) {
      setEditing(false);
      return;
    }
    setPending(true);
    setError(null);
    let payload: Parameters<typeof updateProduct>[0];
    if (props.fieldType === "number") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError("Μη έγκυρη τιμή");
        setPending(false);
        return;
      }
      payload = { id: productId, [field]: parsed } as Parameters<
        typeof updateProduct
      >[0];
    } else {
      const trimmed = value.trim();
      // For name we require non-empty; for baseSku we allow empty (clears).
      if (field === "name" && trimmed.length === 0) {
        setError("Το όνομα δεν μπορεί να είναι κενό");
        setPending(false);
        return;
      }
      payload = { id: productId, [field]: trimmed } as Parameters<
        typeof updateProduct
      >[0];
    }

    // Bulk inline propagation — only basePrice (name/baseSku are identity
    // fields, never propagated). Explicit multi-selection only; matchAll
    // goes through the bulk panel. Confirm modal shows the affected count.
    if (
      field === "basePrice" &&
      props.fieldType === "number" &&
      isSelected(productId) &&
      selectedCount > 1
    ) {
      const parsed = Number(value);
      const applied = await confirmPropagate({
        count: selectedCount,
        message: "τη βασική τιμή",
        apply: async () => {
          const res = await bulkUpdateProducts({
            ids: selectedIds,
            matchAll: false,
            filterParams: {},
            scalars: { basePrice: { mode: "set", value: parsed } },
          });
          return {
            success: res.success,
            error: res.success ? undefined : res.error,
          };
        },
      });
      if (applied) {
        setPending(false);
        setEditing(false);
        router.refresh();
        return;
      }
      // "Only this one" → fall through to the single-row update below.
    }

    const r = await updateProduct(payload);
    setPending(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          type={props.fieldType === "number" ? "number" : "text"}
          step={
            props.fieldType === "number"
              ? props.step ?? 0.01
              : undefined
          }
          min={
            props.fieldType === "number" ? props.min ?? 0 : undefined
          }
          inputMode={props.fieldType === "number" ? "decimal" : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              setDraft(initialValue);
              setError(null);
            }
          }}
          disabled={pending}
          aria-label={field}
          title={error ?? undefined}
          className={`
            ${inputWidth} px-1.5 py-0.5 text-sm rounded-sm
            border ${error ? "border-red-400" : "border-foreground/40"} bg-background
            focus:outline-none focus:border-foreground focus:ring-1 focus:ring-foreground/15
            ${pending ? "opacity-50" : ""}
            ${inputClassName}
          `}
        />
        {pending && (
          <span
            className="inline-block w-2.5 h-2.5 rounded-full border-2 border-foreground/30 border-t-foreground/70 animate-spin"
            aria-hidden
          />
        )}
      </span>
    );
  }

  return (
    <span
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title="Διπλό κλικ για επεξεργασία"
      className={`
        cursor-pointer hover:underline
        rounded px-0.5 -mx-0.5
        ${isRowLinkTarget ? "cms-row-link-target" : ""}
        ${displayClassName}
      `}
    >
      {displayValue}
    </span>
  );
}
