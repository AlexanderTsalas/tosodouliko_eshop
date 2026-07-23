# Data-Layer Performance Audit — Follow-up (Second Pass)

**Date:** 2026-06-11
**Status:** Companion to [docs/data-layer-performance-audit.md](data-layer-performance-audit.md) and [docs/data-layer-implementation-plan.md](data-layer-implementation-plan.md).

This is a second-pass review run **after** all phases 0-10 of the original remediation shipped (Phase 7 just landed). The first audit was server/database-focused; this pass widens the scope to surface residual server-side N+1s the first pass missed, schema-level inefficiencies that emerged or weren't covered, and client-side rendering inefficiencies that were entirely out of the first audit's scope.

The findings are smaller than the original audit's HIGH items by design — the architectural plumbing is now sound. These are residual inefficiencies that "don't justify their existence" in the user's framing: each is a small amount of code that pays back its fix immediately and compounds with the others.

---

## TL;DR — the seven things worth fixing

Sorted by leverage-per-engineering-hour. The first three together are ~3 hours of work and remove the next round of measurable round-trip bloat from the customer hot path.

1. **Batch the three remaining per-line release_soft loops** in `joinSoftWaitQueue` / `continueCheckoutWithoutContestedItems` / `releaseSoftHoldByHolder`. Same fix shape as Phase 2 — add a `release_soft_batch(p_lines jsonb)` RPC that already exists in the batch family and migrate the three call sites. Eliminates 3N round-trips on the contention-modal hot paths.
2. **Retention crons on append-only tables.** `audit_events`, `error_events`, `system_errors`, `stripe_events_processed`, plus graveyard rows in `cart_checkout_sessions`, `soft_waits`, `priority_holds`, `collapse_notifications`. Without these, every index from Phase 1 pays a growing maintenance cost forever.
3. **Index the two unindexed FK columns on `cart_checkout_sessions`** (`order_id`, `payment_intent_id`). `ON DELETE SET NULL` cascades from `orders` and `payment_intents` currently do a sequential scan; partial indexes fix it.
4. **Fix the product detail page hero `<img>` and product grid `<Image>` sizing.** The single biggest LCP win on the storefront — the hero is a raw `<img>` skipping AVIF/WebP entirely, and the grid Images ship full-resolution to every viewport.
5. **Move the three Realtime watchers off of the global storefront layout.** They mount on every page (home, catalog, account, auth, etc.) and open Realtime channels even for visitors with no cart activity. Cost: bandwidth + connection count at concurrency.
6. **Drop touch_updated_at trigger on hot inventory tables.** The atomic RPCs already set `updated_at = now()` explicitly; the BEFORE-UPDATE trigger fires anyway and pays for itself per write.
7. **Single shared 1Hz tick context** for countdown components. Currently 4-5 uncoordinated `setInterval(1000)`s run per cart page; consolidate into one + pause on `document.hidden`.

The remaining findings below are second-tier polish.

---

## A. Server-side residual round-trips

The original audit eliminated the big N+1s on the inventory and availability paths. The agents found three more on the same family of hot paths — all contention-related, all the same fix shape.

### A-H1 — `joinSoftWaitQueue.ts:100-113` (HIGH)

**Problem:** After loading all candidate holder sessions for a contested variant, the action sequentially `SELECT`s `cart_items` once per session to find which session actually holds the variant. N round-trips where N is the count of concurrently-soft sessions globally, on a hot path that fires every time a customer joins a queue.

**Fix:** One `cart_items` query with `.in("cart_id", cartIds).eq("variant_id", variantId).gt("quantity", 0)`, then pick earliest-`expires_at` in JS. Drops from N round-trips to 1.

### A-H2 — `continueCheckoutWithoutContestedItems.ts:113-124` (HIGH)

**Problem:** For each contested item the customer drops from their cart, the action sequentially `release_soft` + then `cart_items.delete()` — 2N round-trips on the "I'll proceed without the contested items" modal acceptance path. Release failures are silently swallowed, but the deletes still run.

**Fix:** `release_soft_batch(p_lines jsonb)` exists from Phase 2 — use it. Then one `cart_items.delete().in("id", itemIds)`. Drops from 2N to 2.

### A-H3 — `releaseSoftHoldByHolder.ts:79-88` (HIGH)

**Problem:** Sequential `release_soft` RPC per cart_item in a `for` loop on the "Παραχώρηση σειράς" (offer-your-turn) path. Every time the holder gives up their queue position, they pay N round-trips.

**Fix:** Same `release_soft_batch` from Phase 2. Drops to one round-trip.

### A-M1 — `handleSessionEvents.ts:216-222 releaseOrderReservations` (MED)

**Problem:** After the Phase 3 batch release succeeds, the code sequentially awaits `dispatchWishlistNotifications` per released line in a `for` loop **inside the Stripe webhook critical path**. Stripe times out at 10s; N items × dispatch latency directly threatens webhook 5xx storms at large orders.

**Fix:** `await Promise.all(rows.map(r => dispatchWishlistNotifications(...)))`. `dispatch` already swallows errors and the calls are independent.

### A-M2 — `placeOrder.ts:282-377` (MED)

**Problem:** When `buyer` is provided, the customer UPDATE (line 291) and `findCustomerMatches` (line 322) run strictly sequentially even though both only need `buyer` payload + `customer.id`. The match result is used only for auto-merge decision and doesn't depend on the UPDATE's outcome. One avoidable round-trip per authenticated checkout.

**Fix:** `Promise.all([updatePromise, findCustomerMatches(...)])`; refresh `customer` from the update result after the join.

### Theme: same root cause as Theme A of the original audit

All three HIGH findings (A-H1, A-H2, A-H3) are the same per-line RPC-loop pattern that Theme A of the original audit identified. Phase 2 fixed the inventory primitives but missed these three contention-action call sites. The fix is mechanical: invoke the batch RPC family that already exists. Estimated effort: 1-2 hours for all three.

---

## B. Schema + DB load residuals

The Phase 1 indexes addressed the dominant query patterns. The next layer of cost is **write-side and growth-side**, not read-side.

### B-H1 — Unbounded append-only tables with no retention (HIGH)

**Tables affected:**
- `audit_events` — ~5 rows per order; at 1000 orders/day → ~5M rows/year
- `error_events` — application errors
- `system_errors` — Phase 0's new table; will grow with Phase 8's typed catches
- `stripe_events_processed` — every Stripe webhook event (success + failure)
- `collapse_notifications` — acknowledged rows linger
- `cart_checkout_sessions` — `state='released'` graveyard rows
- `soft_waits` — `promoted_at` rows after they resolve
- `priority_holds` — `consumed_at IS NOT NULL` rows

None have a retention reaper. Every Phase 1 composite index over `(action, resource_type, resource_id, created_at)` (etc.) pays a growing maintenance cost forever. At 5M rows/year on audit_events, the index alone is ~500MB+ within 18 months.

**Fix:** A single retention migration with `pg_cron` jobs at 03:00 daily:
```sql
SELECT cron.schedule('reap-audit-events', '0 3 * * *',
  $$DELETE FROM public.audit_events WHERE created_at < now() - interval '90 days'$$);
SELECT cron.schedule('reap-error-events', '0 3 * * *', /* same shape */);
SELECT cron.schedule('reap-system-errors', '0 3 * * *',
  $$DELETE FROM public.system_errors WHERE resolved_at IS NOT NULL AND occurred_at < now() - interval '30 days'$$);
SELECT cron.schedule('reap-stripe-events', '0 3 * * *', /* 60 days */);
SELECT cron.schedule('reap-released-sessions', '0 4 * * *',
  $$DELETE FROM public.cart_checkout_sessions WHERE state='released' AND updated_at < now() - interval '7 days'$$);
SELECT cron.schedule('reap-promoted-waits', '0 4 * * *', /* 24h */);
SELECT cron.schedule('reap-consumed-holds', '0 4 * * *', /* 24h after consumed/expired */);
SELECT cron.schedule('reap-acked-collapse', '0 4 * * *', /* 30 days */);
```

Retention policies are operational choices — verify each TTL against your audit/compliance needs before applying.

### B-H2 — `cart_checkout_sessions` FK columns unindexed (HIGH)

`order_id` and `payment_intent_id` are FK columns with `ON DELETE SET NULL`. When `delete_order_safe` runs or admin purges a `payment_intents` row, the cascade does a sequential scan on `cart_checkout_sessions` looking for matching rows to NULL.

**Fix:**
```sql
CREATE INDEX idx_ccs_order_id ON public.cart_checkout_sessions(order_id)
  WHERE order_id IS NOT NULL;
CREATE INDEX idx_ccs_payment_intent_id ON public.cart_checkout_sessions(payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
```

Partial because most cart sessions never get an order_id (they're abandoned).

### B-H3 — `touch_updated_at` trigger amplifies inventory hot writes (HIGH)

The generic `touch_updated_at` BEFORE-UPDATE trigger from `20260610000016` fires on every UPDATE to every table with an `updated_at` column. Most callers benefit. But the inventory RPCs already set `updated_at = now()` explicitly inside their UPDATE statements — the trigger overwrites the same column for no benefit, and adds one PL/pgSQL invocation per write.

At checkout, a single customer triggers `hold_soft` → `promote_soft_to_reserved` → `consume_reservation` on the same inventory row. Three UPDATEs × the trigger overhead × every concurrent checkout adds up.

**Fix:** Drop the trigger on the three tables whose RPCs already maintain `updated_at`:
```sql
DROP TRIGGER IF EXISTS inventory_items_touch_updated_at ON public.inventory_items;
DROP TRIGGER IF EXISTS cart_items_touch_updated_at ON public.cart_items;
DROP TRIGGER IF EXISTS carts_touch_updated_at ON public.carts;
```

Verify each RPC body still sets `updated_at` before applying.

### B-M1 — Duplicate indexes covered by UNIQUE constraints (MED)

Seven single-column indexes duplicate columns already covered by UNIQUE constraints. Each duplicate doubles write amplification and disk usage for zero read benefit:

| Index to drop | UNIQUE that covers it |
|---|---|
| `idx_orders_order_number` | `orders.order_number UNIQUE` |
| `idx_product_variants_sku` | `product_variants.sku UNIQUE` |
| `idx_products_slug` | `products.slug UNIQUE` |
| `idx_payment_intents_stripe_id` | `payment_intents.stripe_payment_intent_id UNIQUE` |
| `idx_inventory_items_variant_id` | `inventory_items.variant_id UNIQUE` |
| `idx_attribute_values_attribute_id` | leftmost-prefix of `UNIQUE(attribute_id, value)` |
| `idx_sp_variant` | leftmost-prefix of `UNIQUE(variant_id, supplier_id)` |

**Fix:** Single `DROP INDEX` migration. Each drop is fast and reversible.

### B-M2 — `wishlist_items` UNIQUE doesn't dedupe NULL-variant entries (MED)

`UNIQUE(customer_id, product_id, variant_id)` — but in Postgres, NULLs are distinct. A customer can wishlist the same product (whole-product entry, variant_id NULL) multiple times. Same shape applies to `cart_items.uq_cart_items_product`.

**Fix:** Replace with a UNIQUE INDEX that coerces NULL to a sentinel UUID:
```sql
CREATE UNIQUE INDEX wishlist_items_uniq
  ON public.wishlist_items
  (customer_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
```

### B-M3 — `validate_attribute_combo` trigger does N+1 per row (MED)

For each key in `NEW.attribute_combo`, the trigger runs two SELECTs (`attributes` by slug, `attribute_values` by id). A 4-axis variant fires 8 queries per insert. Admin matrix-expansion of a multi-axis product fires it for every combo.

**Fix:** Rewrite as one set-based query joining `jsonb_each_text(NEW.attribute_combo) LEFT JOIN attributes LEFT JOIN attribute_values` and RAISE if any join produces a NULL.

### B-L1 — Stale full index on `orders.carrier` enum (LOW)

`idx_orders_carrier` lives on the deprecated enum column; `idx_orders_carrier_slug_partial` from Phase 1 covers all live reads now.

**Fix:** `DROP INDEX IF EXISTS public.idx_orders_carrier;`

---

## C. Client-side residuals

The original audit was server-focused. The client side has its own bottlenecks — most importantly LCP (Largest Contentful Paint) and bundle/Realtime overhead on storefront cold loads.

### C-H1 — PDP hero is raw `<img>` (HIGH, biggest LCP win)

`ProductDetailInteractive.tsx:176` uses raw `<img>` (with `eslint-disable`) for the hero product image. The heaviest above-the-fold asset on the entire storefront skips `next/image`'s AVIF/WebP encoding, responsive `srcset`, and lazy/eager loading. LCP is dominated by this image; switching to `next/image` is a measurable win.

**Fix:**
```tsx
<Image
  src={...}
  alt={...}
  priority
  sizes="(min-width: 768px) 50vw, 100vw"
  width={...}
  height={...}
  placeholder="blur"
  blurDataURL={...}
/>
```

### C-H2 — Catalog grid `<Image>` lacks `sizes` + `priority` (HIGH)

`(storefront)/products/page.tsx:125-134` uses `<Image width={400} height={400}>` without a `sizes` prop, so the browser receives the full 400px image even for cards rendered at 200px on narrow viewports. None of the first-row cards are `priority`, so LCP for catalog page is delayed.

**Fix:**
```tsx
<Image
  src={...}
  width={400}
  height={400}
  sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
  quality={70}
  priority={cardIndex < 8}
  ...
/>
```

The combination of `sizes` + `quality={70}` for cards typically cuts transferred image bytes by ~40-60%.

### C-H3 — Three Realtime watchers mount on every storefront route (HIGH)

`(storefront)/layout.tsx:31-33` mounts `PromotionWatcher` + `CollapseWatcher` + `SoftWaitNextInLineWatcher` on **every** storefront page — home, catalog, account, auth, error pages. Each opens at least one Realtime channel + does an `auth.getUser` + a `customers` SELECT on mount.

For a visitor who's never added to cart, this is pure waste: 3 WebSocket subscriptions, 2 DB round-trips, before they've expressed any intent. At cold-cache page load this competes with LCP.

**Fix:** Server-resolve a `hasActiveContentionState` boolean at layout time (cheap — one query: `EXISTS active soft_waits OR priority_holds for current customer`). Render the watchers conditionally. Or move the watchers into the cart/checkout subtree only. The latter is structurally cleaner; the former preserves global behavior.

### C-M1 — `SoftWaitNextInLineWatcher` scans localStorage on every refetch (MED)

`SoftWaitNextInLineWatcher.tsx:127-132` walks `window.localStorage.length` backwards on every refetch (i.e. on every realtime burst AND every 10s poll from Phase 7). On devices with large localStorage this is synchronous + janky. Also reads localStorage per render in `getOrSetNextInLineStartedAt` (line 81-88).

**Fix:** Cache the started-at map in a ref keyed by `soft_wait_id`. Persist on first observation only. GC on a 60s timer, not per refetch.

### C-M2 — Admin galleries paint everything eagerly (MED)

`ProductImagesEditor.tsx:122` and `MediaBrowser.tsx:97` render raw `<img>` for every uploaded asset — no `loading="lazy"`, no `decoding="async"`, no width/height, no `next/image`. A 200-asset media library fires 200 full-resolution requests.

**Fix:** Switch to `next/image` with `loading="lazy"`. Add intersection-observer windowing past ~60 items if libraries grow large.

### C-M3 — `new Date().getFullYear()` in render hydration risk (MED)

`Footer.tsx:42` computes `getFullYear()` directly in render — minor SSR/CSR mismatch risk at midnight + prevents static-fragment treatment. Same shape in `WishlistRealtimeBanner.tsx:97`.

**Fix:** Hoist to module scope or initialize in `useEffect`.

### C-M4 — Multiple uncoordinated 1Hz countdown timers (MED)

`CartDrawer.tsx:209`, `WishlistRealtimeBanner.tsx:102`, `PromotionWatcher.tsx:312`, `SoftWaitNextInLineWatcher.tsx:401`, `ContentionBanner.tsx:141` — each runs its own `setInterval(1000)`. On a cart page with 3 promoted items, that's 4-5 timers triggering React setState every second, no pause when tab is hidden.

**Fix:** Shared `TickContext` provider — one `setInterval` emitting `now` to all consumers, paused on `document.visibilitychange === 'hidden'`. ~30 lines of code; consolidates a per-component pattern.

### C-Note — CartDrawer refetches full cart on any Realtime event

`useCartRealtime` triggers `cart.refresh()` (full cart fetch) on every soft_waits or priority_holds change for the customer. Post-Phase-7 the volume is small (only the customer's own events), so this is much less painful than before, but optimistic state patching would still be smoother UX.

Not raised as a finding because Phase 7 reduced its cost by ~95%; revisit only if perceived cart-jank becomes a complaint.

---

## D. Prioritization

If you only have 2-3 hours: do the three highest-leverage items in column A (the per-line release_soft loops in `joinSoftWaitQueue` / `continueCheckoutWithoutContestedItems` / `releaseSoftHoldByHolder`). All three are the same fix; they collectively remove the next visible round-trip layer from contention hot paths.

If you have a day: add B-H1 (retention crons) and B-H2 (cart_checkout_sessions FK indexes). Together these prevent the DB from accruing growth-related slowdown over the next 12-24 months — every other fix gets easier with these in place.

If you have a second day for storefront polish: C-H1 + C-H2 + C-H3 cumulatively are the largest LCP win available. The PDP hero alone probably moves LCP by 200-500ms; the catalog grid sizing on top is another 100-300ms.

Everything else (B-M1 through B-M3, C-M*) is real but tier-2 polish. Worth scheduling in a sweep but no specific urgency.

---

## E. Estimated effort + impact

| Phase | Items | Effort | Impact |
|---|---|---|---|
| **A — Contention round-trips** | A-H1, A-H2, A-H3 | 1-2 hours | Removes 3N round-trips per contention action, joins the Theme A family from the original audit |
| **B — DB retention + FK indexes** | B-H1, B-H2 | 2-3 hours | Caps long-term index bloat; fixes the next-most-expensive cascade scan |
| **B — Trigger pruning** | B-H3 | 1 hour | ~5-15% write throughput improvement on inventory tables |
| **B — Schema cleanup** | B-M1, B-M2, B-M3, B-L1 | 2-3 hours | Removes write amplification; fixes wishlist dedupe |
| **C — LCP wins** | C-H1, C-H2 | 2-3 hours | 200-800ms LCP improvement on PDP + catalog |
| **C — Watcher gating** | C-H3 | 2-3 hours | Removes cold-load Realtime overhead for visitors |
| **C — Tick consolidation** | C-M4 | 1 hour | Per-second render storm consolidated; background-tab CPU drops |
| **C — Polish** | C-M1, C-M2, C-M3 | 2-3 hours | Hydration safety + memory waste |
| **Total** | 21 findings | ~14-22 hours | Removes most remaining waste below the "architecture is fine" threshold |

---

## F. What's no longer worth chasing

Findings the audits surfaced but I'm deliberately not raising:

- **No `next/dynamic` use anywhere.** Could split admin editors / modals out of initial bundles. Currently bundles are small enough (the storefront pages are RSC-heavy) that this isn't paying off — revisit if any storefront route's `_next/static/chunks/pages/X.js` crosses 200KB.
- **`useEffect` dependency-array misuse.** A few exist, but each one is a single-component regression not a systemic perf issue.
- **More tables eligible for STATEMENT-level triggers.** Phase 8 caught the highest-volume case (`update_cart_totals`). The remaining ROW-level triggers fire on much lower-volume tables.
- **Materialized view for `/admin/reports/margins`.** Still pending from the original audit's deferred list. Real but lower priority than the contention round-trips.

---

## G. Phase 7 status

Just shipped — `useCartRealtime` + `SoftWaitNextInLineWatcher` now filter by `customer_id` (with a 10s polling fallback in the watcher to catch queue-advancement events that the scoped subscription misses). This was the headline deferred item from the original audit; it's now done.

Per-client Realtime broadcast volume during contention should drop by ~95% as documented in the original audit's Theme E.

The follow-up finding C-H3 (three watchers mounted on every storefront page) compounds with Phase 7: the filter narrowing helped per-watcher cost, but mounting them on pages where no customer state exists is still wasted setup. Together C-H3 + the Phase 7 filter take per-client overhead from "expensive on every page mount" to "zero on browse pages, scoped on cart/checkout pages."

---

This document supersedes nothing in the original audit; it adds the next layer below it. Most findings are 30-90 minutes of focused work apiece. None require new architectural reasoning — the architecture is right; these are residuals.
