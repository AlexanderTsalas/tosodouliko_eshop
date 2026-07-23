import { checkPermission } from "@/lib/rbac";
import BottomDockNav from "./BottomDockNav";

interface NavItem {
  href: string;
  label: string;
  permission: string;
  tabIcon: TabIconKey;
}

export type SectionIconKey =
  | "catalog"
  | "sales"
  | "suppliers"
  | "marketing"
  | "settings"
  | "team"
  | "ops";

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
  title: string;
  icon: SectionIconKey;
  items: NavItem[];
  muted?: boolean;
}

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
    items: [
      { href: "/admin/suppliers",       label: "Προμηθευτές",            permission: "manage:suppliers", tabIcon: "suppliers" },
      { href: "/admin/supply-orders",   label: "Παραγγελίες Προμηθειών", permission: "manage:suppliers", tabIcon: "supply_orders" },
      { href: "/admin/reports/margins", label: "Περιθώρια Κέρδους",      permission: "manage:products",  tabIcon: "margins" },
    ],
  },
  {
    title: "Marketing",
    icon: "marketing",
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
    items: [
      { href: "/admin/inventory-debug", label: "Απόθεμα · debug", permission: "manage:orders",   tabIcon: "inventory_debug" },
      { href: "/admin/audit-log",       label: "Audit log",        permission: "read:audit-log",  tabIcon: "audit_log" },
      { href: "/admin/errors",          label: "Σφάλματα",         permission: "read:errors",     tabIcon: "errors" },
      { href: "/admin/system-errors",   label: "System errors",    permission: "read:errors",     tabIcon: "system_errors" },
      { href: "/admin/tracking",        label: "Tracking",          permission: "read:tracking",   tabIcon: "tracking" },
    ],
  },
];

export default async function AdminBottomDock() {
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

  const visibleBySection = new Map<string, NavItem[]>();
  for (const { section, item, allowed } of visibility) {
    if (!allowed) continue;
    const arr = visibleBySection.get(section.title) ?? [];
    arr.push(item);
    visibleBySection.set(section.title, arr);
  }

  const visibleSections = SECTIONS.map((section) => ({
    title: section.title,
    icon: section.icon,
    muted: section.muted ?? false,
    items: (visibleBySection.get(section.title) ?? []).map((i) => ({
      href: i.href,
      label: i.label,
      tabIcon: i.tabIcon,
    })),
  })).filter((s) => s.items.length > 0);

  return <BottomDockNav sections={visibleSections} />;
}
