"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useMemo, useCallback } from "react";

export interface WorkspaceTab {
  /** Stable id for the tab — encoded into the URL (e.g. "draft:abc-123" or "receive:42"). */
  id: string;
  /** Visible label shown in the tab strip. */
  label: string;
  /** True if the user can close this tab (the "All" overview tab is sticky). */
  closeable?: boolean;
}

interface Props {
  /** All tabs to render, in display order. */
  tabs: WorkspaceTab[];
  /** Which tab id is active. */
  activeId: string;
  /** The URL search-param key that holds the active tab id. Default "ws". */
  paramKey?: string;
  /** Called when a closeable tab is closed; receives the id being closed. */
  onClose?: (id: string) => void;
}

/**
 * VS Code-style closeable tab strip. State is in the URL (?ws=<id>), so:
 *   - Refresh keeps the same tab open.
 *   - Deep-link works (paste a URL into another window).
 *   - Browser back/forward navigates between tabs.
 *
 * The host page is responsible for tracking which tabs *exist* (typically in
 * its own URL state or a parent param) — this component only handles the
 * "which is active" selection and the close interaction.
 */
export default function WorkspaceTabs({
  tabs,
  activeId,
  paramKey = "ws",
  onClose,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const buildHref = useCallback(
    (id: string) => {
      const next = new URLSearchParams(sp.toString());
      next.set(paramKey, id);
      return `${pathname}?${next.toString()}`;
    },
    [pathname, sp, paramKey]
  );

  const handleClose = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      e.stopPropagation();
      onClose?.(id);
    },
    [onClose]
  );

  // Build active-state map once per render.
  const isActive = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const t of tabs) map.set(t.id, t.id === activeId);
    return map;
  }, [tabs, activeId]);

  if (tabs.length === 0) return null;

  return (
    <nav className="border-b flex items-center gap-px overflow-x-auto" aria-label="Workspace tabs">
      {tabs.map((t) => {
        const active = isActive.get(t.id) ?? false;
        return (
          <div
            key={t.id}
            className={
              "group flex items-center gap-1 px-3 py-2 text-sm border-t border-l border-r rounded-t -mb-px " +
              (active
                ? "bg-background border-b-0 font-medium"
                : "bg-muted/40 text-muted-foreground hover:bg-muted/60")
            }
          >
            <button
              type="button"
              onClick={() => router.push(buildHref(t.id))}
              className="whitespace-nowrap"
              aria-current={active ? "page" : undefined}
            >
              {t.label}
            </button>
            {t.closeable && onClose && (
              <button
                type="button"
                onClick={(e) => handleClose(e, t.id)}
                aria-label={`Close ${t.label}`}
                className="opacity-50 hover:opacity-100 hover:text-destructive ml-1"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}
