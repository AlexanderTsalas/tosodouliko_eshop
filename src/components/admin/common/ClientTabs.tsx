"use client";

export interface ClientTabItem {
  key: string;
  label: string;
  disabled?: boolean;
  /** Optional badge text shown on disabled tabs (e.g. "after save"). */
  disabledHint?: string;
}

interface Props {
  tabs: ClientTabItem[];
  active: string;
  onChange: (key: string) => void;
}

/**
 * Client-state tab navigation used when there is no persisted resource yet
 * (e.g. product creation). Uses the shared .cms-tab / .cms-tabs classes
 * so it stays in lockstep with Tabs.tsx visually.
 */
export default function ClientTabs({ tabs, active, onChange }: Props) {
  return (
    <nav aria-label="Tabs" className="cms-tabs">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => !t.disabled && onChange(t.key)}
            disabled={t.disabled}
            aria-current={isActive ? "page" : undefined}
            title={t.disabledHint}
            className="cms-tab disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t.label}
            {t.disabledHint && (
              <span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">
                ({t.disabledHint})
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
