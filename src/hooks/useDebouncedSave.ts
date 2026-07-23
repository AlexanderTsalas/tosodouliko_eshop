"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type FieldState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface DebouncedFieldHandle<T> {
  /** Current local value. Updated optimistically on every set(). */
  value: T;
  /** Update the local value AND schedule a debounced save. */
  set: (next: T) => void;
  /** Save immediately, cancelling any in-flight debounce. Useful for
   *  fields where every commit should fire right away (toggles, blur). */
  saveNow: () => void;
  /** Current lifecycle state for the UI to display. */
  state: FieldState;
  /** Last error message if state === "error", else null. */
  error: string | null;
}

interface SaveResult {
  success: boolean;
  error?: string;
}

interface Options {
  /** Debounce window in ms. Default 600. */
  debounceMs?: number;
  /** How long the green "saved" indicator stays before fading to idle. Default 1200. */
  savedMs?: number;
}

/**
 * Generic auto-save field. Pairs a controlled value with a debounced
 * async save. The state machine surfaces the editing lifecycle so the
 * input can render visual feedback (dirty ring → spinner → check → fade).
 *
 * Race avoidance: each set() bumps an in-flight token; only the latest
 * save's result is applied. Older saves that complete late are ignored,
 * preventing a slow earlier save from clobbering a more-recent value.
 *
 * Upstream sync: if the `remote` prop changes while we're not actively
 * editing (state is idle or saved), the local value snaps to the new
 * remote. While the user is mid-edit (dirty/saving/error), we keep
 * their value to avoid stomping their work.
 */
export function useDebouncedSave<T>(
  remote: T,
  save: (value: T) => Promise<SaveResult>,
  options: Options = {}
): DebouncedFieldHandle<T> {
  const { debounceMs = 600, savedMs = 1200 } = options;

  const [value, setValue] = useState<T>(remote);
  const [state, setState] = useState<FieldState>("idle");
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightTokenRef = useRef(0);
  const pendingValueRef = useRef<T>(remote);

  // Keep latest save fn callable without re-binding consumers. Save fns
  // are typically inline closures that change identity every render.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Snap to upstream when we're not mid-edit. State is "settled" if it's
  // idle or showing the post-save check; in those windows the user isn't
  // expecting their typing to be preserved.
  useEffect(() => {
    if (state === "idle" || state === "saved") {
      setValue(remote);
      pendingValueRef.current = remote;
    }
    // intentionally only react to remote changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote]);

  // Auto-fade the "saved" badge back to idle.
  useEffect(() => {
    if (state !== "saved") return;
    const t = setTimeout(() => setState("idle"), savedMs);
    return () => clearTimeout(t);
  }, [state, savedMs]);

  const runSave = useCallback(async (toSave: T) => {
    const myToken = ++inflightTokenRef.current;
    setState("saving");
    const result = await saveRef.current(toSave);
    // Drop the result if a newer edit started while we were in flight.
    if (myToken !== inflightTokenRef.current) return;
    if (result.success) {
      setState("saved");
      setError(null);
    } else {
      setState("error");
      setError(result.error ?? "Save failed");
    }
  }, []);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      pendingValueRef.current = next;
      setState("dirty");
      setError(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Null the ref when the timer fires so `debounceRef.current` is a
      // reliable "an un-fired save is pending" signal for saveNow().
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        runSave(next);
      }, debounceMs);
    },
    [debounceMs, runSave]
  );

  const saveNow = useCallback(() => {
    // Flush a still-pending debounced save immediately. We gate on the
    // live debounce timer (nulled above when it fires) rather than React
    // `state`, which is stale in the same tick as a preceding set() — so
    // an edit committed via set()+saveNow() on blur/Enter actually saves
    // now instead of waiting for the debounce. If the timer already fired
    // (auto-saved) the ref is null and this is a no-op (no double save).
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      void runSave(pendingValueRef.current);
    }
  }, [runSave]);

  // Cleanup on unmount — prevent the debounced save from firing on a
  // dead component (would set state on an unmounted component).
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { value, set, saveNow, state, error };
}
