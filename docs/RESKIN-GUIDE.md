# Reskin Guide — Designing an E-Shop

This codebase is the functional foundation for multiple e-shops. This guide tells you exactly how to create a new design without breaking anything.

## The Golden Rule

> **Components are functional code. CSS and page layout are design.**
>
> You never rewrite CartDrawer, CheckoutForm, FilterSidebar, or any
> existing component. They are the product. What changes between brands
> is: how they look (CSS), where they sit on the page (layout), what
> they say (strings), and what the brand is called (config).

---

## What You Edit

Only four locations need changes to create a new brand:

| What | File(s) | Purpose |
|---|---|---|
| **Brand identity** | `src/config/brand.ts` | Shop name, logo, tagline, copyright, OG image colors, email domain |
| **UI text / language** | `src/config/strings/el.ts` (or new locale file) | Every user-visible label, title, button, error message, description |
| **Visual theme** | `src/app/globals.css` | Colors, border-radius, spacing scale — all via CSS variables |
| **Page layouts** | `src/app/**/page.tsx` | Which components appear, in what grid/order, with what wrappers |

Additionally, you can **add** new decorative components (hero sections, banners, mosaics) — these are additive, never replacements.

**Everything not listed above is off-limits.** Don't edit files in: `src/components/features/`, `src/components/ui/`, `src/hooks/`, `src/actions/`, `src/lib/`, `src/types/`, `supabase/`.

---

## 1. Brand Identity (`src/config/brand.ts`)

One file. Every component reads from it.

```ts
export const brand = {
  name: "MyShop",
  tagline: "children's clothing",
  copyright: "MyShop Ltd",
  supportEmail: "hello@myshop.com",
  og: {
    backgroundGradient: "linear-gradient(135deg, #dbeafe, #93c5fd)",
    textColor: "#1e3a5f",
  },
  email: {
    fromName: "MyShop",
    exampleDomain: "myshop.com",
  },
};
```

### 2. UI Text (`src/config/strings/`)

Every label, title, button, placeholder, error message, and description is in `src/config/strings/el.ts`. Organized by area:

```
strings.layout.nav.*          — Header (Wishlist, Cart, Account, Sign In)
strings.layout.footer.*       — Footer links and sections
strings.products.*            — Catalog page
strings.cart.*                — Cart
strings.checkout.*            — Checkout form and flow
strings.contention.*          — Inventory wait modals and widgets
strings.filters.*             — Price/age filter sidebar
strings.auth.*                — Sign in / sign up
strings.errors.*              — Error pages
strings.form.*                — Shared field labels (Name, Email, Phone, etc.)
strings.validation.*          — Validation messages
strings.wishlist.*            — Wishlist page
strings.home.*                — Homepage
```

**To change language:** Copy `el.ts` to `en.ts`, translate, update the import in `src/config/strings/index.ts`.

**To change copy:** Edit `el.ts` directly. Placeholders like `{count}` get filled automatically — don't remove them.

**Business options** (payment methods, delivery methods, carriers, countries) and their labels live in `src/config/storefront.ts`. Edit there to add/remove options or change their display names.

### 3. Visual Theme (`src/app/globals.css`)

All colors are CSS variables in HSL format. Override them to completely change the visual identity:

```css
:root {
  --primary: 221 83% 53%;              /* main buttons, links, emphasis */
  --primary-foreground: 0 0% 100%;     /* text on primary */
  --destructive: 0 84.2% 60.2%;       /* errors, delete actions */
  --muted: 240 4.8% 95.9%;            /* subtle backgrounds */
  --muted-foreground: 240 3.8% 46.1%; /* secondary text */
  --border: 240 5.9% 90%;             /* all borders */
  --background: 0 0% 100%;            /* page background */
  --radius: 0.5rem;                   /* border-radius (0 = sharp, 1rem = rounded) */

  /* Contention UI (waiting badges, promotion badges, OOS overlays) */
  --badge-waiting: 48 96% 89%;
  --badge-promoted: 142 76% 94%;
  --badge-oos-overlay: 0 0% 9% / 0.85;
}
```

Every component uses Tailwind classes that resolve through these variables (`bg-primary`, `text-muted-foreground`, `border`, etc.). Change the variable values — every component updates.

### 4. Page Layouts (`src/app/**/page.tsx`)

Page files have two parts. **Only the second part is yours to change:**

```tsx
// PART 1: Data loading — DO NOT TOUCH
const data = await searchVariants({ ... });
const facets = await getCatalogFacets();

// PART 2: Layout composition — SAFE TO MODIFY
return (
  <main className="grid grid-cols-[220px_1fr] gap-6">
    <FilterSidebar facets={facets} />
    <ProductGrid cards={data.cards} />
  </main>
);
```

**Safe changes:**
- Grid structure: `grid-cols-[220px_1fr]` → `grid-cols-1`
- Spacing: `gap-6` → `gap-8`
- Component order: filter sidebar below the grid instead of beside it
- Wrapper elements: add `<section>`, change padding
- Responsive breakpoints: `md:grid-cols-3` → `lg:grid-cols-4`
- Add new decorative components between the functional ones

**Unsafe changes:**
- Removing a functional component (e.g., deleting `<FilterSidebar />`)
- Changing the props passed to a component
- Editing anything above the `return` statement

**Example — different catalog layout:**
```tsx
// Current: sidebar layout
<main className="grid grid-cols-[220px_1fr] gap-6">
  <FilterSidebar facets={facets} />
  <ProductGrid cards={data.cards} />
</main>

// Alternative: top-filter layout
<main className="flex flex-col gap-4">
  <CollapsibleFilters facets={facets} />   {/* new decorative wrapper */}
  <ProductGrid cards={data.cards} />        {/* same component, unchanged */}
</main>
```

---

## Adding a New Page

1. Create `src/app/<route>/page.tsx`
2. Import `{ strings }` and `{ brand }` from config
3. Add `export const metadata = { title: strings.xxx.pageTitle };`
4. Write your layout JSX

```tsx
// src/app/about/page.tsx
import { strings } from "@/config/strings";
import { brand } from "@/config/brand";

export const metadata = { title: strings.layout.footer.about };

export default function AboutPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-4">{strings.layout.footer.about}</h1>
      <p>{brand.name} is a ...</p>
    </main>
  );
}
```

---

## Adding a New Decorative Component

New components (hero banners, promotional sections, trust badges) are always additive.

1. Create the file in `src/components/features/`
2. Make it pure presentation — receives data via props, never fetches data
3. Mount it in a page template

```tsx
// src/components/features/homepage/HeroBanner.tsx
interface Props {
  title: string;
  subtitle: string;
  ctaHref: string;
  ctaLabel: string;
}

export default function HeroBanner({ title, subtitle, ctaHref, ctaLabel }: Props) {
  return (
    <section className="h-[400px] flex items-center justify-center text-center bg-primary">
      <div>
        <h1 className="text-4xl font-bold text-primary-foreground">{title}</h1>
        <p className="text-lg text-primary-foreground/80 mt-2">{subtitle}</p>
        <a href={ctaHref} className="mt-4 inline-block bg-background text-foreground px-6 py-3 rounded">
          {ctaLabel}
        </a>
      </div>
    </section>
  );
}
```

Then mount in the page:
```tsx
// src/app/page.tsx
<HeroBanner
  title={strings.home.welcome}
  subtitle={brand.tagline}
  ctaHref="/products"
  ctaLabel={strings.home.browseProducts}
/>
```

**Rules for new components:**
- Use CSS variables (`bg-primary`, `text-muted-foreground`) — never hardcoded colors
- Use strings from config — never hardcoded text
- Receive data via props — never import from `src/lib/supabase/` or `src/actions/`

---

## Lines You Must Never Remove

These are in `src/app/layout.tsx`. They're invisible most of the time — they listen for realtime events and show modals/widgets when inventory contention occurs. Removing them silently breaks the queue system.

```tsx
<PromotionWatcher />
<CollapseWatcher />
<SoftWaitNextInLineWatcher />
```

These are in specific pages and are equally load-bearing:

| Component | Page | Remove = |
|---|---|---|
| `CheckoutSessionGuard` | `/checkout` | Session expires silently, user gets stuck |
| `ContentionBanner` | `/checkout` | Holder doesn't see waiters |
| `CheckoutAuthBanner` | `/checkout` | No signup detour, no timer extension |
| `export const dynamic = "force-dynamic"` | Multiple pages | Stale cached data served |
| `export const metadata = { ... }` | All pages | Page loses its title |

---

## Testing After Design Changes

1. `npx tsc --noEmit` — must pass with zero errors
2. Open every modified page in the browser — confirm it renders
3. Test cart: add item, update quantity, remove, proceed to checkout
4. Test responsive: check at 375px (mobile) and 1280px (desktop)
5. Navigate to `/nonexistent-route` — 404 page should render correctly
6. If you touched checkout or cart pages: test the contention flow with two browsers

---

## Common Pitfalls

| Mistake | What breaks | How to avoid |
|---|---|---|
| Removing a watcher from `layout.tsx` | Contention modals never appear | Never remove `PromotionWatcher`, `CollapseWatcher`, `SoftWaitNextInLineWatcher` |
| Changing props passed to a functional component | TypeScript error or runtime crash | Only change layout wrappers, never prop shapes |
| Hardcoding a string instead of using `strings.*` | Won't update when switching brands | Always add to `el.ts` first, then reference |
| Using a hardcoded color like `bg-blue-500` | Won't theme with CSS variables | Use `bg-primary`, `text-muted-foreground`, or add a CSS variable |
| Editing files in `src/actions/`, `src/lib/`, or `src/types/` | Business logic breaks | These are off-limits for design changes |
| Importing `createClient` in a decorative component | Breaks client/server boundary | Decorative components receive data via props |
| Deleting `export const dynamic = "force-dynamic"` | Stale cached data | Keep it on any page that reads auth or session state |
