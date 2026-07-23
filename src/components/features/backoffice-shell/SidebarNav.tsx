"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  Truck,
  Megaphone,
  Settings as SettingsIcon,
  Users as UsersIcon,
  Wrench,
  ChevronRight,
  // Sub-item icons (re-exported from lucide-react in icons.tsx)
  Boxes,
  Folder,
  Sliders,
  Warehouse,
  ImageIcon,
  Receipt,
  UserRound,
  Clock,
  Undo2,
  Building2,
  ClipboardCheck,
  TrendingUp,
  Tag,
  Mail,
  SearchIcon,
  Languages,
  MapPinned,
  Bike,
  AtSign,
  Euro,
  Coins,
  Percent,
  UserCog,
  ShieldCheck,
  KeyRound,
  Bug,
  ScrollText,
  AlertCircle,
  ServerCrash,
  MapPin,
  MessageSquareText,
  Sparkles,
} from "@/components/admin/common/icons";

type SectionIconKey =
  | "catalog"
  | "sales"
  | "suppliers"
  | "marketing"
  | "settings"
  | "team"
  | "ops";

type TabIconKey =
  | "products"
  | "categories"
  | "attributes"
  | "inventory"
  | "media"
  | "custom_fields"
  | "related_products"
  | "orders"
  | "customers"
  | "wishlist_queue"
  | "returns"
  | "suppliers"
  | "supply_orders"
  | "margins"
  | "discounts"
  | "newsletter"
  | "seo"
  | "translations"
  | "shipping"
  | "couriers"
  | "email"
  | "fees"
  | "currencies"
  | "vat_rates"
  | "users"
  | "roles"
  | "permissions"
  | "inventory_debug"
  | "audit_log"
  | "errors"
  | "system_errors"
  | "tracking";

interface VisibleSection {
  title: string;
  icon: SectionIconKey;
  /** When true, render section header in a softer color (used for ops/debug tools). */
  muted: boolean;
  /**
   * When true, the section starts collapsed on initial render. The
   * active route still wins — if the current page lives inside this
   * section, the section auto-opens.
   */
  defaultCollapsed: boolean;
  items: { href: string; label: string; tabIcon: TabIconKey }[];
}

interface Props {
  sections: VisibleSection[];
}

/**
 * Client-side sidebar nav. Handles:
 *
 *   - Active-link highlighting based on the current pathname
 *   - Per-section open/closed state in `useState` so we drive a smooth
 *     CSS height transition on toggle
 *   - Auto-opens the section containing the current page on mount
 *   - WHEN a section is collapsed AND contains the active page, the
 *     SECTION HEADER itself takes on the active styling so the user
 *     still has a visual cue of "where am I" without having to expand
 *
 * Active-match logic: exact for /admin (Dashboard), prefix-match for
 * everything else so /admin/products/123 still highlights "Προϊόντα".
 */
export default function SidebarNav({ sections }: Props) {
  const pathname = usePathname();

  function isActive(href: string, exact = false): boolean {
    if (exact) return pathname === href;
    if (pathname === href) return true;
    return pathname.startsWith(href + "/");
  }

  // Initial open state: open if the section either (a) opts out of
  // default-collapse OR (b) contains the currently active route.
  // Computed once at mount; subsequent toggles are pure user-driven.
  const [openSet, setOpenSet] = useState<Set<string>>(() => {
    const init = new Set<string>();
    for (const s of sections) {
      const containsActive = s.items.some((i) => isActive(i.href));
      if (containsActive || !s.defaultCollapsed) init.add(s.title);
    }
    return init;
  });

  function toggle(title: string) {
    setOpenSet((cur) => {
      const next = new Set(cur);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  return (
    // No gap between sections — adjacent sections sit flush so hovering
    // a row doesn't reveal the underlying sidebar background through a
    // 2px gutter (which read as an unintended white sliver).
    <nav>
      {/* Dashboard — always at the top, exact-match. */}
      <Link
        href="/admin"
        className={`cms-sidebar-link ${
          isActive("/admin", true) ? "is-active" : ""
        }`}
        aria-current={isActive("/admin", true) ? "page" : undefined}
      >
        <span className="cms-sidebar-icon" aria-hidden>
          <DashboardIcon />
        </span>
        Dashboard
      </Link>

      <div className="cms-sidebar-divider" />

      {sections.map((section) => {
        const isOpen = openSet.has(section.title);
        const containsActive = section.items.some((i) => isActive(i.href));
        // When the section is COLLAPSED and contains the active page, the
        // header takes on the active styling so the user still sees
        // "where am I" without having to expand the section. When the
        // section is OPEN, the active LINK gets the highlight (and the
        // header stays neutral).
        const summaryIsActive = !isOpen && containsActive;
        return (
          <div
            key={section.title}
            className={`cms-sidebar-section ${section.muted ? "is-muted" : ""} ${
              isOpen ? "is-open" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => toggle(section.title)}
              className={`cms-sidebar-summary ${
                summaryIsActive ? "is-active" : ""
              }`}
              aria-expanded={isOpen}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <span className="cms-sidebar-icon" aria-hidden>
                  <SectionIcon kind={section.icon} />
                </span>
                <span className="font-bold truncate">{section.title}</span>
              </span>
              <span className="cms-sidebar-chevron-wrap" aria-hidden>
                <ChevronIcon />
              </span>
            </button>
            <div className="cms-sidebar-items-wrap">
              <div className="cms-sidebar-items">
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`cms-sidebar-link ${
                      isActive(item.href) ? "is-active" : ""
                    }`}
                    aria-current={isActive(item.href) ? "page" : undefined}
                  >
                    <span className="cms-sidebar-icon" aria-hidden>
                      <TabIcon kind={item.tabIcon} />
                    </span>
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Per-category icon dispatcher. Renders the matching Lucide icon (paths
 * inlined in `@/components/admin/common/icons`). Size + color cascade
 * from the wrapping `.cms-sidebar-icon` so we don't repeat them here.
 */
function SectionIcon({ kind }: { kind: SectionIconKey }) {
  const className = "w-5 h-5";
  switch (kind) {
    case "catalog":
      return <Package className={className} />;
    case "sales":
      return <ShoppingBag className={className} />;
    case "suppliers":
      return <Truck className={className} />;
    case "marketing":
      return <Megaphone className={className} />;
    case "settings":
      return <SettingsIcon className={className} />;
    case "team":
      return <UsersIcon className={className} />;
    case "ops":
      return <Wrench className={className} />;
  }
}

function ChevronIcon() {
  return <ChevronRight className="w-3.5 h-3.5" />;
}

function DashboardIcon() {
  return <LayoutDashboard className="w-5 h-5" />;
}

/**
 * Per-tab icon dispatcher. Renders the small contextual glyph next to
 * the sub-item label. Matches the section-icon size (w-4 h-4 to keep
 * the icon visually subordinate to the label).
 */
function TabIcon({ kind }: { kind: TabIconKey }) {
  const className = "w-4 h-4";
  switch (kind) {
    case "products":         return <Boxes className={className} />;
    case "categories":       return <Folder className={className} />;
    case "attributes":       return <Sliders className={className} />;
    case "inventory":        return <Warehouse className={className} />;
    case "media":            return <ImageIcon className={className} />;
    case "custom_fields":    return <MessageSquareText className={className} />;
    case "related_products": return <Sparkles className={className} />;
    case "orders":           return <Receipt className={className} />;
    case "customers":        return <UserRound className={className} />;
    case "wishlist_queue":   return <Clock className={className} />;
    case "returns":          return <Undo2 className={className} />;
    case "suppliers":        return <Building2 className={className} />;
    case "supply_orders":    return <ClipboardCheck className={className} />;
    case "margins":          return <TrendingUp className={className} />;
    case "discounts":        return <Tag className={className} />;
    case "newsletter":       return <Mail className={className} />;
    case "seo":              return <SearchIcon className={className} />;
    case "translations":     return <Languages className={className} />;
    case "shipping":         return <MapPinned className={className} />;
    case "couriers":         return <Bike className={className} />;
    case "email":            return <AtSign className={className} />;
    case "fees":             return <Euro className={className} />;
    case "currencies":       return <Coins className={className} />;
    case "vat_rates":        return <Percent className={className} />;
    case "users":            return <UserCog className={className} />;
    case "roles":            return <ShieldCheck className={className} />;
    case "permissions":      return <KeyRound className={className} />;
    case "inventory_debug":  return <Bug className={className} />;
    case "audit_log":        return <ScrollText className={className} />;
    case "errors":           return <AlertCircle className={className} />;
    case "system_errors":    return <ServerCrash className={className} />;
    case "tracking":         return <MapPin className={className} />;
  }
}
