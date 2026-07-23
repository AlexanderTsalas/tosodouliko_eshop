"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useTransition,
  useCallback,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  selectAllMatchingHref,
  clearSelectionHref,
  MAX_EXPLICIT_SELECTION,
} from "@/lib/bulk-selection/selectionUrl";

/**
 * Optimistic-UI selection state for an admin list page.
 *
 * The URL is still the source of truth (refresh-safe, deep-linkable,
 * back/forward-friendly), but the UI ticks the checkbox INSTANTLY from
 * local React state — the router.push that updates the URL runs in a
 * transition so the rest of the page stays interactive.
 *
 * A useEffect reconciles local state with the URL on every navigation
 * (success or failure), so if a router.push is cancelled or the user hits
 * back/forward, the checkbox state realigns with reality.
 */
interface SelectionState {
  selectedIds: Set<string>;
  matchAll: boolean;
}

interface SelectionContextValue {
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAllOnPage: (pageIds: string[]) => void;
  expandToMatchAll: () => void;
  clear: () => void;
  /** Explicitly selected ids (empty in matchAll mode). For inline
   *  bulk propagation, which targets the explicit set. */
  selectedIds: string[];
  selectedCount: number;
  matchAll: boolean;
  isPending: boolean;
}

const Ctx = createContext<SelectionContextValue | null>(null);

export function useSelection(): SelectionContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSelection must be used inside <SelectionProvider>");
  return v;
}

interface ProviderProps {
  /** Initial selected IDs derived from the URL on the server (for hydration). */
  initialSelectedIds: string[];
  initialMatchAll: boolean;
  children: React.ReactNode;
}

export default function SelectionProvider({
  initialSelectedIds,
  initialMatchAll,
  children,
}: ProviderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [state, setState] = useState<SelectionState>(() => ({
    selectedIds: new Set(initialSelectedIds),
    matchAll: initialMatchAll,
  }));

  // Synchronous mirror of `state` so rapid-fire callbacks read the latest
  // selection WITHOUT waiting for React to re-render between events. Without
  // this, two clicks fired in the same tick would both read the pre-click
  // state and the second URL push would clobber the first.
  const stateRef = useRef(state);

  // Reconcile local state with whatever the URL actually carries after each
  // navigation. Without this, a cancelled router.push could leave the local
  // state out of sync with reality. Updates the ref alongside state so the
  // next toggle reads from URL-authoritative truth.
  useEffect(() => {
    const matchAll = searchParams.get("matchAll") === "1";
    const raw = searchParams.get("selected") ?? "";
    const ids = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
    const next = { selectedIds: ids, matchAll };
    stateRef.current = next;
    setState(next);
  }, [searchParams]);

  const pushUrl = useCallback(
    (build: (sp: URLSearchParams) => string) => {
      const next = build(new URLSearchParams(searchParams.toString()));
      startTransition(() => router.push(next));
    },
    [router, searchParams]
  );

  const toggle = useCallback(
    (id: string) => {
      // Read the latest cumulative selection from the ref — NOT from the
      // URL (which is stale during rapid clicks because router.push runs
      // in a transition and the URL hasn't reconciled yet).
      const cur = stateRef.current;
      const next = new Set(cur.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);

      const nextState = { selectedIds: next, matchAll: false };
      stateRef.current = nextState;
      setState(nextState);

      // Build the URL from the NEW cumulative state so every push carries
      // the full set. Each call cancels the previous transition; the last
      // one to land is the one with the complete selection.
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete("matchAll");
      if (next.size === 0) newParams.delete("selected");
      else newParams.set("selected", Array.from(next).join(","));
      startTransition(() => router.push(`?${newParams.toString()}`));
    },
    [router, searchParams]
  );

  const selectAllOnPage = useCallback(
    (pageIds: string[]) => {
      const cur = stateRef.current;
      const currentlyHasAll = pageIds.every((id) => cur.selectedIds.has(id));
      const next = currentlyHasAll
        ? new Set<string>()
        : new Set([...cur.selectedIds, ...pageIds]);

      const nextState = { selectedIds: next, matchAll: false };
      stateRef.current = nextState;
      setState(nextState);

      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete("matchAll");
      if (next.size === 0) newParams.delete("selected");
      else
        newParams.set(
          "selected",
          Array.from(next).slice(0, MAX_EXPLICIT_SELECTION).join(",")
        );
      startTransition(() => router.push(`?${newParams.toString()}`));
    },
    [router, searchParams]
  );

  const expandToMatchAll = useCallback(() => {
    setState({ selectedIds: new Set(), matchAll: true });
    pushUrl((sp) => selectAllMatchingHref(sp));
  }, [pushUrl]);

  const clear = useCallback(() => {
    setState({ selectedIds: new Set(), matchAll: false });
    pushUrl((sp) => clearSelectionHref(sp));
  }, [pushUrl]);

  const isSelected = useCallback(
    (id: string) => state.matchAll || state.selectedIds.has(id),
    [state]
  );

  const value: SelectionContextValue = {
    isSelected,
    toggle,
    selectAllOnPage,
    expandToMatchAll,
    clear,
    selectedIds: state.matchAll ? [] : Array.from(state.selectedIds),
    selectedCount: state.matchAll ? 0 : state.selectedIds.size,
    matchAll: state.matchAll,
    isPending,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
