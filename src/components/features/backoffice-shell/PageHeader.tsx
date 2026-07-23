import type { ReactNode } from "react";

interface Props {
  /** Top-line page title — renders at h1 size with semibold weight. */
  title: ReactNode;
  /** Optional supporting text below the title. Keep under ~120 chars. */
  description?: ReactNode;
  /**
   * Optional right-aligned action area. Drop buttons / links here; they
   * stack vertically on small screens and float right on sm+ viewports.
   */
  actions?: ReactNode;
  /**
   * Optional eyebrow above the title (e.g. breadcrumb-style "Καταλόγος ›").
   * Renders as a small uppercase muted label.
   */
  eyebrow?: ReactNode;
}

/**
 * Shared admin page header. Replaces the ad-hoc `<h1>` + paragraph patterns
 * scattered across CMS pages so every admin page has the same vertical
 * rhythm, divider, and action-button placement.
 */
export default function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: Props) {
  return (
    <header className="cms-page-header">
      <div>
        {eyebrow && (
          <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1">
            {eyebrow}
          </p>
        )}
        <h1 className="cms-page-title">{title}</h1>
        {description && <p className="cms-page-description">{description}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </header>
  );
}
