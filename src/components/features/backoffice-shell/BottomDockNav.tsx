"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  Truck,
  Megaphone,
  Settings as SettingsIcon,
  Users as UsersIcon,
  Wrench,
  ExternalLink,
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
  Menu,
  ChevronLeft,
  ChevronRight,
} from "@/components/admin/common/icons";
import type { SectionIconKey, TabIconKey } from "./AdminBottomDock";

interface VisibleSection {
  title: string;
  icon: SectionIconKey;
  muted: boolean;
  items: { href: string; label: string; tabIcon: TabIconKey }[];
}

interface Props {
  sections: VisibleSection[];
}

/**
 * Bottom-dock navigation, Apple-Dock-inspired. Glassmorphic container
 * pinned to the bottom-center of the viewport, with one icon box per
 * top-level section. Hovering a section icon reveals a popover above
 * it containing that section's pages as smaller icon boxes.
 *
 * Active-route highlighting matches the sidebar logic — prefix-match
 * for sub-paths, exact-match for /admin (Dashboard).
 */
export default function BottomDockNav({ sections }: Props) {
  const pathname = usePathname();
  // Collapse state persists across client-side navigation (the dock lives in
  // the admin layout, so it stays mounted). Collapsed → burger in the
  // bottom-left corner; expanded → full bar, recentred.
  const [collapsed, setCollapsed] = useState(false);
  // Popovers escape the bar UPWARD, so the drawer can only be overflow-
  // visible once fully open & settled; clipped during any transition.
  const [contentClipped, setContentClipped] = useState(false);

  // Measure the content's natural width so the drawer can animate `width`
  // in pixels — smooth, unlike grid-fr (which interpolates in steps).
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setContentWidth(el.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sections]);

  function isActive(href: string, exact = false): boolean {
    if (exact) return pathname === href;
    if (pathname === href) return true;
    return pathname.startsWith(href + "/");
  }

  function collapse() {
    setContentClipped(true);
    setCollapsed(true);
  }
  function expand() {
    setContentClipped(true); // stay clipped until the open transition ends
    setCollapsed(false);
  }

  return (
    <nav
      aria-label="Διαχείριση"
      // Anchored bottom-left; expanded state translates to horizontal centre
      // (50vw − own-half − the 1.5rem left offset). Transform animates on the
      // compositor, so recentring stays smooth alongside the width drawer.
      style={{
        transform: collapsed
          ? "translateX(0)"
          : "translateX(calc(50vw - 1.5rem - 50%))",
        transition: "transform 700ms ease-in-out",
        willChange: "transform",
      }}
      className="fixed bottom-6 left-6 z-50"
    >
      <div
        className="
          flex items-center gap-1.5
          p-2
          rounded-[28px]
          bg-dock/95
          backdrop-blur-3xl backdrop-saturate-200
          border border-dock-foreground/10
          shadow-[0_24px_60px_-12px_rgba(0,0,0,0.5)]
        "
      >
        {/* Toggle tile — chevron-left to collapse; burger when collapsed,
            which reveals a right chevron on hover ("unfolding"). */}
        <button
          type="button"
          onClick={() => (collapsed ? expand() : collapse())}
          aria-label={collapsed ? "Άνοιγμα μπάρας διαχείρισης" : "Σύμπτυξη μπάρας"}
          aria-expanded={!collapsed}
          title={collapsed ? "Άνοιγμα μενού" : "Σύμπτυξη"}
          className="
            group/toggle relative shrink-0
            flex items-center justify-center
            w-14 h-14 rounded-[22px]
            bg-dock-elevated text-dock-foreground
            shadow-[0_2px_6px_-2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.15)]
            transition-all duration-200 ease-out
            hover:scale-[1.08] hover:-translate-y-0.5
            focus:outline-none focus-visible:ring-2 focus-visible:ring-dock-ring/50
          "
        >
          {collapsed ? (
            <>
              <Menu className="w-6 h-6 transition-all duration-200 group-hover/toggle:opacity-0 group-hover/toggle:scale-50" />
              <ChevronRight className="absolute w-6 h-6 opacity-0 -translate-x-1.5 transition-all duration-200 group-hover/toggle:opacity-100 group-hover/toggle:translate-x-0" />
            </>
          ) : (
            <ChevronLeft className="w-6 h-6" />
          )}
        </button>

        {/* Drawer — width animates between 0 and the measured content width. */}
        <div
          style={{
            width: collapsed ? 0 : contentWidth ?? undefined,
            transition: "width 700ms ease-in-out",
          }}
          onTransitionEnd={(e) => {
            if (e.propertyName === "width" && !collapsed) {
              setContentClipped(false);
            }
          }}
          className={`
            min-w-0
            ${contentClipped || collapsed ? "overflow-hidden" : "overflow-visible"}
          `}
        >
          <div
            ref={contentRef}
            aria-hidden={collapsed}
            inert={collapsed || undefined}
            className="flex items-center gap-1.5 w-max"
          >
            <DockDivider />

            {/* Dashboard — always first, no popover (direct link). */}
            <DockLink
              href="/admin"
              label="Dashboard"
              active={isActive("/admin", true)}
            >
              <LayoutDashboard className="w-6 h-6" />
            </DockLink>

            <DockDivider />

            {sections.map((section) => {
              const containsActive = section.items.some((i) => isActive(i.href));
              return (
                <DockSection
                  key={section.title}
                  title={section.title}
                  icon={section.icon}
                  muted={section.muted}
                  containsActive={containsActive}
                  items={section.items.map((item) => ({
                    ...item,
                    active: isActive(item.href),
                  }))}
                />
              );
            })}

            <DockDivider />

            {/* View site CTA — opens storefront in a new tab. */}
            <DockLink href="/" label="Δείτε το site" external accent>
              <ExternalLink className="w-5 h-5" />
            </DockLink>
          </div>
        </div>
      </div>
    </nav>
  );
}

/* ── Building blocks ───────────────────────────────────────────────── */

function DockDivider() {
  return <span className="h-8 w-px bg-dock-foreground/15 mx-0.5" aria-hidden />;
}

/**
 * Standalone dock icon — used for the Dashboard link and the "View site"
 * CTA. No popover; clicks navigate directly.
 */
function DockLink({
  href,
  label,
  active = false,
  external = false,
  accent = false,
  children,
}: {
  href: string;
  label: string;
  active?: boolean;
  external?: boolean;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`
        group relative
        flex items-center justify-center
        w-14 h-14
        rounded-[22px]
        shadow-[0_2px_6px_-2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.15)]
        transition-all duration-200 ease-out
        hover:scale-[1.15]
        hover:-translate-y-1
        focus:outline-none focus-visible:ring-2 focus-visible:ring-dock-ring/50
        bg-dock-active text-dock-foreground
        ${
          active
            ? "ring-2 ring-dock-ring/50 ring-offset-2 ring-offset-dock"
            : accent
              ? "hover:brightness-110"
              : ""
        }
      `}
    >
      {/* Custom label tooltip — matches the popover dark-glass
          aesthetic. Inert (pointer-events-none, aria-hidden) since the
          link already exposes the accessible name via aria-label. */}
      <span
        className="
          absolute bottom-full left-1/2 -translate-x-1/2 mb-2
          px-2.5 py-1 rounded-md
          bg-dock/95 backdrop-blur-md
          border border-dock-foreground/10
          text-xs text-dock-foreground whitespace-nowrap
          pointer-events-none
          opacity-0 -translate-y-1
          group-hover:opacity-100 group-hover:translate-y-0
          group-focus-within:opacity-100 group-focus-within:translate-y-0
          transition-all duration-150
          shadow-[0_8px_24px_-6px_rgba(0,0,0,0.4)]
        "
        aria-hidden
      >
        {label}
      </span>
      {/* Inner span hosts the metallic shine + clips it to the rounded
          shape, so the tooltip above can escape the clip and float over
          neighboring tiles. */}
      <span
        className="
          absolute inset-0 rounded-[22px] overflow-hidden
          before:content-[''] before:absolute before:inset-0
          before:bg-[linear-gradient(115deg,transparent_25%,rgba(255,255,255,0.55)_50%,transparent_75%)]
          before:-translate-x-[120%]
          group-hover:before:translate-x-[120%]
          before:transition-transform before:duration-700 before:ease-out
        "
        aria-hidden
      />
      <span className="relative">{children}</span>
    </Link>
  );
}

/**
 * Section icon + popover. The wrapper is the .group; hovering or
 * focusing within it reveals the popover above the icon.
 *
 * The popover element extends from above the popover content down to
 * the icon, so the mouse can transit from icon → popover content
 * without breaking the hover bubble.
 */
function DockSection({
  title,
  icon,
  muted,
  containsActive,
  items,
}: {
  title: string;
  icon: SectionIconKey;
  muted: boolean;
  containsActive: boolean;
  items: Array<{
    href: string;
    label: string;
    tabIcon: TabIconKey;
    active: boolean;
  }>;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={title}
        aria-haspopup="true"
        title={title}
        className={`
          relative overflow-hidden
          flex items-center justify-center
          w-14 h-14
          rounded-[22px]
          shadow-[0_2px_6px_-2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.15)]
          transition-all duration-200 ease-out
          group-hover:scale-[1.15]
          group-hover:-translate-y-1
          focus:outline-none focus-visible:ring-2 focus-visible:ring-dock-ring/50
          before:content-[''] before:absolute before:inset-0
          before:bg-[linear-gradient(115deg,transparent_25%,rgba(255,255,255,0.55)_50%,transparent_75%)]
          before:-translate-x-[120%]
          group-hover:before:translate-x-[120%]
          before:transition-transform before:duration-700 before:ease-out
          text-dock-foreground
          ${
            containsActive
              ? "bg-dock-active ring-2 ring-dock-ring/50 ring-offset-2 ring-offset-dock"
              : muted
                ? "bg-dock-muted"
                : "bg-dock-active"
          }
        `}
      >
        <SectionIcon kind={icon} />
        {/* Tiny active dot underneath the icon when the user is on one
            of this section's pages. Terracotta on the dark bar reads
            as the brand-accent indicator. */}
        {containsActive && (
          <span
            className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-dock-active shadow-[0_0_4px_rgba(0,0,0,0.4)]"
            aria-hidden
          />
        )}
      </button>

      {/* Popover — hidden until hover/focus. The outer element bridges
          icon and popover content so the hover bubble stays unbroken. */}
      <div
        className="
          absolute bottom-full left-1/2 -translate-x-1/2
          pt-2 pb-3
          opacity-0 pointer-events-none
          translate-y-2
          transition-all duration-200 ease-out
          group-hover:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0
          group-focus-within:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0
        "
        role="menu"
        aria-label={title}
      >
        <div
          className="
            min-w-[280px]
            p-3
            rounded-[24px]
            bg-dock/95
            backdrop-blur-3xl backdrop-saturate-200
            border border-dock-foreground/10
            shadow-[0_24px_60px_-12px_rgba(0,0,0,0.5)]
          "
        >
          <p className="px-2 pb-2 text-[10px] font-mono uppercase tracking-widest text-dock-foreground/40">
            {title}
          </p>
          <div className="grid grid-cols-3 gap-1">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                className={`
                  group/sub
                  flex flex-col items-center gap-1.5
                  p-2
                  rounded-[18px]
                  transition-all duration-150
                  hover:bg-dock-foreground/5
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-dock-ring/40
                  ${item.active ? "bg-dock-foreground/8" : ""}
                `}
                role="menuitem"
              >
                <span
                  className={`
                    relative overflow-hidden
                    flex items-center justify-center
                    w-12 h-12
                    rounded-[18px]
                    shadow-[0_2px_6px_-2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.15)]
                    transition-transform duration-150
                    group-hover/sub:scale-[1.08]
                    before:content-[''] before:absolute before:inset-0
                    before:bg-[linear-gradient(115deg,transparent_25%,rgba(255,255,255,0.55)_50%,transparent_75%)]
                    before:-translate-x-[120%]
                    group-hover/sub:before:translate-x-[120%]
                    before:transition-transform before:duration-700 before:ease-out
                    bg-dock-active text-dock-foreground
                    ${
                      item.active
                        ? "ring-2 ring-dock-ring/50 ring-offset-2 ring-offset-dock"
                        : ""
                    }
                  `}
                >
                  <TabIcon kind={item.tabIcon} />
                </span>
                <span className="text-[11px] leading-tight text-center text-dock-foreground/80 line-clamp-2">
                  {item.label}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Icon dispatchers ──────────────────────────────────────────────── */

function SectionIcon({ kind }: { kind: SectionIconKey }) {
  const className = "w-6 h-6";
  switch (kind) {
    case "catalog":   return <Package className={className} />;
    case "sales":     return <ShoppingBag className={className} />;
    case "suppliers": return <Truck className={className} />;
    case "marketing": return <Megaphone className={className} />;
    case "settings":  return <SettingsIcon className={className} />;
    case "team":      return <UsersIcon className={className} />;
    case "ops":       return <Wrench className={className} />;
  }
}

function TabIcon({ kind }: { kind: TabIconKey }) {
  const className = "w-5 h-5";
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
