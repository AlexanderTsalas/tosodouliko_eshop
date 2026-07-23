import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Unified header block for admin detail/edit pages.
 *
 * Visual contract:
 *   - Back-link button at the top (uses `.btn btn-secondary btn-sm`)
 *   - Optional breadcrumb line (small muted text — e.g. "Parent / Sub")
 *   - Large title (text-3xl) with optional badges inline
 *   - Optional subtitle line (slug, SKU, ID) below the title
 *   - Hairline bottom border that visually connects to the sub-tabs
 *     below — the page-header block + tab strip read as one piece
 *     of chrome, not two separate elements
 *
 * Used across /admin/products/[id]/edit, /admin/products/new, and
 * /admin/products/[id]/variants/[variantId] so the admin gets a
 * consistent "where am I" cue on every detail page.
 */
export default function AdminPageHeader({
  backHref,
  backLabel,
  breadcrumb,
  title,
  badges,
  subtitle,
  actions,
}: {
  /** Optional back-link href. Renders a btn-secondary "← {label}". */
  backHref?: string;
  backLabel?: string;
  /** Optional inline breadcrumb — text or links rendered above the title. */
  breadcrumb?: ReactNode;
  /** Main page title. */
  title: ReactNode;
  /** Optional inline badges (status, role chips, etc.) rendered to the
   * right of the title on the same line. */
  badges?: ReactNode;
  /** Optional subtitle — typically a slug, SKU, or other secondary id. */
  subtitle?: ReactNode;
  /** Optional right-aligned actions (e.g. "View on storefront" button). */
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4">
      {backHref && (
        <Link
          href={backHref}
          className="btn btn-secondary btn-sm mb-4"
        >
          ← {backLabel}
        </Link>
      )}
      {breadcrumb && (
        <p className="text-xs text-muted-foreground mb-2">{breadcrumb}</p>
      )}
      <div className="flex items-start justify-between gap-4 pb-5">
        <div className="flex-1 min-w-0">
          {/* Title row sits inside an inline-flex wrapper with its
              own hairline border-b so the separator hugs the title
              text (+ any inline badges) and STOPS where the title
              stops — not a full-width rule across the page. The
              wrapper uses `pb-2` so the line sits a few pixels
              below the baseline, not glued to the descenders. */}
          <div className="inline-flex items-center gap-3 flex-wrap pb-2 border-b border-foreground/20">
            <h1 className="text-3xl font-semibold tracking-tight leading-tight">
              {title}
            </h1>
            {badges}
          </div>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-3">{subtitle}</p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
