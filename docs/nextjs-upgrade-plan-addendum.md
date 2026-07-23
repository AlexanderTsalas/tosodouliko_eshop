# Next.js Upgrade Plan — Addendum (Second-Pass Findings)

**Date:** 2026-06-11
**Companion to:** [docs/nextjs-upgrade-implementation-plan.md](nextjs-upgrade-implementation-plan.md)
**Purpose:** Document gaps and architectural realities the first-pass investigation missed. Updates effort estimates, surfaces new architectural opportunities, and clarifies critical distinctions that affect execution.

---

## TL;DR — what changed after the second pass

| Topic | First-pass estimate | Second-pass reality | Impact |
|---|---|---|---|
| `createClient()` async ripple | "~50+ call sites" | **268 distinct call sites across 236 files** | Phase 1 effort revised from 4-5h to 6-9h. Codemod strongly recommended. |
| `createAdminClient()` migration | Implied to need same treatment | **Stays sync** — uses service-role key, no cookies | Removes a phantom risk; clarifies which calls actually need awaiting |
| Stripe React 19 risk | Audit reported Stripe Elements as "GREEN compatible" | **Stripe Elements is NOT used** in this codebase. Stripe is integrated via Checkout Sessions (redirect flow) only. The `@stripe/react-stripe-js` dep is imported in comments only | Stripe React 19 risk dropped to near-zero. Possible dep removal. |
| Cron schedule configuration | I initially framed as "missing vercel.json" | **Wrong framing** — actual production schedule is via `pg_cron + pg_net` HTTP-POSTs from Postgres. Two of three routes already scheduled via migrations; the third (`reap-orphan-media`) had no migration yet. Now fixed. | No vercel.json needed; the established pattern is pg_cron-based |
| `<form action>` patterns | Treated as standard React 18 forms | **15+ forms already use `action={handler}` pattern** with manual useTransition | React 19 migration opportunity: `useActionState` would simplify these |
| Optimistic UI | Custom-built per component | **No `useOptimistic` adoption** | Architectural opportunity post-migration |
| Env vars in zod schema | 3 missing (`IMAGE_HOSTNAMES`, `STORAGE_PROVIDER`, `SERVER_SIDE_FORMAT_FALLBACK`) | **At least 7 missing** — also `CARRIER_SECRETS_KEY`, `EMAIL_SECRETS_KEY`, `MFA_TOKEN_PEPPER`, `PAYMENT_PROVIDER` | Phase 0 scope grows slightly |

**Net effect on the architecture:** the original plan's strategy is still correct. The execution numbers and a few additions need updating. No fundamental rewrite needed.

---

## Critical clarification — two Supabase client factories, only ONE needs async migration

This was implicit in the first-pass plan but warrants its own callout because confusion would cost hours.

### `createClient` from `src/lib/supabase/server.ts` — async migration target

```ts
// Uses cookies() — MUST become async in Next.js 15
import { cookies } from "next/headers";

export function createClient() {
  const cookieStore = cookies();  // ← becomes await cookies()
  // ...
}
```

- **268 distinct call sites** across **236 files**
- Used when the action needs to act AS the authenticated user (RLS, ownership checks)
- This is the one Phase 1 of the original plan addresses

### `createAdminClient` from `src/lib/supabase/admin.ts` — STAYS SYNCHRONOUS

```ts
// Uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — no cookies
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { /* ... */ }
  );
}
```

- **171 call sites** across the codebase
- Bypasses RLS via service-role key
- Does NOT call `cookies()` or `headers()`
- **NO async migration needed** — these calls stay as `const admin = createAdminClient();`

### Implication for execution

Many actions import BOTH factories (verified: `addresses/saveAddress.ts`, `cart/addToCartWithContentionCheck.ts`, many more). In each such file:

```ts
// In Phase 1, this:
const supabase = createClient();           // ← needs await
const admin = createAdminClient();         // ← STAYS SYNC

// becomes:
const supabase = await createClient();     // changed
const admin = createAdminClient();         // unchanged
```

**Codemod implication:** a blanket "add await to every createClient" codemod is unsafe — it would incorrectly add await to `createAdminClient()`. Use targeted matchers:

```bash
# Manual sed pattern that targets ONLY createClient (not Admin):
# Match: `= createClient()` followed by no opening parenthesis (the call itself)
# Pattern: const x = createClient();  →  const x = await createClient();
# Avoid: createAdminClient()
```

The TypeScript compiler will catch missed awaits because the return type becomes `Promise<SupabaseClient>`. Trust it.

---

## Architectural realities the first pass underweighted

### 1. Stripe Elements is not used — Stripe risk is dramatically lower

The Stripe integration is **redirect-flow Checkout Sessions**, not embedded Elements:

```ts
// Pattern in src/lib/payment/providers/stripe.ts:
// - Create a Checkout Session via Stripe API
// - Return session.url
// - Browser navigates to Stripe-hosted page
// - On success, Stripe redirects back to /checkout/success/[id]
// - The webhook handler processes the actual payment confirmation
```

The codebase imports `@stripe/react-stripe-js` 3.0.0 but only references the import in **2 places**: a comment in `payment/types.ts` and a comment in `middleware.ts`. The component layer doesn't actually use Stripe Elements at all.

**Implications for migration:**

- **React 19 compatibility of @stripe/react-stripe-js is now near-zero risk** — if there's no actual usage, the dep being React 18-compatible doesn't block the upgrade
- **Possible dep cleanup** during Phase 5: verify, then `npm uninstall @stripe/react-stripe-js` to remove the unused dep
- Stripe-server-side (`stripe` npm package, 17.4.0) has no React dependency and is unaffected by the upgrade

### 2. `<form action={...}>` pattern is already in use — React 19 architecture opportunity

15+ admin forms use the modern pattern of passing a function reference to the form's `action` attribute, paired with `useTransition` for pending state:

```tsx
// Current pattern (e.g., CategoryForm.tsx, DiscountForm.tsx, etc.):
function handleSubmit(formData: FormData) {
  setError(null);
  // ... build payload
  startTransition(async () => {
    const r = await createCategory(payload);
    if (!r.success) { setError(r.error); return; }
    router.push("/admin/categories");
  });
}

return <form action={handleSubmit}>...</form>;
```

This works in React 19 unchanged. But React 19 introduces `useActionState` (formerly `useFormState`) which would clean this up:

```tsx
// React 19 pattern:
const [state, formAction, isPending] = useActionState(
  async (prevState, formData) => {
    // ... handle submit
    return { error: null };
  },
  { error: null }
);

return <form action={formAction}>...</form>;
```

Benefits:
- Pending state managed by the framework
- Error state propagates naturally
- Eliminates manual `useState + useTransition` boilerplate

**Recommendation:** Defer this refactor to **Phase 5 (polish) or post-migration**. It's optional and high-volume (15+ forms). Making it part of the version-bump phase would inflate scope.

### 3. `useOptimistic` adoption opportunity

The codebase has hand-rolled optimistic UI in several places:

- [`ProductImagesComboTab.tsx`](src/components/admin/products/images/ProductImagesComboTab.tsx) — manual `setImages(...)` before the server confirms; `setImages(initialImages)` on rollback
- [`FilterSidebar.tsx`](src/components/features/catalog/FilterSidebar.tsx) — `optimisticFilters` local state with reconciliation
- [`CartDrawer`](src/components/features/cart/) — optimistic quantity updates
- [`ContentionBanner`](src/components/features/contention/ContentionBanner.tsx) — countdown + optimistic dismiss

React 19's `useOptimistic` hook handles this declaratively:

```ts
const [optimisticImages, setOptimisticImages] = useOptimistic(images);

async function handleSetCover(id: string) {
  setOptimisticImages((prev) => prev.map((i) => ({...i, is_cover: i.id === id})));
  await setProductImageCover({ imageId: id });
  // Reconciliation is automatic when the server state updates
}
```

**Recommendation:** **Defer to Phase 5 or a separate task.** The current implementations work fine and migrating them is risk-with-no-immediate-payoff during the version bump.

### 4. `after()` API for post-response work

React 19 / Next.js 15 introduces `after()` for code that should run AFTER the response is sent (without blocking the user):

```ts
import { after } from "next/server";

export async function recordProductImage(...) {
  // ... do the upload + DB insert
  const result = await ...;

  after(() => {
    // Runs after response is sent — non-blocking
    logAuditEvent({ ... });
    sendNotification({ ... });
  });

  return result;
}
```

This is **highly relevant** for our codebase. We currently do:
- `logAuditEvent` synchronously in many actions (audit trail before returning)
- `dispatchWishlistNotifications` (we recently parallelized this with Promise.all)
- `crmSyncContact` background calls

These all add latency to the user's request. Moving them to `after()` removes that latency without changing reliability (the after callback still runs, just outside the request critical path).

**Recommendation:** **Phase 5 candidate.** Wait until we're stable on Next.js 15. Then audit ~15 server actions that do post-write side-effects and migrate them to `after()`. Estimated effort: 2-4 hours.

### 5. `instrumentation.ts` for observability

Next.js 15 stabilized the `instrumentation.ts` file convention. We don't have one. This is the entry point for:
- OpenTelemetry / Sentry / Datadog setup
- Custom request lifecycle hooks
- Error monitoring beyond Vercel's built-in

**Recommendation:** Out of scope for the upgrade. Consider as a follow-up task if observability becomes a need.

---

## Cron scheduling — the actual architecture

I initially framed cron scheduling as a "missing vercel.json gap." Investigating the code more carefully revealed that's wrong — **the production scheduler is `pg_cron + pg_net`, not Vercel Cron**. The codebase uses Postgres-native scheduling throughout, and `pg_net` to HTTP-POST from inside the database to the Next.js endpoint when a job needs TS (email, image processing, external API call).

### Why this architecture is correct

1. **Works identically on Supabase Cloud + self-hosted Supabase** — no Vercel-specific behavior
2. **No Vercel Pro tier required** — Vercel Cron is a paid feature; pg_cron is free
3. **Schedule lives in migrations** — auditable, deployable alongside table schema
4. **The TS code stays stateless** — Postgres is the only thing that knows the cron schedule
5. **Survives Vercel deployment changes** — schedules persist in the DB, not the deployment config

### Verified existing schedules

Two of the three cron routes already have pg_cron migrations:

| Route | Schedule | Migration |
|---|---|---|
| `/api/cron/wishlist-advance` | `* * * * *` (every minute) | [20260530000001_wishlist_cron_via_pg_net.sql](../supabase/migrations/20260530000001_wishlist_cron_via_pg_net.sql) |
| `/api/cron/courier-directories` | `0 3 * * 0` (Sunday 03:00 UTC) | [20260602000002_courier_directories_cron_via_pg_net.sql](../supabase/migrations/20260602000002_courier_directories_cron_via_pg_net.sql) |
| `/api/cron/reap-orphan-media` | `15 4 * * *` (nightly 04:15 UTC) | [20260611000022_reap_orphan_media_cron_via_pg_net.sql](../supabase/migrations/20260611000022_reap_orphan_media_cron_via_pg_net.sql) **(just added)** |

Plus six SQL-only `cron.schedule` migrations for jobs that don't need HTTP (don't go through a Next.js route at all):

- `20260524000001_reap_stale_soft_sessions.sql` — cleanup expired cart sessions
- `20260525000002_opportunistic_cleanup_and_reconciliation.sql`
- `20260525000004_heartbeat_fallback.sql`
- `20260526000003_priority_hold_reaper.sql`
- `20260601000001_conditional_contention_timer.sql`
- `20260601000008_reap_orphaned_anon_customers.sql`

### Gap that DID exist — now fixed

`/api/cron/reap-orphan-media` was built in Phase 7 of the product-images plan but the pg_cron schedule migration was never shipped. Just landed [20260611000022_reap_orphan_media_cron_via_pg_net.sql](../supabase/migrations/20260611000022_reap_orphan_media_cron_via_pg_net.sql) following the established pattern (nightly 04:15 UTC). Apply with `npx supabase db push`.

### What this means for the Next.js upgrade

**No change to the migration plan.** Cron scheduling is a Postgres concern, decoupled from the Next.js version. The Next.js 14 → 16 upgrade doesn't affect how schedules fire — they keep pointing at the same HTTP endpoints. The only thing to verify during Phase 3 is that the cron Bearer-auth flow still works (which the audit confirmed it does).

---

## Updated env-var formalization scope (Phase 0)

The first-pass plan identified 3 missing env vars in `src/lib/env.ts`. The second pass found at least 4 more:

| Env var | Used in | Status |
|---|---|---|
| `IMAGE_HOSTNAMES` | next.config.mjs | Was in original plan |
| `STORAGE_PROVIDER` | src/lib/storage/index.ts | Was in original plan |
| `SERVER_SIDE_FORMAT_FALLBACK` | src/actions/product-images/recordProductImage.ts | Was in original plan |
| `CARRIER_SECRETS_KEY` | src/lib/courier/encryption.ts:23 | **NEW** — secret for courier credentials encryption |
| `EMAIL_SECRETS_KEY` | src/lib/email/encryption.ts:25 | **NEW** — secret for email credentials encryption |
| `MFA_TOKEN_PEPPER` | src/lib/mfa/tokens.ts:30 | **NEW** — MFA pepper |
| `PAYMENT_PROVIDER` | src/lib/payment/index.ts:21 | **NEW** — payment provider selector |

Updated Phase 0.2 schema addition:

```ts
// src/lib/env.ts — full additions
IMAGE_HOSTNAMES: z.string().optional().default("**.supabase.co"),
STORAGE_PROVIDER: z.enum(["supabase", "s3", "r2", "minio", "b2"]).optional().default("supabase"),
SERVER_SIDE_FORMAT_FALLBACK: z.enum(["true", "false"]).optional().default("false"),

// Encryption keys — required in production
CARRIER_SECRETS_KEY: z.string().optional(),  // hex-encoded AES key
EMAIL_SECRETS_KEY: z.string().optional(),    // hex-encoded AES key
MFA_TOKEN_PEPPER: z.string().min(16).optional(),

// Payment provider
PAYMENT_PROVIDER: z.enum(["stripe", "mock"]).optional(),
```

The optionality is preserved because some are dev-only or per-feature. Production env validation should be tightened separately.

---

## Updated risk register — additions to the original

The original plan had 10 risks. Two new ones from the second pass:

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Codemod incorrectly awaits `createAdminClient()`** | Medium (if not careful) | High (admin operations fail silently with promise objects) | Use targeted regex or hand-migrate using TS compiler errors. NEVER apply a blanket "add await to all createClient*()" codemod. |
| **Cron routes silently not running in production** | Low (now verified) | High (data drifts) | All three production cron routes are now scheduled via pg_cron + pg_net migrations. Phase 3.5 verifies each route returns 200 when hit with the Bearer token. To confirm production schedules are actually firing, query `SELECT * FROM cron.job;` on the Supabase database — should show 3 HTTP-POST jobs (wishlist-advance, courier-directories, reap-orphan-media) plus the 6 SQL-only reapers. |

---

## Architectural opportunities surfaced (Phase 5+ candidates)

Listed here so they're documented but explicitly **out of the upgrade scope**:

| Opportunity | Effort | Why defer | When to do |
|---|---|---|---|
| Migrate 15+ forms to `useActionState` | 4-6h | High volume; touches forms with active business value | After Phase 4 stable for ≥ 1 week |
| Migrate custom optimistic UI to `useOptimistic` | 3-5h | Working code; refactor risk > benefit during version bump | After Phase 4 stable; pair with related feature work |
| Move audit-log / notification side-effects to `after()` | 2-4h | Latency win is nice-to-have | Phase 5 of upgrade or standalone task |
| Add `instrumentation.ts` for observability | 4-8h | Separate concern from upgrade | When observability becomes a need |
| Remove unused `@stripe/react-stripe-js` dep | 0.5h | Verify zero usage first | Phase 5 cleanup |
| Migrate `unstable_cache` to `'use cache'` directive | 1-2h | Optional in 16; can stay on `unstable_cache` | Phase 4 (alongside Next.js 16 bump) OR Phase 5 |

---

## Updated effort summary

The original plan estimated **17-29 hours total over 3-5 working days**. The second pass adjusts:

| Phase | Original | Updated | Reason |
|---|---|---|---|
| 0 | 1-2h | 1.5-2h | +30min for 4 additional env vars |
| 1 | 4-5h | **6-9h** | 268 call sites instead of ~50 |
| 2 | 6-10h | 6-10h | Unchanged — work is the same regardless of count |
| 3 | 2-4h | 2-4h | Unchanged |
| 4 | 2-4h | 2-4h | Unchanged |
| 5 | 2-4h | 2-4h | Unchanged (architectural opportunities are explicitly out of scope) |
| **Total** | **17-29h** | **19.5-33h** | +2.5-4h, mostly Phase 1 |

**Day estimate: 3-5 working days remains correct.** The expanded Phase 1 is mechanical work with the TypeScript compiler doing the verification; it's not harder, just longer.

---

## Codebase health observations (unchanged in 19 — no migration needed)

Confirming the absence of red flags so they don't get forgotten as risks:

- **0** uses of `React.PropTypes` ✓
- **0** uses of `defaultProps` on function components ✓
- **0** uses of `useFormState` / `useFormStatus` (no rename needed) ✓
- **0** class components ✓
- **0** uses of `unstable_noStore` / `noStore` ✓
- **0** uses of `next/dynamic` with `ssr: false` ✓
- **0** uses of `draftMode()` ✓
- **0** uses of `forwardRef` on user code — only Radix UI primitives wrapped in `src/components/ui/` (works in React 19) ✓
- **No** layouts with `params` (no dynamic-segment layouts) ✓
- **No** global-error.tsx (root error.tsx covers it; both are fine) ✓
- **No** `instrumentation.ts` (works fine; can be added later as enhancement) ✓
- **0** uses of `experimental_` APIs from React itself ✓

The codebase is **clean of pre-React-19 anti-patterns**. The migration is mechanical, not architectural surgery.

---

## Updated decision points

Adding to the original 6 decision points:

7. **Stripe React deps:** verify `@stripe/react-stripe-js` truly has zero runtime usage; if so, uninstall as part of Phase 5 (lower dep surface = fewer future React 19 mismatch risks). Saves nothing immediately but reduces noise.

8. **Cron scheduling source:** resolved. Production crons fire via pg_cron + pg_net (see "Cron scheduling — the actual architecture" section). The missing `reap-orphan-media` schedule migration has been added. Verify in production with `SELECT * FROM cron.job;` after `supabase db push`.

9. **Codemod customization:** if using `@next/codemod next-async-request-api`, also customize for `createClient()` only (NOT `createAdminClient()`). Either write a sed/awk script or hand-migrate using TS compiler-driven errors. The blanket codemod approach risks breaking admin client calls.

10. **Phase 5 architectural opportunities:** decide which (if any) to bundle with the migration vs do as follow-up tasks. Default recommendation: defer ALL of them to standalone tasks AFTER Next.js 16 has been stable in production for ≥ 1 week.

---

## Third-pass findings (final-context verification)

A final investigation pass before execution confirmed everything in the second pass and surfaced 5 additional items — most are "nothing's broken" confirmations that remove categories from the concern list, plus one genuinely actionable note.

### Categories now confirmed safe (concerns eliminated)

| Category | Status | Implication |
|---|---|---|
| **API route handlers with dynamic segments (`[param]/route.ts`)** | **NONE EXIST** | All 9 API routes have static paths. Eliminates a whole category of potential async-params concerns. Phase 2.4 only needs to migrate page.tsx files, not route.ts files. |
| **`useFormStatus` (separate from `useFormState`)** | NONE | No migration needed |
| **`next/font` usage** | NONE | No migration needed |
| **`next/script` usage** | NONE | No migration needed |
| **`.github/workflows/` or other CI configs** | NONE EXIST | No pinned dependency versions in CI to update |
| **`generateStaticParams`** | NONE | No build-time static generation of dynamic routes — all `[slug]` / `[id]` pages are SSR or ISR |
| **`cookies().set()` / `cookies().delete()` in API route handlers** | NONE | Only middleware mutates cookies; auth flow is clean |
| **`notFound()` inside try/catch (anti-pattern)** | NONE | All usage is correctly inside `if` conditions |
| **Layouts with `params`** | NONE | All layouts are pass-through; no dynamic-segment layouts |
| **Top-level `"use server"` file directives (outside `src/actions/`)** | NONE | Server actions stay in their own tree; no surprises |

### Actionable third-pass finding

**`React.cache()` from `react` is used in 10 files** as per-request memoizers around functions that call `createClient()`:

```ts
// src/lib/courier/listActiveCarriers.ts
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const listActiveCarriers = cache(async (): Promise<DeliveryCarrier[]> => {
  const supabase = createClient();  // ← Phase 1 changes this
  // ...
});
```

The 10 files using `React.cache()` are:

1. `src/app/(storefront)/products/[slug]/page.tsx` — page-level memoizer for `getProductBySlug`
2. `src/lib/courier/getCapabilities.ts`
3. `src/lib/courier/listActiveCarriers.ts`
4. `src/lib/courier/listActiveCustomDeliveryMethods.ts`
5. `src/lib/multi-currency/getCurrencies.ts`
6. `src/lib/multi-currency/getCurrencyRates.ts`
7. `src/lib/multi-currency/getDefaultCurrency.ts`
8. `src/lib/rbac/checkPermission.ts`
9. `src/lib/site-search/getProductBySlug.ts`
10. `src/lib/translation-layer/getAvailableLocales.ts`

**Phase 1 implication:** every `createClient()` call inside these wrappers needs the same `await` treatment as direct call sites. The `React.cache()` wrapper itself has no behavior change in React 19 — it correctly memoizes the awaited Promise. But code reviewers might assume cache() somehow "fixes" the async ripple; it doesn't. The `await createClient()` change applies inside the wrapper body just like everywhere else.

These 10 sites are already counted in the 268 total. Flagging this so reviewers don't get confused by the `cache()` wrapper appearing to be "different" — it isn't.

### Storefront client-component `useSearchParams` (informational)

7 client components use `useSearchParams()` from `next/navigation`. The hook stays synchronous in Next.js 15 (it's a client hook, not the request API), so no migration is needed.

However, in Next.js 15 the behavior is documented more explicitly: `useSearchParams()` causes the route to render dynamically unless the component is wrapped in `<Suspense>`. Behavior identical to Next.js 14 — but if any storefront route shows a "Bailing out to client-side rendering" warning, that's why.

Two storefront-side usages worth knowing about:

- [src/components/features/catalog/FilterSidebar.tsx](src/components/features/catalog/FilterSidebar.tsx) — used in `/products` which has `revalidate = 60`. The route auto-falls-back to dynamic for the requests that use search params (already current behavior in 14; explicit in 15).
- [src/components/features/cart/SessionExpiredAlert.tsx](src/components/features/cart/SessionExpiredAlert.tsx) — used in `/cart` which is `force-dynamic`. No behavior change.

The other 5 usages are in admin components (`force-dynamic` pages), so no change. **Not a Phase 2 task** — file under "informational; ignore unless warnings appear post-upgrade."

### Suspense boundary inventory

Only 2 `<Suspense>` boundaries exist in the codebase:

- `src/app/(storefront)/cart/page.tsx:23` — fallback={null}
- `src/components/layout/Header.tsx:45` — fallback with cart link placeholder

React 19 improves Suspense behavior (better hydration error boundaries, improved transitions), but these 2 sites use standard patterns that are unchanged. No migration needed.

### Auth callback route specifics

[src/app/(storefront)/auth/callback/route.ts](src/app/%28storefront%29/auth/callback/route.ts) is the Supabase email-confirmation handler. It uses `createClient()` directly:

```ts
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // ...
  const supabase = createClient();  // ← Phase 1 needs await
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  // ...
}
```

This is one of the 268 call sites. Mentioned explicitly because it's a route handler (not a server action), and route handlers are sometimes overlooked in audits. The TypeScript compiler will catch it during Phase 1 if missed.

Note: `url.searchParams.get("code")` is on the URL object (from `new URL(request.url)`), NOT the Next.js request API. Stays synchronous. No change needed.

### Root + segment layouts

All three layout files are minimal and require no migration:

- [src/app/layout.tsx](src/app/layout.tsx) — Root layout. No params, no async. `lang="el"` with `suppressHydrationWarning` for theme-class hydration. ✓
- [src/app/(storefront)/layout.tsx](src/app/%28storefront%29/layout.tsx) — Storefront chrome. Pass-through with Header + Footer + 3 contention watchers. Not async; no params. ✓
- [src/app/admin/layout.tsx](src/app/admin/layout.tsx) — Deliberately a pass-through; AdminLayout component handles the chrome. No params. ✓

---

## Final scope confirmation — what's actually in scope

Consolidating from all three passes, the canonical scope is:

| Change category | Count | Where |
|---|---|---|
| **Schema additions** (env.ts) | 7 vars | Phase 0 |
| **File deletions** | 2 (`next.config.ts` stub, `.eslintrc.json`) | Phase 0 |
| **Explicit cache directives** | 9 route handlers + 4 fetch calls | Phase 0 |
| **`await createClient()`** | 268 call sites in 236 files | Phase 1 |
| **Middleware cookie pattern rewrite** | 1 file | Phase 2.2 |
| **`await cookies()`** | 2 call sites (server.ts + getActiveCurrency.ts) | Phase 2.3 |
| **`await headers()`** | 3 call sites | Phase 2.3 |
| **`params: Promise<...>` + `await params`** | 18 pages | Phase 2.4 |
| **`searchParams: Promise<...>` + `await searchParams`** | 31 pages | Phase 2.4 |
| **`generateMetadata` async params** | 1 function | Phase 2.4 |
| **`unstable_cache` → `'use cache'`** | 2 call sites | Phase 4 |
| **Package version bumps** | 9 deps (next, react, react-dom, types, eslint-config-next, supabase/ssr, react-hook-form, hookform/resolvers, +next@16 in Phase 4) | Phases 2 + 4 |

**Total mechanical changes: ~342 individual file/code touches.** Most are 1-line `await` additions. Phase 1 alone is 268 of them.

---

## Summary — does the architectural reality change?

**No fundamental architecture change across all three investigation passes.** The original 5-phase plan is correct. The passes surface:

1. **More accurate scope numbers** — Phase 1 is bigger than originally estimated (268 sites vs 50)
2. **Critical distinction** between the two Supabase clients (createClient = async; createAdminClient = stays sync)
3. **Architectural opportunities** that React 19 enables but should NOT be bundled with the upgrade
4. **Operational hygiene** — cron scheduling architecture clarified (pg_cron + pg_net, not Vercel Cron); the one missing schedule migration added
5. **More env vars** to formalize in Phase 0 than the original counted (7 vs 3)
6. **Lower Stripe risk** than the original audit suggested (no Elements usage)
7. **Third-pass: concerns eliminated** — no API route handlers with dynamic segments, no useFormStatus, no next/font, no next/script, no CI configs to update, no generateStaticParams. **Reduces uncertainty significantly.**
8. **Third-pass: React.cache() wrappers explicitly noted** — 10 sites that need awaiting inside the wrapper (already part of the 268)
9. **Third-pass: only 2 Suspense boundaries** — minimal hydration boundary surface for React 19's improved behavior

**Recommendation:** Execute the original plan with the corrections this addendum specifies. The day-count estimate (3-5 working days) holds. Do NOT bundle the architectural opportunities (useActionState, useOptimistic, after(), instrumentation.ts) with the version bump — they're additive value but compound risk if done during the upgrade.

The codebase is in genuinely good shape for the migration. No defensive refactoring is needed before starting.
