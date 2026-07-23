/**
 * Brand identity — the single source of truth for everything that changes
 * when this codebase is deployed as a different shop.
 *
 * HOW TO RE-BRAND:
 *   1. Edit this file.
 *   2. Done. No other file references the brand name, logo, colors, or
 *      domain directly — they all import from here.
 *
 * See docs/RESKIN-GUIDE.md for the full reskinning guide.
 */

export const brand = {
  /** Display name shown in Header, Footer, OG image, page titles. */
  name: "τοσοδούλικο",

  /** One-liner for metadata description and OG tags. */
  tagline: "είδη βάπτισης & γάμου",

  /** Public-facing domain (used in emails, OG urls, sitemap). Falls back
   *  to NEXT_PUBLIC_SITE_URL at runtime for local dev. */
  domain: process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.tosodouliko.gr",

  /** Copyright holder name (may differ from display name). */
  copyright: "tosodouliko.gr",

  /** Contact / support email displayed in footer, transactional emails. */
  supportEmail: "info@tosodouliko.gr",

  /** Business contact details — shown in footer + contact page. The legal
   *  entity is the sole proprietorship «Ελένη Πυργιανάκη» (Ηράκλειο Κρήτης). */
  contact: {
    addressLine: "Λεωφόρος Καλοκαιρινού & Γιαμαλάκη 1, Ηράκλειο Κρήτης",
    phone: "2810 244 839",
    phoneHref: "+302810244839",
    email: "info@tosodouliko.gr",
    legalName: "Ελένη Πυργιανάκη",
    vat: "118919369",
    gemh: "181317527000",
  },

  /** OpenGraph image branding. */
  og: {
    /** CSS gradient for the auto-generated OG image background. */
    backgroundGradient: "linear-gradient(135deg, #FBF7F0, #F1E7D6)",
    /** Text color for the brand name on the OG image. */
    textColor: "#2B2420",
  },

  /** Email-template branding. */
  email: {
    /** Default "from" display name when no provider-level override is set. */
    fromName: "τοσοδούλικο",
    /** Domain used in placeholder examples in admin email-settings forms. */
    exampleDomain: "tosodouliko.gr",
  },
} as const;
