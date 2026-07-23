# Next.js 14 → 15 → 16 Upgrade — Implementation Plan

**Date:** 2026-06-11
**Status:** Spec locked, ready for branched execution
**Audit basis:** Five parallel investigations across dynamic APIs, caching, middleware/auth, deps, and tooling
**Estimated effort:** 12-20 hours of focused work + 4-8 hours of testing

---

## Executive summary

The codebase moves from **Next.js 14.2.35 + React 18.3.1** to **Next.js 16 + React 19**, in two major-version hops with React 19 landing alongside Next.js 15.

**The five investigations surfaced a clear risk landscape:**

| Concern | Scope | Risk |
|---|---|---|
| **Async dynamic APIs** (`cookies()`, `headers()`, `params`, `searchParams`) | 53 files; the Supabase client factory is the bottleneck propagating to ~50+ server actions | HIGH — biggest mechanical change |
| **Middleware cookie pattern** | 1 file (`src/lib/supabase/middleware.ts`), but it's fragile under Next.js 15 stricter rules | HIGH — auth breaks if migrated wrong |
| **Caching defaults flip** | 9 route handlers + 4 courier `fetch()` calls + 2 `unstable_cache` usages | MEDIUM — straightforward but easy to miss |
| **Dependency ecosystem** | React 19 alignment for 4 deps (next, react, react-dom, types, eslint-config) + 3 secondary bumps | MEDIUM — known compatibility table |
| **Config + tooling** | 2 stale files to delete, 3 env vars to formalize, minor changes | LOW — preparatory work |

**Most code patterns are already future-friendly:** no class components, no `defaultProps`, no PropTypes, all server components and pages already `async`. The codebase is well-positioned for the migration; the risk lives in three high-impact pattern shifts that get planned + executed deliberately.

**The strategy:** do all the cleanup + the async Supabase migration **on the current Next.js 14** (Phase 0 + Phase 1), so when we flip to 15 (Phase 2) the changes are concentrated on the version-bump-specific work. Then 15 → 16 (Phase 4) is small because most breaking changes happen at 14 → 15.

---

## Pre-flight checklist

### Branch + safety

```bash
# Create dedicated branch — the upgrade is a long-running effort
git checkout -b upgrade/nextjs-16

# Pin the current state as a tag for emergency rollback
git tag pre-upgrade-baseline-2026-06-11

# Make sure main is clean before branching
git status   # should report nothing to commit
```

### Environment + tooling baseline

Confirm the following before starting:

- Node 20.x active (`node --version` ≥ 20.0.0). Next.js 15+ requires Node 18.18+; we already enforce Node 20.x in `package.json` engines.
- `.env.local` populated with all required env vars (verify your `src/lib/env.ts` schema passes locally).
- Latest `main` merged into the upgrade branch.
- A working baseline: `npm run typecheck && npm run build` succeeds on Next.js 14 before starting.

### Documentation to keep open

- [Next.js 15 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-15)
- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) (when it lands; check latest at execution time)
- [React 19 upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)
- [Supabase SSR latest docs](https://supabase.com/docs/guides/auth/server-side/nextjs)

---

## Phase 0 — Codebase hygiene (still on Next.js 14)

**Goal:** clean up stale files, formalize env vars, harden caching directives. All in the current Next.js 14 environment. Each item is small + low-risk; collectively they prevent surprises during the version bump.

**Effort:** 1-2 hours.
**Risk:** Very low — additive changes; no behavior modification.

### 0.1 — Delete stale config files

```bash
# Empty stub that conflicts with the real .mjs config
rm next.config.ts

# Legacy ESLint config (we use eslint.config.mjs flat config)
rm .eslintrc.json
```

After: `npm run typecheck && npm run lint && npm run build`. Should pass identically.

### 0.2 — Formalize missing env vars

The investigations found three env vars used in code but missing from the `src/lib/env.ts` zod schema:

- `IMAGE_HOSTNAMES` — used by `next.config.mjs` for the Next.js Image allowlist
- `STORAGE_PROVIDER` — used by `src/lib/storage/index.ts` factory
- `SERVER_SIDE_FORMAT_FALLBACK` — used by `src/actions/product-images/recordProductImage.ts`

Add them to the schema (note: `IMAGE_HOSTNAMES` is read by `next.config.mjs` at config-load time so it'll always be in `process.env`; the zod validation is for runtime sanity):

```ts
// src/lib/env.ts — additions to envSchema
IMAGE_HOSTNAMES: z.string().optional().default("**.supabase.co"),
STORAGE_PROVIDER: z
  .enum(["supabase", "s3", "r2", "minio", "b2"])
  .optional()
  .default("supabase"),
SERVER_SIDE_FORMAT_FALLBACK: z
  .enum(["true", "false"])
  .optional()
  .default("false"),
```

Also update `.env.example` (or create one if missing) documenting these for downstream deployments.

### 0.3 — Add `cache: 'no-store'` to courier fetch calls

Next.js 15 makes external `fetch()` uncached by default, but for courier API POSTs we want to be explicit so behavior is identical before AND after the upgrade.

Four call sites:

| File | Line | Action |
|---|---|---|
| [src/lib/courier/providers/acs.ts:608](src/lib/courier/providers/acs.ts) | POST to ACS API | Add `cache: "no-store"` |
| [src/lib/courier/providers/boxnow.ts:338](src/lib/courier/providers/boxnow.ts) | BoxNow auth POST | Add `cache: "no-store"` |
| [src/lib/courier/providers/boxnow.ts:384](src/lib/courier/providers/boxnow.ts) | BoxNow API requests | Add `cache: "no-store"` |
| [src/lib/courier/providers/geniki.ts:388](src/lib/courier/providers/geniki.ts) | Geniki SOAP POST | Add `cache: "no-store"` |

Each gets `cache: "no-store"` added to the fetch options object. No behavior change on Next.js 14; explicit + correct on Next.js 15.

### 0.4 — Add explicit `dynamic` exports to route handlers

Nine API route handlers don't declare `dynamic`. Today they inherit Next.js 14's "cached-by-default" behavior; on Next.js 15 they flip to uncached. For the routes that should obviously be uncached (webhooks, POST endpoints, auth), make it explicit:

| Route | Add | Reason |
|---|---|---|
| [src/app/api/track/route.ts](src/app/api/track/route.ts) | `export const dynamic = "force-dynamic";` | POST analytics, never cache |
| [src/app/(storefront)/auth/callback/route.ts](src/app/%28storefront%29/auth/callback/route.ts) | `export const dynamic = "force-dynamic";` | OAuth callback — stateful |
| [src/app/api/webhooks/mock-payment/route.ts](src/app/api/webhooks/mock-payment/route.ts) | `export const dynamic = "force-dynamic";` | Webhook handler |
| [src/app/api/webhooks/stripe/route.ts](src/app/api/webhooks/stripe/route.ts) | `export const dynamic = "force-dynamic";` | Webhook handler — critical |
| [src/app/api/checkout/heartbeat/route.ts](src/app/api/checkout/heartbeat/route.ts) | `export const dynamic = "force-dynamic";` | Per-request state |
| [src/app/api/checkout/release/route.ts](src/app/api/checkout/release/route.ts) | `export const dynamic = "force-dynamic";` | State mutation |
| [src/app/api/cron/wishlist-advance/route.ts](src/app/api/cron/wishlist-advance/route.ts) | `export const dynamic = "force-dynamic";` | Time-sensitive cron |
| [src/app/api/cron/courier-directories/route.ts](src/app/api/cron/courier-directories/route.ts) | `export const dynamic = "force-dynamic";` | Cron mutation |
| [src/app/api/cron/reap-orphan-media/route.ts](src/app/api/cron/reap-orphan-media/route.ts) | `export const dynamic = "force-dynamic";` | Cron mutation |

After: Phase 0 validation.

### 0.5 — Phase 0 validation

```bash
npm run typecheck   # should pass
npm run lint        # should pass
npm run build       # should pass on Next.js 14
git diff --stat     # review the spread of changes
git commit -m "chore: pre-upgrade hygiene (cleanup, env vars, explicit cache directives)"
```

**Rollback:** standard `git revert`.

---

## Phase 1 — Async Supabase client migration (still on Next.js 14)

**Goal:** make `src/lib/supabase/server.ts:createClient` async **before** the Next.js bump, so the propagation through ~50 server actions is decoupled from version-bump risks.

**Effort:** 4-5 hours.
**Risk:** MEDIUM — touches every server action. Type checker is your friend here.

**Why now (still on Next.js 14):** the Next.js 14 cookies() API is synchronous, but it's already legal to make a function async that internally calls a sync API. We're future-proofing the calling convention. When we then bump to 15, the internal `cookies()` call gets an `await` added, but every CALLER of `createClient()` is already prepared.

### 1.1 — Make `createClient()` async

[src/lib/supabase/server.ts](src/lib/supabase/server.ts):

```ts
// BEFORE
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export function createClient() {
  const cookieStore = cookies();
  // ...
}

// AFTER — only the function signature + the cookies() call site change
export async function createClient() {
  const cookieStore = cookies();  // stays sync on 14; becomes `await cookies()` in Phase 2
  // ...
}
```

### 1.2 — Add `await` to every call site

The TypeScript compiler will reveal every call site that needs updating. Run:

```bash
npm run typecheck 2>&1 | head -100
```

You'll get a flood of errors of the form:

```
Type 'Promise<...>' is missing properties from type 'SupabaseClient<...>': ...
```

For each error, change:

```ts
// BEFORE
const supabase = createClient();

// AFTER
const supabase = await createClient();
```

**Likely call sites** (verify against actual TS errors — these are the ones the audit found):

- `src/actions/addresses/*` (2 files)
- `src/actions/auth/getSession.ts`, `signIn.ts`, `signOut.ts`, `signUp.ts`
- `src/actions/cart/*` (8 files)
- `src/actions/categories/*` (3 files)
- `src/actions/checkout/*` (6 files)
- `src/actions/contention/*` (4+ files)
- `src/actions/products/*`, `variants/*`, `attributes/*`, `discounts/*`, `shipping/*`
- `src/actions/newsletter-sync/*`, `users/*`, `roles/*`
- `src/app/api/checkout/heartbeat/route.ts`, `release/route.ts`
- `src/app/api/webhooks/stripe/route.ts`, `mock-payment/route.ts`
- `src/app/(storefront)/auth/callback/route.ts`
- Page components reading auth state directly (rare; most go through actions)

### 1.3 — Verify Phase 1

```bash
npm run typecheck   # MUST pass — every createClient() call now awaited
npm run build       # MUST pass on Next.js 14
```

Manual smoke tests (Next.js 14 still running):
- Sign up + email confirmation
- Sign in + sign out
- Add to cart + checkout flow
- Admin product CRUD
- Stripe webhook (test mode)

```bash
git add -A
git commit -m "refactor: make Supabase server client async (prep for Next.js 15)"
```

**Rollback:** `git revert` the commit; restoring sync semantics on Next.js 14 works.

### 1.4 — A note about `multi-currency/getActiveCurrency`

[src/lib/multi-currency/getActiveCurrency.ts](src/lib/multi-currency/getActiveCurrency.ts) also calls `cookies()` and is consumed by `src/components/features/multi-currency/Price.tsx` — but the audit flagged the latter as a CLIENT component that imports the function. **It can't possibly call `cookies()` at render time on the client**, so this is either:

- A stale import that's actually only used server-side (verify)
- A real bug that's been masked by some other path
- A pattern where the function is called on the server during SSR and the result is hydrated

**Action during Phase 1:** investigate the usage. If `Price.tsx` truly imports it client-side, refactor to receive currency as a prop from a server component parent. This blocks Phase 2 because the same `cookies()` call site appears here and will need awaiting too.

```bash
grep -rn "getActiveCurrency\|pref-currency" src/components src/app
```

Resolve before proceeding to Phase 2.

---

## Phase 2 — The big bump: Next.js 14 → 15 + React 18 → 19

**Goal:** install Next.js 15 + React 19, apply every remaining breaking-change fix, get a clean type-check + build.

**Effort:** 6-10 hours.
**Risk:** HIGH — biggest single deploy. Make this its own multi-step commit chain so any issue is bisectable.

### 2.1 — Version bump

```bash
# Pin to specific 15.x version (check latest stable at execution time)
npm install \
  next@^15 \
  react@^19 \
  react-dom@^19 \
  eslint-config-next@^15

npm install --save-dev \
  @types/react@^19 \
  @types/react-dom@^19

# Sanity-check installed versions
npm ls next react react-dom @types/react @types/react-dom eslint-config-next
```

Expected sub-deps that may need bumps (handle if needed):

- `@supabase/ssr` → check latest (likely 0.6+) for Next.js 15 cookie-pattern support
- `react-hook-form` → 7.52+ for React 19 compat
- `@hookform/resolvers` → 5.3+

```bash
npm install \
  @supabase/ssr@latest \
  react-hook-form@^7.52 \
  @hookform/resolvers@^5.3
```

**Do not proceed past this step if `npm install` reports peer-dep errors that aren't expected.** Resolve them first.

### 2.2 — Migrate middleware cookie pattern

[src/middleware.ts](src/middleware.ts) + [src/lib/supabase/middleware.ts](src/lib/supabase/middleware.ts).

The current pattern (`request.cookies.set()` + `NextResponse.next({ request })` + `supabaseResponse.cookies.set()`) is fragile under Next.js 15's stricter middleware rules. The Supabase SSR team published a cleaner pattern that uses **response-phase cookie writes only**.

**Replace `src/lib/supabase/middleware.ts` with the response-only pattern:**

```ts
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Response-phase write only — no request-phase mutation.
          // The next response carries the cookies; subsequent
          // requests will see them.
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options as CookieOptions);
          }
        },
      },
    }
  );

  // Critical: getUser() triggers Supabase to refresh the session if
  // needed. The refreshed token (if any) gets written via setAll above.
  await supabase.auth.getUser();

  // Re-apply security headers
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
}
```

This pattern is what the latest Supabase SSR documentation uses. The key insight: **don't mutate the request's cookie jar**. Read it once, write to the response, let the next request see the updated cookies natively.

Verify:
- Sign in, sign out, sign up all work
- Session persists across page navigations
- Token refresh works (test with expired-but-not-too-old session by waiting near the refresh window)
- Cron auth still works (Bearer-token routes don't depend on the cookie flow)

### 2.3 — Add `await` to `cookies()` and `headers()`

Three site categories:

**A. `src/lib/supabase/server.ts`** (the only `cookies()` call besides middleware):

```ts
// BEFORE
const cookieStore = cookies();

// AFTER (Next.js 15)
const cookieStore = await cookies();
```

**B. `src/lib/multi-currency/getActiveCurrency.ts`:**

If still in use server-side after Phase 1 cleanup:

```ts
// BEFORE
export function getActiveCurrency(): string { const cookieStore = cookies(); ... }

// AFTER
export async function getActiveCurrency(): Promise<string> {
  const cookieStore = await cookies();
  ...
}
```

Then update every caller to `await getActiveCurrency()`. The TypeScript compiler will surface them.

**C. `headers()` call sites (3):**

| File | Change |
|---|---|
| [src/actions/auth/signIn.ts:36](src/actions/auth/signIn.ts) | `headers().get(...)` → `(await headers()).get(...)` |
| [src/actions/auth/signUp.ts:47](src/actions/auth/signUp.ts) | Same |
| [src/actions/newsletter-sync/subscribeNewsletter.ts:30](src/actions/newsletter-sync/subscribeNewsletter.ts) | Same |

All three are in `"use server"` async functions, so the await is mechanical.

### 2.4 — Add `await` to `params` + `searchParams`

This is the largest mechanical change in Phase 2: **49 page files + 1 generateMetadata function** must change the prop type from `{ params: {...} }` to `{ params: Promise<{...}> }` and `await` it.

**Pattern transform:**

```ts
// BEFORE (Next.js 14)
export default async function Page({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  const id = params.id;
  const tab = searchParams.tab;
  // ...
}

// AFTER (Next.js 15)
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  // ...
}
```

**18 pages with `params`** (from the audit — apply identically to all):

```
src/app/(storefront)/products/[slug]/page.tsx
src/app/(storefront)/orders/[id]/page.tsx
src/app/(storefront)/checkout/payment/[id]/page.tsx
src/app/(storefront)/checkout/success/[id]/page.tsx
src/app/(storefront)/checkout/mock/[session_id]/page.tsx
src/app/admin/discounts/[id]/edit/page.tsx
src/app/admin/categories/[id]/edit/page.tsx
src/app/admin/customers/[id]/page.tsx
src/app/admin/orders/[id]/page.tsx
src/app/admin/products/[id]/edit/page.tsx
src/app/admin/products/[id]/variants/[variantId]/page.tsx
src/app/admin/roles/[id]/edit/page.tsx
src/app/admin/shipping/rates/[id]/edit/page.tsx
src/app/admin/shipping/zones/[id]/edit/page.tsx
src/app/admin/suppliers/[id]/page.tsx
src/app/admin/supply-orders/[id]/page.tsx
src/app/admin/users/[id]/page.tsx
```

**31 pages with `searchParams`** (see audit Section 5 for the full list, or run):

```bash
grep -rln "searchParams" src/app
```

**1 generateMetadata function:**

[src/app/(storefront)/products/[slug]/page.tsx:23](src/app/%28storefront%29/products/%5Bslug%5D/page.tsx):

```ts
// BEFORE
export async function generateMetadata({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  // ...
}

// AFTER
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // ...
}
```

**Codemod option** — Next.js ships an official codemod for this:

```bash
npx @next/codemod@canary next-async-request-api .
```

The codemod handles the bulk transform; manually review its diff before committing, especially:
- Any place where `params` was passed through to a helper (the codemod may not catch this)
- Any `cache()` wrappers around per-request functions reading params

### 2.5 — Migrate `unstable_cache` → `cache` from React

Two call sites:

**A. [src/components/features/category-navigation/CategoryNav.tsx:17](src/components/features/category-navigation/CategoryNav.tsx)**

```ts
// BEFORE
import { unstable_cache } from "next/cache";

const getTopLevelCategories = unstable_cache(
  async () => {
    /* ... */
  },
  ["top-level-categories"],
  { revalidate: 86400, tags: ["categories"] }
);

// AFTER (Next.js 15 — `unstable_cache` still works but `'use cache'`
// directive is preferred; for now, keep unstable_cache until 16)
// Actually for now, just verify the import path stays valid and the
// behavior matches. The `'use cache'` directive is experimental in 15
// and stable in 16.

// In Next.js 16, the migration is to add a top-of-function 'use cache'
// directive:
async function getTopLevelCategories() {
  "use cache";
  // body...
}
```

For Phase 2 (15), KEEP using `unstable_cache` — it still works. For Phase 4 (16), migrate to `'use cache'` if recommended by the upgrade guide at that time.

**B. [src/lib/site-search/getCatalogFacets.ts:355](src/lib/site-search/getCatalogFacets.ts)**

Same pattern. Keep `unstable_cache` for Phase 2; revisit in Phase 4.

### 2.6 — Verify Phase 2 (intermediate validation)

```bash
npm run typecheck      # MUST pass
npm run lint           # MUST pass (or only warnings)
npm run build          # MUST pass
```

If any type errors remain, fix them before moving on. Common pitfalls:
- A `params` destructure that got missed by the codemod
- A helper function that received `params` as a prop and needs its own signature update
- A `useRouter` import path change (it's still in `next/navigation` — should be fine)

### 2.7 — Manual smoke testing on Next.js 15

Run `npm run dev` and exercise:

**Storefront:**
- [ ] Browse `/products`; filter by attribute (uses searchParams)
- [ ] Open `/products/[slug]` for several products including variant URLs
- [ ] Add items to cart; cart drawer updates
- [ ] Checkout flow → mock payment → success page
- [ ] Wishlist add/remove
- [ ] Account → addresses → CRUD
- [ ] Sign in / sign out / session refresh (wait ~50 minutes if possible)

**Admin:**
- [ ] Log in as admin user
- [ ] Products list with various filters
- [ ] Product edit → tabs (overview, variants, images, SEO)
- [ ] Image upload via the new combo-aware Images tab
- [ ] Customer detail page (tests `params` path)
- [ ] Orders list + detail
- [ ] Inventory edit (server action)
- [ ] Settings → various pages

**Auth + cookies:**
- [ ] MFA enroll/verify
- [ ] Currency switch (cookie set)
- [ ] Sign out → session cleared everywhere

**Cron + API:**
- [ ] Hit `/api/cron/reap-orphan-media` with the correct Bearer header — should return 200
- [ ] Hit `/api/webhooks/stripe` with a Stripe test event — should process

### 2.8 — Commit Phase 2

If smoke tests pass:

```bash
git add -A
git commit -m "feat: upgrade to Next.js 15 + React 19

- Migrated cookies()/headers()/params/searchParams to async API
- Refactored Supabase SSR middleware to response-only cookie writes
- Bumped React 18 → 19; React Hook Form, Supabase SSR, types in sync
- Added explicit cache directives to route handlers
- Re-verified end-to-end flows on Next.js 15
"
```

**Rollback:** the upgrade branch makes this trivial — `git reset --hard pre-upgrade-baseline-2026-06-11` and re-deploy main.

---

## Phase 3 — Verification & smoke tests (Next.js 15)

**Goal:** before moving to 16, exercise the app at Next.js 15 thoroughly. Catch any regressions that escape Phase 2's quick smoke.

**Effort:** 2-4 hours.

### 3.1 — Type + lint deep pass

```bash
npm run typecheck    # ZERO errors
npm run lint         # ZERO errors; warnings reviewed case-by-case
npm run build        # successful production build
```

### 3.2 — Production-build smoke

```bash
npm run build
npm run start
```

Open `http://localhost:3000` and exercise the same flows from Phase 2.7 against the production build (different than dev — caching, optimization, etc. behave differently).

### 3.3 — Realtime + WebSocket flows

The audit highlighted that the Supabase Realtime subscription stack uses WebSocket upgrades. Next.js 15 has a security advisory about SSRF in WebSocket upgrades — verify our paths:

- Open two browser windows as different customers
- Customer A holds variant X via cart
- Customer B tries to add variant X → soft wait
- Customer A removes from cart → Customer B's UI should advance via Realtime
- Cart drawer's inventory counts update on contention events

If the Realtime path stalls, check `useCartRealtime`, `useVariantInventoryRealtime`, and the watchers in `src/components/features/contention/`.

### 3.4 — Stripe webhook end-to-end

In Stripe test mode:
- Place a real test-mode order through `/checkout/payment`
- Verify the webhook handler runs and order state updates correctly
- Verify wishlist notifications dispatch (the Promise.all change we made earlier)

### 3.5 — Cron schedule check

Run each cron route manually with the `CRON_SECRET`:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/wishlist-advance
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/courier-directories
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reap-orphan-media
```

All should return 200 + JSON. The reap-orphan-media should report `{scanned, candidates, deleted, errors, durationMs}`.

### 3.6 — Performance sanity check

Run Lighthouse on:
- `/` (home)
- `/products` (catalog)
- `/products/[slug]` (PDP)

Compare LCP/FCP/CLS against the Next.js 14 baseline you measured before starting. There shouldn't be a major regression; if LCP drops significantly, investigate whether Next.js 15 changed Image optimization defaults that affect our config.

### 3.7 — Tag the stable Next.js 15 state

```bash
git tag stable-nextjs-15-2026-06-11
```

This is a safety net — if Next.js 16 brings issues we can't resolve quickly, we can deploy from this tag while we sort out 16.

---

## Phase 4 — Next.js 15 → Next.js 16

**Goal:** the smaller hop. Most of the breaking changes happened at 14 → 15; this phase addresses 16-specific changes that were highlighted in the upgrade guide.

**Effort:** 2-4 hours.
**Risk:** MEDIUM — depends on how much Next.js 16 changes beyond 15 at execution time.

### 4.1 — Read the Next.js 16 upgrade guide

Before any code change, read the **latest** [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16). The plan below reflects expected/announced changes; verify against current docs at execution time. Likely categories:

- **Async dynamic APIs mandatory** — the fallback that warned on sync usage in 15 is removed in 16
- **Tighter React 19 alignment** — minor type changes
- **`'use cache'` directive** stable — replacement for `unstable_cache`
- **next/image** changes (possibly removing the `domains` shorthand for good)
- **Edge runtime changes** — verify opengraph-image.tsx still works

### 4.2 — Version bump

```bash
npm install next@^16 eslint-config-next@^16
```

Run `npm ls` to verify peer dep alignment. If `@supabase/ssr` or `react-hook-form` lags behind 16-required versions, bump them too.

### 4.3 — Address remaining warnings + errors

Run:

```bash
npm run typecheck
npm run build
```

Common 16-specific issues to expect:

- Any sync `cookies()` / `headers()` / `params` we missed in Phase 2 will now FAIL HARD (not just warn). Fix immediately.
- `unstable_cache` may emit deprecation warnings — migrate to `'use cache'` directive at the function level (it's a function-body directive, not a call wrap).

For the `unstable_cache` migration:

```ts
// BEFORE
import { unstable_cache } from "next/cache";

const getTopLevelCategories = unstable_cache(
  async () => { /* body */ },
  ["top-level-categories"],
  { revalidate: 86400, tags: ["categories"] }
);

// AFTER (Next.js 16 with 'use cache' directive)
async function getTopLevelCategories() {
  "use cache";
  // ... body
}

// Tag scope is set via the experimental `cacheTag()`:
import { unstable_cacheTag as cacheTag } from "next/cache";

async function getTopLevelCategories() {
  "use cache";
  cacheTag("categories");
  // ... body
}
```

Apply to both `CategoryNav.tsx` and `getCatalogFacets.ts`.

### 4.4 — Verify Phase 4

Same flows as Phase 2.7. Pay extra attention to:
- Any place that interacted with `unstable_cache` (cache invalidation timing)
- Image optimization output (does `next/image` still emit AVIF/WebP?)
- Edge runtime — verify `/opengraph-image` still renders

```bash
git add -A
git commit -m "feat: upgrade to Next.js 16

- Stabilized 'use cache' directive replacing unstable_cache
- Verified all dynamic APIs are async (16 enforces this)
- Re-tested end-to-end flows"
git tag stable-nextjs-16-2026-06-11
```

---

## Phase 5 — Post-upgrade cleanup + polish

**Goal:** address tech debt the upgrade revealed.

**Effort:** 2-4 hours, spread over the following week.

### 5.1 — Review React 19 exhaustive-deps warnings

The audit flagged 6 files with `// eslint-disable-next-line react-hooks/exhaustive-deps`:

- [src/components/features/catalog/FilterSidebar.tsx](src/components/features/catalog/FilterSidebar.tsx)
- [src/components/features/contention/SoftWaitNextInLineWatcher.tsx](src/components/features/contention/SoftWaitNextInLineWatcher.tsx)
- [src/components/admin/orders/NewOrderForm.tsx](src/components/admin/orders/NewOrderForm.tsx)
- [src/components/features/checkout/LocationPicker.tsx](src/components/features/checkout/LocationPicker.tsx)
- [src/hooks/useVariantInventoryRealtime.ts](src/hooks/useVariantInventoryRealtime.ts)
- [src/components/features/checkout/ContentionBanner.tsx](src/components/features/checkout/ContentionBanner.tsx)

React 19's hooks deps tracking changes may resolve some of these warnings naturally. Review each disable — some may be removable now.

### 5.2 — Address the multi-currency cookie pattern

If Phase 1.4 surfaced that `getActiveCurrency()` is being imported by client components, refactor properly:

```tsx
// Server component
const currency = await getActiveCurrency();
return <Price amount={...} currency={currency} />;

// Price.tsx as client component receiving currency as prop, NOT importing getActiveCurrency
```

### 5.3 — Tailwind v3 → v4 (optional)

Next.js 15+ ships Tailwind v4. We stayed on v3 during the upgrade for stability. v4 is a separate migration with its own breaking changes (the CSS-first config, JIT differences). **Defer this to its own dedicated task.** If you do it:

- Read the [Tailwind v4 migration guide](https://tailwindcss.com/docs/upgrade-guide)
- Plan ~1-2 days of work
- Test all theming + dark mode behavior

### 5.4 — Confirm Next.js 16's image hostnames format

`next.config.mjs` uses `remotePatterns` — Next.js 16 keeps this format. Verify the AVIF/WebP defaults still emit the formats we expect.

### 5.5 — Update CLAUDE.md / project docs (if maintained)

Reflect:
- Now on Next.js 16 + React 19
- New patterns: async dynamic APIs, `'use cache'` directive
- New env vars: `IMAGE_HOSTNAMES`, `STORAGE_PROVIDER`, `SERVER_SIDE_FORMAT_FALLBACK`

---

## Risk register

The high-risk items and the mitigation for each.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Supabase auth breaks after middleware migration** | Medium | Critical (no one can sign in) | Phase 2.2 is a focused single-commit refactor with isolated testing. Rollback isolates to one commit. Smoke test exercises full auth flow before commit. |
| **Async cookies() ripple breaks server actions** | High (mechanical) | High (broad failure surface) | Phase 1 does this on Next.js 14 first, decoupling it from the version bump. TypeScript catches every missed `await`. |
| **WebSocket SSRF advisory in Next.js 15** | Low (path not exposed) | High (security) | Phase 3.3 exercises the Realtime flow end-to-end. We use Supabase's hosted Realtime, not our own WebSocket server. |
| **Cache poisoning in RSC responses** | Low (specific conditions) | Critical (security) | Vercel's edge handles RSC caching for us. Phase 4 patches via Next.js 16 minor releases — keep monitoring CVEs. |
| **`@supabase/ssr` 0.5.x incompatible with 15** | Medium | Critical | Phase 2.1 bumps Supabase SSR to latest with Next.js 15. Verify in advance via Supabase release notes. |
| **`@stripe/react-stripe-js` 3.x React 19 compat** | Low | High | Audit reports compatible. Phase 2.7 exercises Stripe end-to-end. |
| **`react-hook-form` 7.x breaks forms** | Low | High (admin can't edit) | Phase 2.1 bumps to 7.52+. Phase 2.7 + 3.2 exercise admin forms thoroughly. |
| **Storefront LCP regresses** | Low | Medium | Phase 3.6 measures Lighthouse before claiming success. |
| **Cron routes stop firing** | Low (we added explicit `dynamic`) | Medium (data layer drift) | Phase 3.5 verifies each cron route manually with curl. |
| **Codemod over-rewrites** | Low | Medium (silent bugs) | Phase 2.4 says review codemod diff before committing. |

---

## File-by-file change checklist

A condensed reference of every file that changes during the upgrade.

### Phase 0 — Hygiene

- `next.config.ts` — **DELETE**
- `.eslintrc.json` — **DELETE**
- `src/lib/env.ts` — add 3 env vars
- `.env.example` — document 3 env vars
- `src/lib/courier/providers/acs.ts` — add `cache: "no-store"` to fetch
- `src/lib/courier/providers/boxnow.ts` — add `cache: "no-store"` (2 fetches)
- `src/lib/courier/providers/geniki.ts` — add `cache: "no-store"`
- 9 route handlers — add `export const dynamic = "force-dynamic";`

### Phase 1 — Async Supabase

- `src/lib/supabase/server.ts` — `createClient` becomes async
- ~50 server actions — `await createClient()`
- Any page calling `createClient()` directly

### Phase 2 — Next.js 15 + React 19

**Package bumps in `package.json`:**
- `next` → ^15
- `react` → ^19
- `react-dom` → ^19
- `@types/react` → ^19
- `@types/react-dom` → ^19
- `eslint-config-next` → ^15
- `@supabase/ssr` → latest
- `react-hook-form` → ^7.52
- `@hookform/resolvers` → ^5.3

**Code changes:**
- `src/lib/supabase/middleware.ts` — response-only cookie pattern
- `src/lib/supabase/server.ts` — `await cookies()`
- `src/lib/multi-currency/getActiveCurrency.ts` — async + `await cookies()` (or refactor; see 1.4)
- `src/actions/auth/signIn.ts` — `await headers()`
- `src/actions/auth/signUp.ts` — `await headers()`
- `src/actions/newsletter-sync/subscribeNewsletter.ts` — `await headers()`
- 18 pages with `params` — `Promise<...>` type + `await params`
- 31 pages with `searchParams` — `Promise<...>` type + `await searchParams`
- 1 `generateMetadata` — same transform

### Phase 4 — Next.js 16

- `next` → ^16
- `eslint-config-next` → ^16
- `src/components/features/category-navigation/CategoryNav.tsx` — `unstable_cache` → `'use cache'`
- `src/lib/site-search/getCatalogFacets.ts` — `unstable_cache` → `'use cache'`
- Any remaining 16-specific items per the official upgrade guide

### Phase 5 — Polish (deferrable)

- 6 files — review `exhaustive-deps` disables
- `getActiveCurrency` + `Price.tsx` — final clean refactor if not done in Phase 1.4
- Optional: Tailwind v4 migration (separate effort)

---

## Effort summary

| Phase | Focus | Effort |
|---|---|---|
| 0 | Codebase hygiene (still on 14) | 1-2 h |
| 1 | Async Supabase client (still on 14) | 4-5 h |
| 2 | Next.js 15 + React 19 bump | 6-10 h |
| 3 | Verification on 15 | 2-4 h |
| 4 | Next.js 16 bump | 2-4 h |
| 5 | Post-upgrade cleanup | 2-4 h |
| **Total** | **17-29 hours** | spread over 3-5 working days |

Real-world recommendation: **3-4 days of focused work, ideally over a single week so context stays loaded.** Splitting it across weeks risks rebase friction with main.

---

## Decision points + open questions

These need stakeholder confirmation before/during execution:

1. **Branch strategy:** keep main on Next.js 14 until the upgrade branch is fully verified, then squash-merge. Or release in stages via `main` itself? Recommended: one big squash merge after Phase 4 validates.

2. **Vercel deploy preview environment:** push the upgrade branch to a preview deployment and exercise end-to-end against staging-grade infrastructure. This catches Vercel-specific edge case differences from local dev.

3. **Tailwind v4:** defer or include? Recommended defer — adds 1-2 days and risks compound bugs.

4. **`@next/codemod` codemod**: use or hand-migrate the 49 params/searchParams files? Recommended: use codemod, then review the diff. Hand-migration is error-prone at this scale.

5. **`'use cache'` adoption timing:** Phase 4 or Phase 5? The directive is stable in 16 but the upgrade guide may not require migration immediately. Recommended: Phase 4 for cleanliness; can defer to Phase 5 if time pressure.

6. **Production cutover:** after Phase 4 + Phase 3-level testing on staging, deploy during a low-traffic window. The Greek kids eshop's quietest hours are likely early morning (4-7 AM Athens time).

---

## Summary

This plan moves the codebase from **Next.js 14.2.35 + React 18.3.1** to **Next.js 16 + React 19** in five sequenced phases over 3-5 working days. The biggest mechanical change (async Supabase client) is decoupled from the version bumps. Every breaking-change category surfaced by the audit has a specific phase + action item. Smoke testing is built into each phase boundary.

The work is **shippable** — at the end of any phase the codebase compiles, builds, and passes tests. Each phase tag creates a rollback point.

When you're ready to execute, start with Phase 0 (hygiene). When that's committed and green, Phase 1 (async Supabase) opens the door for the version bump in Phase 2. The bulk of risk lives in Phase 2; thorough testing in Phase 3 catches issues before Phase 4. Phase 5 is polish that can land later.

**Status: ready to execute.**
