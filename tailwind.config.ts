import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      screens: {
        /* Extra-small breakpoint used by the brand lockup + header chrome
           ported from the reference design. */
        xs: "400px",
      },
      fontFamily: {
        /* Storefront headings / brand wordmark. --font-serif is injected by
           next/font (Cormorant Garamond) in the root layout. */
        serif: ["var(--font-serif)", "Cormorant Garamond", "Georgia", "serif"],
        /* Body + UI everywhere (storefront and admin). --font-sans = Inter. */
        sans: ["var(--font-sans)", "Inter", "system-ui", "-apple-system", "sans-serif"],
      },
      colors: {
        /* τοσοδούλικο warm-artisan brand palette — named utilities (text-terracotta,
           bg-warm-sand, border-stone-taupe, …) used by the ported logo lockup,
           header mega-nav and home-page sections. Semantic tokens above remain
           the source of truth for global theming; these are the raw brand hues. */
        canvas: "#FBF7F0",
        "warm-sand": "#F1E7D6",
        "stone-taupe": "#C9B79F",
        terracotta: "#B5694A",
        "muted-olive": "#8E9A74",
        "aegean-blue": "#7C9FA6",
        almond: "#E8D6C6",
        ink: "#2B2420",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Admin bottom-dock palette (see --dock* in globals.css). Carries the
        // <alpha-value> slot so opacity modifiers work (bg-dock/95, ring-dock-ring/50).
        dock: {
          DEFAULT: "hsl(var(--dock) / <alpha-value>)",
          elevated: "hsl(var(--dock-elevated) / <alpha-value>)",
          muted: "hsl(var(--dock-muted) / <alpha-value>)",
          active: "hsl(var(--dock-active) / <alpha-value>)",
          foreground: "hsl(var(--dock-foreground) / <alpha-value>)",
          ring: "hsl(var(--dock-ring) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
