import Link from "next/link";
import { checkPermission } from "@/lib/rbac";
import SidebarNav from "./SidebarNav";

interface NavItem {
  href: string;
  label: string;
  permission: string;
  /** Icon key for the tab — dispatched in SidebarNav's <TabIcon />. */
  tabIcon: TabIconKey;
}

/**
 * Identifier consumed by SidebarNav to render the matching inline SVG
 * icon next to each section title. New sections add a new key here and
 * a matching case in SidebarNav's <SectionIcon /> renderer.
 */
type SectionIconKey =
  | "catalog"
  | "sales"
  | "suppliers"
  | "marketing"
  | "settings"
  | "team"
  | "ops";

/**
 * Identifier for the per-tab icon (the small contextual glyph next to
 * each sub-item label). Adding a new tab: pick a key here, map it in
 * SidebarNav's <TabIcon /> dispatcher, set it on the nav item.
 */
export type TabIconKey =
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

interface NavSection {
  /** Section label shown above its links. */
  title: string;
  /** Icon key — rendered next to the section title for at-a-glance scanning. */
  icon: SectionIconKey;
  items: NavItem[];
  /**
   * When true, the section renders muted (used for operational/debug
   * tools that are less central to daily admin work).
   */
  muted?: boolean;
  /**
   * When true, the section starts collapsed on first render. The active
   * route still wins — if the current page lives inside this section,
   * the SidebarNav forces it open regardless. Default false (= open).
   */
  defaultCollapsed?: boolean;
}

/**
 * Sidebar navigation, grouped by domain. The flat list of 28 links was
 * hard to scan; sectioning them makes the IA visible at a glance and
 * lets us mute operational/debug groups so they don't compete with the
 * primary workflows.
 *
 * Group ordering reflects daily-use frequency, not strict hierarchy:
 * the catalog and order ops come first because those are the screens
 * the admin opens every day.
 */
const SECTIONS: NavSection[] = [
  {
    title: "Καταλόγος",
    icon: "catalog",
    items: [
      { href: "/admin/products",          label: "Προϊόντα",                permission: "manage:products",   tabIcon: "products" },
      { href: "/admin/categories",        label: "Κατηγορίες",              permission: "manage:categories", tabIcon: "categories" },
      { href: "/admin/attributes",        label: "Χαρακτηριστικά",          permission: "manage:attributes", tabIcon: "attributes" },
      { href: "/admin/inventory",         label: "Απόθεμα",                 permission: "manage:products",   tabIcon: "inventory" },
      { href: "/admin/media",             label: "Αρχεία",                   permission: "manage:media",      tabIcon: "media" },
      { href: "/admin/custom-fields",     label: "Προσαρμόσιμα πεδία",       permission: "manage:products",   tabIcon: "custom_fields" },
    ],
  },
  {
    title: "Πωλήσεις",
    icon: "sales",
    items: [
      { href: "/admin/orders",            label: "Παραγγελίες",     permission: "manage:orders",          tabIcon: "orders" },
      { href: "/admin/customers",         label: "Πελάτες",         permission: "manage:orders",          tabIcon: "customers" },
      { href: "/admin/wishlist-queue",    label: "Λίστα αναμονής",  permission: "manage:wishlist_queue",  tabIcon: "wishlist_queue" },
      { href: "/admin/returns",           label: "Επιστροφές",      permission: "manage:returns",         tabIcon: "returns" },
      { href: "/admin/related-products",  label: "Σχετικά προϊόντα", permission: "manage:products",        tabIcon: "related_products" },
    ],
  },
  {
    title: "Προμηθευτές",
    icon: "suppliers",
    defaultCollapsed: true,
    items: [
      { href: "/admin/suppliers",       label: "Προμηθευτές",            permission: "manage:suppliers", tabIcon: "suppliers" },
      { href: "/admin/supply-orders",   label: "Παραγγελίες Προμηθειών", permission: "manage:suppliers", tabIcon: "supply_orders" },
      { href: "/admin/reports/margins", label: "Περιθώρια Κέρδους",      permission: "manage:products",  tabIcon: "margins" },
    ],
  },
  {
    title: "Marketing",
    icon: "marketing",
    defaultCollapsed: true,
    items: [
      { href: "/admin/discounts",    label: "Προσφορές",   permission: "manage:discounts",    tabIcon: "discounts" },
      { href: "/admin/newsletter",   label: "Newsletter",   permission: "manage:newsletter",   tabIcon: "newsletter" },
      { href: "/admin/seo",          label: "SEO",          permission: "manage:seo",          tabIcon: "seo" },
      { href: "/admin/translations", label: "Μεταφράσεις",  permission: "manage:translations", tabIcon: "translations" },
    ],
  },
  {
    title: "Ρυθμίσεις",
    icon: "settings",
    defaultCollapsed: true,
    items: [
      { href: "/admin/shipping",          label: "Αποστολή",           permission: "manage:shipping",   tabIcon: "shipping" },
      { href: "/admin/settings/couriers", label: "Couriers",            permission: "manage:couriers",   tabIcon: "couriers" },
      { href: "/admin/settings/email",    label: "Email πάροχος",       permission: "manage:settings",   tabIcon: "email" },
      { href: "/admin/settings/fees",     label: "Χρεώσεις & κόμιστρα", permission: "manage:fees",       tabIcon: "fees" },
      { href: "/admin/currencies",        label: "Νομίσματα",           permission: "manage:currencies", tabIcon: "currencies" },
      { href: "/admin/vat-rates",         label: "Κατηγορίες ΦΠΑ",      permission: "manage:vat_rates",  tabIcon: "vat_rates" },
    ],
  },
  {
    title: "Ομάδα",
    icon: "team",
    defaultCollapsed: true,
    items: [
      { href: "/admin/users",       label: "Χρήστες",     permission: "manage:users", tabIcon: "users" },
      { href: "/admin/roles",       label: "Ρόλοι",        permission: "manage:roles", tabIcon: "roles" },
      { href: "/admin/permissions", label: "Δικαιώματα",  permission: "manage:roles", tabIcon: "permissions" },
    ],
  },
  {
    title: "Λειτουργία",
    icon: "ops",
    muted: true,
    defaultCollapsed: true,
    items: [
      { href: "/admin/inventory-debug", label: "Απόθεμα · debug", permission: "manage:orders",   tabIcon: "inventory_debug" },
      { href: "/admin/audit-log",       label: "Audit log",        permission: "read:audit-log",  tabIcon: "audit_log" },
      { href: "/admin/errors",          label: "Σφάλματα",         permission: "read:errors",     tabIcon: "errors" },
      { href: "/admin/system-errors",   label: "System errors",    permission: "read:errors",     tabIcon: "system_errors" },
      { href: "/admin/tracking",        label: "Tracking",          permission: "read:tracking",   tabIcon: "tracking" },
    ],
  },
];

/**
 * Server-renders the admin sidebar, filtering links by what the current
 * user is allowed to see. Permission checks run in parallel across every
 * section before any HTML is emitted.
 */
export default async function AdminSidebar() {
  const allItems = SECTIONS.flatMap((s) =>
    s.items.map((item) => ({ section: s, item }))
  );
  const visibility = await Promise.all(
    allItems.map(async ({ section, item }) => ({
      section,
      item,
      allowed: await checkPermission(item.permission),
    }))
  );

  // Group visible items back under their sections, preserving order.
  // Sections with zero visible items disappear entirely.
  const visibleBySection = new Map<string, NavItem[]>();
  for (const { section, item, allowed } of visibility) {
    if (!allowed) continue;
    const arr = visibleBySection.get(section.title) ?? [];
    arr.push(item);
    visibleBySection.set(section.title, arr);
  }

  // Reshape into the visible-sections array the client nav expects.
  // Sections with zero visible items are dropped entirely.
  const visibleSections = SECTIONS.map((section) => ({
    title: section.title,
    icon: section.icon,
    muted: section.muted ?? false,
    defaultCollapsed: section.defaultCollapsed ?? false,
    items: (visibleBySection.get(section.title) ?? []).map((i) => ({
      href: i.href,
      label: i.label,
      tabIcon: i.tabIcon,
    })),
  })).filter((s) => s.items.length > 0);

  return (
    <aside
      aria-label="Διαχείριση"
      className="cms-sidebar-scroll sticky top-6 self-start max-h-[calc(100vh-3rem)] overflow-y-auto overflow-x-hidden"
    >
      {/* Brand mark — anchors the sidebar visually. Not a nav link
          itself; Dashboard navigation lives below as a proper menu
          item so users can find it without guessing that "CMS" is
          clickable. Full-width hover bar matching the rest of the nav. */}
      <Link
        href="/admin"
        className="block mb-2 px-3.5 py-3 text-lg font-bold tracking-tight hover:bg-background/55 transition-colors"
      >
        CMS
      </Link>

      <SidebarNav sections={visibleSections} />

      {/* Bottom-pinned CTA to the live storefront. Styled as a distinct
          outlined button (not a subtle link) so it reads as a real
          action — "leave the CMS and look at the site". Insets from the
          sidebar edges via mx-3.5 since the outer aside no longer adds
          horizontal padding. */}
      <div className="pt-4 mt-4 mx-3.5 border-t border-foreground/10">
        <Link
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="cms-sidebar-cta"
        >
          <span>Δείτε το site</span>
          <span className="text-xs text-muted-foreground" aria-hidden>
            ↗
          </span>
        </Link>
      </div>
    </aside>
  );
}
