/**
 * Static-chrome primitives — used by admin pages to render their
 * structural elements (tables, tabs, etc.) before data arrives, with
 * IDENTICAL styling to the live components so the loaded → live
 * transition is visually invisible.
 *
 * Pattern (see src/app/admin/discounts/page.tsx for the reference):
 *   1. The page handler returns chrome only — header + Suspense
 *   2. Suspense fallback uses the page's static-chrome component,
 *      which composes these primitives
 *   3. A sibling loading.tsx renders the SAME static-chrome so the
 *      navigation gap doesn't reveal a different skeleton
 */
export { default as StaticTableSkeleton } from "./StaticTableSkeleton";
