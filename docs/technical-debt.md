# Technical Debt

Evaluation of the `ARCH.md` diagnostic report (Arch static-analysis tool, 2026-05-24, 795 diagnostics: 172 errors + 206 warnings + 417 info) against the actual codebase, plus an honest reframing of which items are mechanical fixes vs. design decisions.

**Headline:** the vast majority of the tool's "errors" are false positives — Arch doesn't follow Next.js Server Action plumbing, can't trace through `AdminLayout`'s permission gates, and can't read the `env.ts` Zod schema. Of the 172 errors flagged, **~5 were real** and **~167 are mechanical false positives**. The warnings and info diagnostics yielded another ~12 real items — mostly SEO and code hygiene.

Within the ~17 "real" items, only **3 were unambiguous quick fixes**. The rest involve design decisions, UX trade-offs, or hidden audit steps that need a deliberate choice. This document classifies each accordingly so future readers don't treat the list as a "just ship it" checklist.

---

## Status at a glance

| Item | Status | Date | What |
|---|---|---|---|
| TD-1 | ✅ Shipped | 2026-05-25 | `fulfillOrder` moved from `actions/` to `lib/` — Server Action surface removed |
| TD-2 | ✅ Shipped | 2026-05-25 | `listAcsStations.force_refresh` admin-gated against ACS API quota burn |
| TD-3 (3 of 4) | ✅ Shipped | 2026-05-25 | `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` headers in middleware |
| TD-3 (HSTS) | ⏳ Open | — | Strict-Transport-Security with ramp plan documented below |
| TD-4 | ✅ Shipped | 2026-05-25 | `engines.node >=20` in `package.json` |
| TD-5 | ⏳ Open | — | Generated Supabase TypeScript types (~200 LoC migration) |
| TD-6 | ⏳ Open | — | Automated test infrastructure (Vitest setup + first 20 critical tests) |
| TD-7 | ⏳ Open (decision needed) | — | `generateMetadata` on dynamic routes — `products/[slug]` yes, `orders/[id]` no |
| TD-8 | ⏳ Open (minor decision) | — | `noindex` on auth & checkout pages |
| TD-9 | ⏳ Open (decision needed) | — | Metadata exports on public pages — split between indexable & per-user noindex |
| TD-10 | ⏳ Open (decision needed) | — | Dead components + `leaveSoftWaitQueue` — verify if planned for future use |
| TD-11 | ⏳ Open (5 min) | — | Verify `opengraph-image.tsx` is reachable at runtime |
| TD-12 | ⏳ Open (audit needed) | — | Remove default permission from `AdminLayout` — needs per-page audit first |

---

## Shipped (2026-05-25)

The unambiguous security/correctness fixes have been completed.

### ✅ TD-1 — `fulfillOrder` moved out of the Server Action surface

**Was:** [src/actions/fulfillment/fulfillOrder.ts](https://) (deleted) — `"use server"`-declared, no auth guard, writes orders + order_items + inventory.

**Now:** [src/lib/fulfillment/fulfillOrder.ts](src/lib/fulfillment/fulfillOrder.ts) — `import "server-only"`, not callable via the Server Action RPC channel. Only the Stripe webhook handler (signature-verified) and mock-payment webhook (provider-gated) can reach it.

Single import path updated in [src/lib/payment/handleSessionEvents.ts](src/lib/payment/handleSessionEvents.ts). No UI ever referenced it; no behavior change for users.

### ✅ TD-2 — `listAcsStations.force_refresh` admin-gated

[src/actions/courier-settings/listAcsStations.ts](src/actions/courier-settings/listAcsStations.ts) silently downgrades `force_refresh=true` to a cached read when the caller doesn't hold `manage:couriers`. Codifies the existing comment intent ("the admin 'refresh stations' button uses this; the customer picker leaves it false"). Customers still get stations via the 30-day cache; admins still get fresh data via the refresh button.

### ✅ TD-4 — `engines.node` declared

Added `"engines": { "node": ">=20" }` to [package.json](package.json). Current dev environment runs Node 24, so no breakage. Future deployments to environments with Node < 20 will fail at install with a clear message.

### ✅ TD-3 (partial) — Three always-on security headers shipped

Three of the four baseline headers added in [src/lib/supabase/middleware.ts](src/lib/supabase/middleware.ts) right before the response is returned (placed there because the cookies.setAll callback may replace the response mid-flight, wiping any earlier header writes):

- `X-Frame-Options: DENY` — blocks clickjacking via cross-origin iframe embedding. Verified codebase has no internal iframe usage; Stripe Elements iframes are *child* frames of our pages, unaffected by this header.
- `X-Content-Type-Options: nosniff` — disables MIME-sniffing fallback; forces browsers to trust the declared Content-Type.
- `Referrer-Policy: strict-origin-when-cross-origin` — when navigating to external sites, only the origin is sent (no paths, no query params with order ids / session ids).

**HSTS deliberately NOT shipped yet** — see the TD-3 remaining item below for the ramp plan.

---

## Open — unambiguous (would ship next if requested)

### TD-11 — Verify `opengraph-image.tsx` is reachable at runtime

[src/app/opengraph-image.tsx](src/app/opengraph-image.tsx) exists. Arch claims it's orphan. Either it follows Next.js's [opengraph-image convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image) and Arch is wrong, or it doesn't. 5-minute verification.

---

## Open — minor design choices to flag

### TD-3 (remainder) — HSTS ramp

Three of the four baseline headers shipped above. HSTS is the remaining piece. It's the most impactful (defends against MITM / WiFi-tap downgrade attacks) but also the only one with **client-side irreversibility**: once a browser caches the header, it refuses HTTP to that domain for the full `max-age` duration, regardless of what the server later sends.

**The ramp plan:**

| Phase | Header value | Reason |
|---|---|---|
| Initial (today) | `Strict-Transport-Security: max-age=300` | 5-minute window. If you discover HTTPS instability, broken cert renewal, or a subdomain serving HTTP, you can roll back after 5 minutes of cached impact. |
| Week 1 (after stable) | `max-age=86400` (1 day) | 1-day cache. Reasonable real-world MITM protection. |
| Month 1 | `max-age=2592000` (30 days) | Standard "we mean it." |
| Month 2+ | `max-age=31536000` (1 year) | Production standard. |
| Eventually | `max-age=31536000; includeSubDomains; preload` | Submit to https://hstspreload.org → all browsers hardcode HTTPS-only for your domain before any first visit. **Audit every subdomain serves HTTPS before this step.** |

The reason not to ship at 1 year immediately is the cost of getting it wrong: if your cert renewal cron fails, or you spin up a new subdomain that serves HTTP, users who visited any time in the past year are locked out until either (a) the cert is fixed, or (b) they wait the full year for the cached rule to expire.

**Action when ready:** add to middleware (same location as the other three headers) and commit to bumping the max-age every ~2 weeks for the first 2 months.

### CSP (Content-Security-Policy) — not in TD-3 scope

CSP is the strongest XSS defense (even if attacker injects `<script>`, CSP can block execution). But it's also the easiest header to misconfigure into breaking your own site — needs careful audit of every external resource (Stripe Elements, Supabase Realtime WebSocket, fonts, analytics). Worth its own dedicated round once you have time to iterate in `Content-Security-Policy-Report-Only` mode and observe violation reports without enforcement. Tracked as a separate future item.

### TD-8 — `noindex` on auth & checkout pages

ARCH flagged `auth/signin`, `auth/signup`, `checkout/mock/[session_id]` as needing `robots.noindex`. Real but with a marginal UX note:

- Users who search "{brand} login" via Google won't find a result. Standard industry practice (login pages shouldn't appear in SERPs), but ensure "Σύνδεση" / "Λογαριασμός" is prominently linked in the header on every page.
- `checkout/mock/[session_id]` should be noindex regardless (dev-only mock URL with session ids).

**Effort:** ~6 lines per page × ~6 pages.

---

## Open — real design ambiguity (needs decisions)

### TD-7 — `generateMetadata` on dynamic routes

The original report bundled `products/[slug]` and `orders/[id]` together. They need different treatment:

- **`products/[slug]`** — clear win. Public, indexable, should have per-product titles + descriptions + OG images. Ship as proposed.
- **`orders/[id]`** — should **NOT** get `generateMetadata` exposing order details. The page requires auth to view, but `generateMetadata` runs before the auth redirect. There's a race where preview-fetching tools / crawlers could capture order titles into search results or social-share previews — leaking PII. Instead use a static `metadata = { title: "Order — Vape84", robots: { index: false, follow: false } }`.

**Decision:** confirm this split before implementing.

### TD-9 — Metadata exports on public pages

Original report said "add metadata to `/`, `products`, `cart`, `orders`, `wishlist`". Needs splitting by indexability intent:

- **Indexable (need title + description):** `/` (home), `products` (list page).
- **Per-user, non-indexable:** `cart`, `orders`, `wishlist` — these need `robots: { index: false, follow: false }`, not just metadata. Adding metadata without noindex creates indexable empty shells (no content for crawlers, consume crawl budget, appear as orphan results).

**Decision:** verify what the root layout's default robots policy is. If it already has noindex, only titles are needed. If it doesn't, both are needed for the per-user pages.

### TD-10 — Dead components + leaveSoftWaitQueue

ARCH flagged three "unused" items. Each needs its own call:

- **[src/components/admin/supply-orders/WorkspaceTabs.tsx](src/components/admin/supply-orders/WorkspaceTabs.tsx)** — defined, never imported. May be planned-but-not-wired UI for the supply-orders workspace. **Don't delete blindly** — verify with the spec or feature owner whether it's intended for upcoming work.
- **[src/components/features/live-chat/ChatWidget.tsx](src/components/features/live-chat/ChatWidget.tsx)** — same. There's a whole `src/lib/live-chat/` infrastructure suggesting an in-progress feature.
- **[src/actions/cart/leaveSoftWaitQueue.ts](src/actions/cart/leaveSoftWaitQueue.ts)** — called internally from `releaseCustomerPriorityHolds` and the collapse path; not from any UI. **Two valid choices**:
  - Wire it up: add a "Leave wait queue" link on cart items in pending state. Real UX improvement — currently customers can only exit a queue by deleting the item entirely.
  - Move to `lib/`: drops the unused Server Action surface. Customers' only escape stays "remove from cart".

**Decision:** confirm with the feature owner / spec on the two component files. For `leaveSoftWaitQueue`, decide whether the UX of "leave queue but keep item in cart" is worth ~20 LoC + a button.

### TD-12 — Making `AdminLayout.permission` required

Currently `permission = "manage:products"` is the default in [AdminLayout.tsx](src/components/features/backoffice-shell/AdminLayout.tsx). Removing the default forces every admin page to declare its permission explicitly.

**Hidden audit step** (not "30 LoC mechanical"):

Of the 55 admin pages, three categories exist today:
1. Pages that pass an explicit permission prop — safe.
2. Pages that intentionally rely on the `manage:products` default — common for product-adjacent pages.
3. Pages that **accidentally** rely on the default when they should be using a different permission — currently masked because the `admin` role has every permission.

Category 3 is the hidden risk. Before removing the default, each of the 55 pages needs its correct intended permission verified. Otherwise creating a narrow staff role later (e.g., "shipping-only staff") will silently expose pages it shouldn't.

**Effort:** 30–60 minute audit + the 30 LoC mechanical change.

---

## Open — engineering investment (no UX ambiguity)

### TD-5 — Generated Supabase TypeScript types

DB queries use `as any` casts throughout. Type safety on DB row shapes is lost. Refactoring a column name doesn't catch broken queries at compile time.

**No functional ambiguity, but real engineering complexity:**

- One-shot migration (generate types, drop all casts) carries high risk — 200+ LoC diff is hard to bisect when something breaks.
- Gradual migration (generate types, leave casts, remove file-by-file in follow-up PRs) is lower risk and recommended.

**Effort:** ~2 hours initial setup; ongoing file-by-file cleanup.

### TD-6 — Automated tests

Zero `*.test.ts` files in the project. Every critical action (placeOrder, applyDiscount, dispatchWishlistNotifications, the cart-merge and ownership-check paths) is verified only via manual QA from [docs/qa-checklist.md](qa-checklist.md).

**No functional ambiguity, but significant investment:**

- Set up Vitest + Testing Library: ~1 hour.
- Write first 20 critical-path tests: ~1 day.
- Ongoing: a test per material feature change.

Worth doing before scaling team / accepting external contributors.

---

## Dismissed false positives (with reasoning)

These ARCH rule codes generated noise that doesn't reflect real issues. Documented here so future ARCH runs can be triaged in seconds.

| Rule code | Count | Why dismissed |
|---|---:|---|
| **CV-018** "Action file with zero auth guards" | 130 | Arch can't trace through helper functions like `requirePermission()`, `auth.getUser()`. Spot-checked 10 random actions; all have proper guards. The detector doesn't follow imports. |
| **DC-012** "Dead barrel" | 110 | Arch doesn't understand Next.js Server Actions — they're invoked via the `"use server"` RPC mechanism, not via direct imports. Every action ARCH flags as a "dead barrel" is actually called from form `action={...}` or `startTransition` blocks in client components. |
| **CV-003** "File in actions/ not classified as server action" | 106 | Same root cause as DC-012 — Arch's `"use server"` detector fails on most files even though every action file has the directive at line 1. Mechanical bug in the analyzer. |
| **AR-001** "Action with excessive orchestration" | 68 | Subjective. Calling 13–18 functions to do real work (validate, fetch, compose, audit, revalidate) is normal for a Server Action; not "excessive". |
| **SEC-004** "Verify RLS policy exists for table" | 66 | Marked `unverifiable` by the tool itself. All flagged tables have RLS policies — verified in `supabase/migrations/*.sql`. ARCH can't read the migration files; it expects RLS edges in the static graph. |
| **SEC-001** "Admin route without auth guard" | 57 | False positive. Every admin page wraps in `AdminLayout` which calls `requirePermission` + `requireMFA`. ARCH doesn't trace through layout components. |
| **MI-013** "Missing loading.tsx" | 56 | Suspense loading states would be nice-to-have but not a debt. Suppress. |
| **CV-014** "Fetch without error boundary" | 54 | Almost every flagged page has an ancestor with `error.tsx` (e.g., `app/error.tsx`, `app/auth/error.tsx`, `app/checkout/error.tsx`). ARCH doesn't traverse the layout tree to find inherited boundaries. |
| **MI-012** "Missing error.tsx near X" | 68 | Same — inherited from ancestor layouts. |
| **DC-011** "Unreferenced env group" | 17 | Arch can't see that `src/lib/env.ts` validates these via Zod. The env values are used everywhere; just indirectly through `process.env.*` lookups Arch doesn't track. |
| **DR-002** "Multiple Supabase clients of same tier" | 2 | By design. `createClient()` is a factory that returns a request-scoped client. Each invocation is intentional. Singleton would break Next.js's request-scoped cookies model. |
| **BP-003** "God action writes 5 tables: createProduct" | 1 | Deliberate atomicity. Product creation involves products + variants + categories + supplier links + SEO metadata, and all must succeed together or roll back. Splitting it loses transactionality. |
| **PV-004** "API route writes DB without auth: heartbeat" | 1 | False — heartbeat calls `supabase.auth.getUser()` at line 46 and does an explicit ownership check before update. |
| **SEC-008** "Mutation API route without auth: heartbeat" | 1 | Same finding under a different rule. Same dismissal. |
| **SEC-010** "Webhook without signature verification" | 2 | False — Stripe webhook verifies `stripe-signature` via `stripe.webhooks.constructEvent` at line 45. Mock-payment is gated to dev/mock-provider mode only. |
| **SEC-011** "Cron route without secret validation" | 1 | False — cron route checks `Authorization: Bearer ${CRON_SECRET}` at line 29. |
| **SEC-005** "Action writes DB without auth: subscribeNewsletter" | 1 | Intentional. Newsletter signup is a public endpoint by design. Recently hardened with rate limits, honeypot, and audit logging — see [docs/security/auth-jwt-audit-2026-05-24.md](security/auth-jwt-audit-2026-05-24.md). |
| **SEC-005** "Action writes DB without auth: fulfillOrder" | 1 | **Was real — shipped as TD-1.** |
| **SEC-005** "Action writes DB without auth: listAcsStations" | 1 | **Was real — shipped as TD-2.** |
| **AR-002** "No root error boundary (app/error.tsx missing)" | 1 | False — `src/app/error.tsx` exists. |
| **BP-001** "High fan-in component: AdminLayout (55)" | 1 | Promoted to TD-12. |
| **DC-001** "Unused component: ACTIVE_CURRENCY_COOKIE" | 1 | False — it's exported from `CurrencySwitcher.tsx` and used in `lib/multi-currency/getActiveCurrency.ts`. Arch's import tracker missed the re-export. |
| **MI-002** "Missing generated TypeScript types" | 1 | Promoted to TD-5. |
| **TC-001** "No test files" | 1 | Promoted to TD-6. |
| **MI-022** "Dynamic route missing generateMetadata" | 2 | Promoted to TD-7. |
| **MC-010** "package.json missing engines.node" | 1 | **Was real — shipped as TD-4.** |
| **SEC-016** "Middleware missing HTTP security headers" | 1 | Promoted to TD-3. |
| **SEO-006** "Auth/transactional page missing noindex" | 6 | Promoted to TD-8. |
| **SEO-001** "Public page missing metadata" | 10 | Promoted to TD-9. |
| **DC-001** other components (WorkspaceTabs, ChatWidget, opengraph-image) | 3 | Promoted to TD-10 / TD-11. |
| **DC-003** "Unused server action: leaveSoftWaitQueue" | 1 | Promoted to TD-10. |
| **BP-010** "Page renders 10 components directly" | 2 | Subjective architectural taste. Admin pages legitimately compose many widgets; ARCH's "threshold of 10" is arbitrary. Suppress. |

**Suppression candidates for ARCH rules going forward:**

The following rules consistently misfire on Next.js 14 App Router projects with Supabase. If ARCH supports `.archignore`-style suppression, add: `CV-018`, `DC-012`, `CV-003`, `AR-001`, `SEC-004` (unverifiable), `SEC-001` (layout traversal), `MI-012`, `MI-013`, `CV-014`, `DC-011` (Zod env), `DR-002`, `AR-002` (root error boundary detection), `PV-004` / `SEC-008` (heartbeat false positive specifically), `SEC-010` (Stripe HMAC detection), `SEC-011` (Bearer detection). After suppression, ~95% of the noise disappears and the remaining ~30–40 diagnostics are mostly real.

---

## Reading guide

When triaging this list with limited time:

- **Treat "Shipped" as done.** No further action on TD-1, TD-2, TD-4, or the three always-on headers in TD-3.
- **TD-11** can be knocked out in 5 minutes — pure verification.
- **TD-3 HSTS remainder** is unambiguous in mechanism but irreversible in client cache duration — commit to the ramp plan or skip until production launch.
- **TD-8** is unambiguous in intent with one UX trade-off worth flagging (users can't find login via Google).
- **TD-7 / TD-9 / TD-10 / TD-12** need a deliberate decision from the feature owner — they're not "just ship" items.
- **TD-5 / TD-6** are larger engineering investments; schedule when you have a dedicated block of time.

When in doubt, the question to ask is: "Could this change ship today without anyone needing to look at it twice?" If yes, it belongs in the "unambiguous" tier. If anyone has to think about whether the change is correct for our use case, it's a design decision and needs a conversation.

---

## Notes for future ARCH runs

- Re-running ARCH will produce a similar volume of noise until the rule suppressions land. Triage with this doc as the reference — most of the "errors" can be skipped on sight.
- ARCH is genuinely useful for the long-tail SEO/hygiene items (metadata, generateMetadata, engines.node) that humans tend to forget. Re-run quarterly or after major feature work.
- Don't trust the high-volume `CV-*` and `SEC-001` / `SEC-004` rules without manual verification. They're systematically wrong on this codebase shape (Next.js App Router + Supabase + Server Actions).
- The three real items it surfaced (TD-1, TD-2, TD-4) wouldn't have been caught easily by manual review. The tool earns its keep on the rare true positives buried in the noise.
