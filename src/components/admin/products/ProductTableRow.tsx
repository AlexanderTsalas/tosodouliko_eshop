"use client";

import { usePanelController } from "@/components/admin/products/PanelControllerContext";

/**
 * Client `<tr>` wrapper for the products list. Applies the "currently
 * viewing" highlight (lighter background) when this row's product is the
 * one open in the side panel.
 *
 * While the panel is open it also opts rows into the "punch-through"
 * behaviour (see globals.css `.cms-row-elevated` / `.cms-row-elevatable`):
 * the focused row stays clear above the backdrop, and any other row lifts
 * clear on hover so the admin can click straight into a different
 * product's panel without closing it first. These classes are applied
 * ONLY while open, so the closed-state z-layering (dock/modals above
 * rows) is untouched.
 *
 * The state is controller-driven rather than URL-driven so it tracks the
 * panel's client open-state instantly — the server component can't know
 * which product is focused once opens stop being navigations.
 *
 * Cell content is passed as children (server-rendered) so only the row's
 * highlight needs the client boundary.
 */
export default function ProductTableRow({
  productId,
  baseClassName,
  children,
}: {
  productId: string;
  /** Static row classes (cms-row-link, inactive opacity, etc.). */
  baseClassName: string;
  children: React.ReactNode;
}) {
  const { productId: focusedId, isOpen } = usePanelController();
  const isFocused = focusedId === productId;
  const className = [
    baseClassName,
    isFocused && "bg-stone-100",
    // Panel open → rows can lift above the backdrop. Focused row is
    // always lifted (clear + current); the rest lift on hover.
    isOpen && "cms-row-elevatable",
    isOpen && isFocused && "cms-row-elevated",
  ]
    .filter(Boolean)
    .join(" ");
  return <tr className={className}>{children}</tr>;
}
