# Caching Strategy

## Page Categories

### 1. Auth-dependent pages — NO cache (force-dynamic)
These read auth state (`supabase.auth.getUser()`) and show personalized content.
Must always be fresh.

Pages: `/cart`, `/checkout`, `/checkout/success/*`, `/checkout/payment/*`,
`/account`, `/orders/*`, `/wishlist`, `/admin/**`

```tsx
export const dynamic = "force-dynamic";
```

### 2. Product catalog — SHORT cache (ISR 60s)
Inventory changes frequently (contention, orders, restocks). A 60-second
revalidation window means at worst a customer sees "in stock" for a product
that sold out 59 seconds ago — acceptable because the contention system
catches this at add-to-cart time.

Pages: `/products` (catalog grid), `/products/[slug]` (product detail)

```tsx
export const revalidate = 60; // Rebuild at most every 60 seconds
```

### 3. Static content — LONG cache (ISR 3600s or on-demand)
Pages that change rarely — about, terms, FAQ, etc.

```tsx
export const revalidate = 3600; // 1 hour
```

### 4. Fully static — Build-time only
Homepage (if content-managed) could be static with on-demand revalidation
when the admin changes it.

```tsx
export const revalidate = false; // Only at build time + on-demand
```

## On-demand Revalidation

When admin actions change data, call `revalidatePath()` or `revalidateTag()`
to bust the cache immediately. This is already done in most server actions.

Examples:
- Admin updates a product → `revalidatePath("/products")` + `revalidatePath("/products/[slug]")`
- Admin changes inventory → same
- Customer places an order → `revalidatePath("/checkout")` (already done)

## Data Fetch Caching (per-request dedup)

Within a single request, React's `cache()` deduplicates identical async calls.
This is used on the product detail page where `generateMetadata` and the page
component both call `getProductBySlug` — the second call returns the memoized
result from the first.

```tsx
import { cache } from "react";
const getProductBySlug = cache((slug: string) => _getProductBySlug(slug));
```

## What NOT to cache

- Cart content (personal, changes every click)
- Checkout session state (expiry-sensitive, contention-sensitive)
- Wishlist (personal)
- Admin pages (always need fresh data)
- API routes / webhooks (stateless handlers)
