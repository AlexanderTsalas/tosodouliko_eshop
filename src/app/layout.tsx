import type { Metadata } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import { brand } from "@/config/brand";

/**
 * Brand typography. Inter is the body/UI sans everywhere (storefront + admin);
 * Cormorant Garamond is the elegant serif used for storefront headings and the
 * brand wordmark. Both are exposed as CSS variables consumed by Tailwind's
 * font-sans / font-serif families (see tailwind.config.ts). `display: swap`
 * avoids invisible-text flashes; subsets cover Latin + Greek for the EL copy.
 */
const inter = Inter({
  // next/font's Inter metadata exposes no `greek` subset, so Greek body text
  // falls back to the system sans (system-ui renders Greek cleanly). Headings
  // and the wordmark use Cormorant, which DOES ship a greek subset below.
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  // Same greek-subset limitation as Inter in this next/font version. Greek
  // headings/wordmark fall back to the serif stack (Georgia renders Greek).
  // To get true Cormorant-Greek glyphs we'd self-host the woff2 via
  // next/font/local — flagged for a later decision.
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: brand.name,
    template: `%s | ${brand.name}`,
  },
  description: `${brand.name} — ${brand.tagline}.`,
  metadataBase: new URL(brand.domain),
};

/**
 * Root layout — bare HTML shell only. The storefront chrome (Header,
 * Footer, contention watchers) lives in src/app/(storefront)/layout.tsx;
 * the admin shell lives in src/app/admin/layout.tsx. Keeping the root
 * deliberately empty means a top-level error / not-found page renders
 * without any chrome contamination (no Header trying to fetch data, no
 * Footer assuming storefront context).
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="el"
      suppressHydrationWarning
      className={`${inter.variable} ${cormorant.variable}`}
    >
      <body className="min-h-screen bg-background font-sans antialiased flex flex-col">
        {children}
      </body>
    </html>
  );
}
