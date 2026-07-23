import Link from "next/link";
import { strings } from "@/config/strings";

/** Hardcoded top-level nav — no subcategories yet, add when the list is ready. */
const NAV_LINKS = [
  { label: strings.layout.nav.baptism, href: "/products?category=vaptisi" },
  { label: strings.layout.nav.wedding, href: "/products?category=gamos" },
  { label: strings.layout.nav.clothes, href: "/products?category=rouxa" },
  { label: strings.layout.nav.shoes, href: "/products?category=papoutsia" },
  { label: strings.layout.nav.giftItems, href: "/products?category=doro" },
  { label: strings.layout.nav.giftCards, href: "/products?category=dorokartes" },
];

/**
 * Desktop primary nav: hardcoded top-level links (no DB category tree),
 * then "Κλείστε Ραντεβού" and "Επικοινωνία". Server component.
 */
export default function MainNav() {
  return (
    <nav className="hidden lg:flex items-center gap-8 xl:gap-10 text-[13px] uppercase tracking-widest font-bold text-ink">
      {NAV_LINKS.map((link) => (
        <Link key={link.href} href={link.href} className="hover:text-terracotta py-2 transition-colors">
          {link.label}
        </Link>
      ))}
      <a
        href="https://calendly.com/tosodouliko/30min"
        target="_blank"
        rel="noreferrer"
        className="hover:text-terracotta py-2 transition-colors"
      >
        {strings.layout.nav.bookAppointment}
      </a>
      <Link href="/contact" className="hover:text-terracotta py-2 transition-colors">
        {strings.layout.nav.contact}
      </Link>
    </nav>
  );
}
