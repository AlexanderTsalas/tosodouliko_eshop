# Data-Layer Performance Audit

**Date:** 2026-06-10
**Scope:** Full pass across the Next.js 14 + Supabase data layer — storefront reads, admin reads, server actions, Postgres schema/indexes, Next.js caching, Postgres RPC, RLS policies, Supabase Realtime.

This document is the synthesis of six parallel investigations into independent dimensions of data-layer performance. It identifies bottlenecks that will hurt at realistic traffic before they become incident-level problems, and gives concrete remediation paths sorted by leverage.

---

## TL;DR — the seven things that matter most

If you only fix seven things from this report, fix these:

1. **Batch the inventory hot-path RPCs.** `reserveAllOrFail`, `holdSoftAllOrFail`, `promoteAllOrFail`, `releaseSoftAll`, and `identifyContested` all do N sequential RPC round-trips for an N-item cart. Five hot-path actions × every cart action. The codebase already has the pattern (`commit_order_with_lines`, `consume_priority_holds_for_checkout`) — apply it here. **Single highest-leverage fix in this audit.**
2. **Batch `effective_available_for` and `contestable_available_for`.** Same shape as #1: per-variant RPC loops on every product detail render, every wishlist render, every checkout. Each call also writes (opportunistic cleanup), so this is the loudest read path in the system.
3. **Add `revalidateTag("catalog-facets")` to inventory and variant mutations.** Every variant add/remove and every inventory change alters what the catalog shows, but neither path busts the 5-min cached facets. Customer sees out-of-stock products as available for up to 5 minutes.
4. **Add the missing composite indexes for `orders` admin list and `effective_available_for`.** `(fulfillment_status, created_at DESC)`, `(payment_status, created_at DESC)`, `(order_items.order_id, variant_id)`. Single-column indexes don't cover the dominant access pattern.
5. **Stop paginating in JS for admin lists.** `/admin/inventory` caps at 2000 rows then slices in JS. `/admin/supply-orders` (tracking view) loads ALL non-draft orders unbounded. `/admin/customers/[id]` aggregates orders in JS. At >2k variants or >2k orders these pages either silently truncate or freeze.
6. **Use the existing atomic merge RPC from `mergeCustomers`** (admin path) — it currently does the unsafe multi-step write that `placeOrder` already replaced with `merge_offline_customer`.
7. **Tighten Realtime subscription filters.** `useCartRealtime` and `SoftWaitNextInLineWatcher` subscribe to entire tables with no `.eq()` filter, relying on RLS to drop unwanted events client-side. At scale every cart-active customer receives every other customer's contention traffic.

The codebase is in good architectural shape overall — atomic RPC patterns are well-established (`commit_order_with_lines`, `merge_offline_customer`, `addMatrixCombos`'s supplier propagation), RLS is comprehensive, caching tags are used. The work below is mostly **applying existing good patterns consistently** rather than designing new ones.

---

## Cross-cutting themes

Before the per-dimension detail, here are the systemic patterns that came up in multiple audits — fixing the root pattern is more leveraged than fixing individual instances.

### Theme A — N+1 RPC loops on hot paths

The single most common issue across the audit. Six independent hot paths do per-iteration RPC calls inside JavaScript loops:

| Path | Where | Per-iteration call |
|---|---|---|
| Variant availability on product page | [src/lib/inventory/getEffectiveAvailable.ts:42-49](src/lib/inventory/getEffectiveAvailable.ts) | `rpc("effective_available_for")` |
| Variant availability on contention | [src/lib/inventory/getContestableAvailable.ts:30-36](src/lib/inventory/getContestableAvailable.ts) | `rpc("contestable_available_for")` — ALSO writes |
| Wishlist availability | [src/lib/wishlist/getWishlist.ts:152-158](src/lib/wishlist/getWishlist.ts) | `rpc("effective_available_for")` |
| Cart soft-hold acquisition | [src/lib/inventory/holdSoftAllOrFail.ts:22-45](src/lib/inventory/holdSoftAllOrFail.ts) | `rpc("hold_soft")` + JS rollback |
| Reservation during checkout | [src/lib/inventory/reserveAllOrFail.ts:43-66](src/lib/inventory/reserveAllOrFail.ts) | `rpc("reserve_inventory")` + JS rollback |
| Soft-to-hard promotion | [src/lib/inventory/promoteAllOrFail.ts:90-114](src/lib/inventory/promoteAllOrFail.ts) | `rpc("promote_soft_to_reserved")` + JS rollback |
| Contention identification | [src/actions/checkout/startCheckoutSession.ts:276-303](src/actions/checkout/startCheckoutSession.ts) | `rpc("effective_available_for")` |

The cost is N network round-trips per cart, where N is line count. A 5-item cart placement = 5 hold_soft round-trips + (typically) 5 promote round-trips + 5 reserve round-trips. The JS-layer rollback on partial failure adds up to N more on the worst case. Every order placement is paying ~30+ Postgres round-trips through Supabase's HTTP layer where it should be 3.

**The pattern to copy:** [commit_order_with_lines](supabase/migrations/20260610000012_commit_order_atomically.sql) accepts `p_lines jsonb` and processes the array inside a single transaction. [consume_priority_holds_for_checkout](supabase/migrations/20260601000010_consume_priority_holds_batch.sql) accepts `p_variant_ids uuid[]`. These work. Apply the same shape to the four `*_all_or_fail` operations and the two `*_available_for` reads.

**Estimated impact:** order placement latency drops from ~600ms to ~150ms at the action layer for a typical 5-item cart. Webhook handlers (`handleSessionEvents`) similarly compress.

### Theme B — List pages fetch everything + paginate in JS

Several admin list pages skip server-side pagination and do `range(0, MAX)` then `.slice()` in Node:

| Page | Limit | Problem |
|---|---|---|
| [/admin/inventory](src/app/admin/inventory/page.tsx) | `MAX_FETCH = 2000` | Silently truncates beyond 2k variants; filters operate only on the truncated slice |
| [/admin/supply-orders](src/app/admin/supply-orders/page.tsx) tracking view | None | All non-draft orders fetched unconditionally, paginated in JS |
| [/admin/customers/[id]](src/app/admin/customers/%5Bid%5D/page.tsx) | None | All orders for the customer pulled (could be hundreds) |
| [/admin/customers](src/app/admin/customers/page.tsx) | 30 per page | Loads every order for the 30 visible customers to compute count/last_order_at in JS |
| [/admin/reports/margins](src/app/admin/reports/margins/page.tsx) | None | All active products + every product_categories row + every supplier_products preferred row |
| [/admin/attributes](src/app/admin/attributes/page.tsx) | None | Every variant's attribute_combo + every spec, to figure out "which attributes are used" |
| [/admin/returns](src/app/admin/returns/page.tsx) | None | All return_requests, no filter, no pagination |

The common fix is a small pattern shift:

1. Define a Postgres view that does the JS aggregation in SQL (e.g. `customer_summary` with `count`, `sum`, `last_order_at`, `lifetime_value` per customer; `product_stock_rollup` with summed available + variant count per product).
2. Use `.range(from, to)` with `count: 'exact'` for true server-side pagination.
3. For status/filter badges, use 4 parallel `head: true, count: 'exact'` queries instead of `allRows.filter(...).length`.

**Estimated impact:** the affected pages stop loading-spinning at >2k records and become latency-stable as the dataset grows.

### Theme C — Mutations don't fully invalidate cache surfaces

The `catalog-facets` tag (5-min `unstable_cache`) is the storefront's facet brain — it powers the OOS badges, the color/size filter panels, and the category counts. Several admin mutations alter what that cache should show, but don't bust it:

| Mutation | Missing tag/path |
|---|---|
| `setInventoryLevel`, `bulkInventoryOps` | `catalog-facets` (in-stock → OOS transition) |
| `addVariant`, `addAxisToProduct`, `addAxisValueToProduct`, `addMatrixCombos` | `catalog-facets` (new facet values) + `/products` + `/products/[slug]` |
| `updateVariant`, `deleteVariant` | `catalog-facets` |
| `setProductCategories` | `/products` + `catalog-facets` + `categories` tag |
| `bulkUpdateProducts`, `bulkDeleteProducts` | `/products`, `/sitemap.xml`, `catalog-facets` |

There are also a couple of **over-broad** invalidations to fix in the opposite direction:

- `signOut` calls `revalidatePath("/", "layout")` — busts the entire site's RSC cache on every sign-out (one stampede per logout).
- Every attribute mutation (`createAttribute`, `updateAttribute`, `deleteAttribute`, `createAttributeValue`, …) calls `revalidatePath("/admin", "layout")` — flushes the entire admin layout cache.

Scope these to the specific affected surfaces.

### Theme D — `EXCEPTION WHEN OTHERS THEN RAISE NOTICE` is hiding perf bugs

14+ Postgres functions use the broad catch + `RAISE NOTICE` pattern to swallow non-benign exceptions silently. The intent is to keep batch operations (reapers, opportunistic cleanups) from aborting mid-batch on one bad row — sound. The side effect is that **lock waits, FK violations, and serialization failures look the same as benign INSUFFICIENT_SOFT_HELD races**, making it impossible to spot perf degradation in logs.

Locations: `reap_stale_soft_sessions`, `opportunistic_cleanup_and_reconciliation`, `release_soft_session`, `heartbeat_fallback`, `cleanup_includes_stale_heartbeat`, `priority_hold_rpcs`, `priority_hold_reaper` (×8), `conditional_contention_timer` (×4), `viewer_aware_effective_available`, `consume_priority_holds_batch`. (See L4 in the L-series items if you want the full migration paths.)

**Fix:** narrow the catch to the specific benign codes only (`unique_violation`, `WHEN SQLERRM LIKE '%INSUFFICIENT_SOFT_HELD%'`) and let real failures propagate. The codebase already string-matches SQLERRM in some branches, so the refactor is mechanical.

### Theme E — Realtime broadcasts without server-side filtering

Several Realtime subscriptions omit `.eq()` filters and rely on RLS to drop irrelevant events client-side:

- `useCartRealtime` ([src/hooks/useCartRealtime.ts:54-63](src/hooks/useCartRealtime.ts)) subscribes to ALL changes on `soft_waits` + `priority_holds`.
- `SoftWaitNextInLineWatcher` ([src/components/features/contention/SoftWaitNextInLineWatcher.tsx:153-166](src/components/features/contention/SoftWaitNextInLineWatcher.tsx)) subscribes to all `soft_waits` rows.
- `inventory_items` Realtime publication ([20260526000005_realtime_inventory_publication.sql](supabase/migrations/20260526000005_realtime_inventory_publication.sql)) broadcasts every inventory change to every anon browser on a product page.

At small scale this is fine. At catalog scale (>1k SKUs + >100 concurrent customers), the Realtime cost becomes meaningful: every connected client receives O(writes) WAL traffic from Realtime before client-side filtering.

**Fix:** add `filter: 'customer_id=eq.${customerId}'` (or equivalent) at the subscription level. The pattern is already used for `cart_items` and `wishlist_items`.

### Theme F — Compensating actions don't compensate atomically

The codebase has a documented "all-or-nothing via JS rollback in reverse order" pattern for bulk inventory operations (`reserveAllOrFail`, `holdSoftAllOrFail`, `promoteAllOrFail`, `deleteOrder`). The rollback itself only `console.error`s on failure — meaning every hot-path operation that touches >1 inventory row is one network hiccup away from leaking reservations.

This is the underlying reason for Theme A and several HIGH-severity items in the actions audit. Fix Theme A and this theme disappears with it.

---

## Storefront read paths

### High severity

**S-H1 — `getContestableAvailableForVariants` per-variant RPC, also writes.** Every product detail render runs `await admin.rpc("contestable_available_for", …)` in a loop, one per variant. Each RPC ALSO runs `cleanup_expired_sessions_for_variant` — which writes. A 10-variant product = 10 sequential round-trips + 10 write transactions. ([src/lib/inventory/getContestableAvailable.ts:30-36](src/lib/inventory/getContestableAvailable.ts)) **Fix:** new `contestable_available_for_variants(uuid[])` returning `(variant_id, qty)` table + one cleanup pass; loop becomes one RPC. (See Theme A.)

**S-H2 — Wishlist availability is per-variant RPC.** ([src/lib/wishlist/getWishlist.ts:152-158](src/lib/wishlist/getWishlist.ts)) Same shape. Same fix.

**S-H3 — `getEffectiveAvailableForVariants` per-variant RPC.** ([src/lib/inventory/getEffectiveAvailable.ts:42-49](src/lib/inventory/getEffectiveAvailable.ts)) Same shape. Same fix. These three together are the single largest read-path inefficiency in the system.

**S-H4 — Catalog facets fetch the entire active catalog on cache miss.** `getCatalogFacets` selects `(... inventory_items(...))` with no LIMIT, then JS-filters by the active-product set. The 5-min `unstable_cache` masks it, but cache misses during traffic spikes hit Postgres hard. ([src/lib/site-search/getCatalogFacets.ts:128-133, 343](src/lib/site-search/getCatalogFacets.ts)) **Fix:** push the `products.active` join + filter into SQL (view or RPC) so Node doesn't deserialize every active variant.

**S-H5 — `searchVariants` SELECT * on products + every active variant before pagination.** Pagination happens in JS at line ~419. Every catalog page render scans the entire active catalog server-side. ([src/lib/site-search/searchVariants.ts:83, 157-160, 245, 419](src/lib/site-search/searchVariants.ts)) **Fix:** select only catalog-card columns; push OOS/visibility cascade + pagination into a SQL view/RPC.

### Medium severity

- **S-M1 — Spec-filter loop in `searchVariants`** does one query per attribute filter ([src/lib/site-search/searchVariants.ts:224-243](src/lib/site-search/searchVariants.ts)). Fix: single `.in("attributes.slug", slugs)` + group in JS.
- **S-M2 — `getProductBySlug` has a sequential `attribute_values` fetch** after the parallel block ([src/lib/site-search/getProductBySlug.ts:55-75, 126-130](src/lib/site-search/getProductBySlug.ts)). Fix: hoist into the Promise.all.
- **S-M3 — `getCart` issues 3 sequential follow-up queries** (soft_waits → priority_holds → admin pending count). Last two are independent. ([src/lib/cart/getCart.ts:54, 76, 102](src/lib/cart/getCart.ts)) Fix: Promise.all the last two.
- **S-M4 — `generateMetadata` re-fetches data already fetched in the page.** ([src/app/(storefront)/products/[slug]/page.tsx:38-42](src/app/%28storefront%29/products/%5Bslug%5D/page.tsx)) `getProductBySlug` is wrapped in `React.cache` already (good), but metadata runs a SECOND `attribute_values.in` query that the page's main Promise.all ALSO runs. Fix: wrap in `React.cache` or fold into the main fetch.
- **S-M5 — Checkout page re-reads carriers + methods on every render.** `listActiveCarriers` is per-request `React.cache` only, not cross-request. ([src/app/(storefront)/checkout/page.tsx](src/app/%28storefront%29/checkout/page.tsx)) Fix: wrap in `unstable_cache` with a `carriers` tag.

### Low severity

- **S-L1 — `SELECT *` on orders detail** pulls `fees_breakdown`/`shipping_address` jsonb that the page doesn't render. ([src/app/(storefront)/orders/[id]/page.tsx](src/app/%28storefront%29/orders/%5Bid%5D/page.tsx), [success/[id]/page.tsx](src/app/%28storefront%29/checkout/success/%5Bid%5D/page.tsx))
- **S-L2 — `addresses.select("*")` on checkout + account/addresses.** Cheap to tighten.
- **S-L3 — Index hints** for storefront-hot tables (full list in the dedicated section below).

---

## Admin read paths

### High severity

**A-H1 — `/admin/inventory` caps at 2000 rows + paginates in JS.** ([src/app/admin/inventory/page.tsx:30, 122-150, 200-203](src/app/admin/inventory/page.tsx)) Silently truncates beyond 2k variants; status/active/category/supplier filters operate on the already-truncated slice; pagination is wrong. **Fix:** SQL view `inventory_with_product_status` + Supabase `.range()` + `count: 'exact'`.

**A-H2 — Same page pulls every open supply_order to flag draft/placed variants.** ([src/app/admin/inventory/page.tsx:221-244](src/app/admin/inventory/page.tsx)) Loads ALL draft+placed supply orders with all their lines just to flag a 25-row visible page. **Fix:** restrict to `supply_order_lines.variant_id IN (visiblePageVariantIds)`.

**A-H3 — `/admin/supply-orders` tracking view fetches ALL non-draft orders.** ([src/app/admin/supply-orders/page.tsx:44-93](src/app/admin/supply-orders/page.tsx)) No `.range()`, no `count: 'exact'`. **Fix:** parallel head-only counts for badges + range-paginated query for the visible page.

**A-H4 — `/admin/supply-orders` drafts view runs sequential per-supplier fetches in a loop.** ([src/app/admin/supply-orders/page.tsx:163-181](src/app/admin/supply-orders/page.tsx)) `for (const supplierId of supplierIdsWithoutDraft) { await supabase.from("suppliers")...maybeSingle() }` — N+1. **Fix:** single `.in('id', Array.from(supplierIdsWithoutDraft))`.

**A-H5 — `/admin/customers/[id]` aggregates every order in JS.** ([src/app/admin/customers/[id]/page.tsx:34-44, 57-82, 143-144](src/app/admin/customers/%5Bid%5D/page.tsx)) Loads every order for the customer + reduces in JS + re-queries duplicates. **Fix:** `customer_summary` view (count + sum + last_order_at + lifetime_value); reuse inside duplicate suggestions.

**A-H6 — `/admin/customers` list aggregates order_count + last_order_at per row in JS.** ([src/app/admin/customers/page.tsx:111-129](src/app/admin/customers/page.tsx)) **Fix:** same `customer_summary` view.

### Medium severity

- **A-M1 — `/admin/products/[id]/edit` variants tab has a nested await inside a `Promise.all`.** ([src/app/admin/products/[id]/edit/page.tsx:268-282](src/app/admin/products/%5Bid%5D/edit/page.tsx)) Fix: pull inventory_items via the variants embed.
- **A-M2 — `/admin/products` list has three sequential phases + stock filter applied after pagination.** Pagination returns under-filled pages; `total` count is wrong. Fix: collapse phases; expose `product_stock_rollup` view; filter in SQL.
- **A-M3 — `/admin/orders/[id]` has sequential awaits after the Promise.all** for carriers + capabilities. ([src/app/admin/orders/[id]/page.tsx:71-91](src/app/admin/orders/%5Bid%5D/page.tsx)) Fix: include `delivery_carriers` in the orders embed; capabilities becomes pure transform.
- **A-M4 — `/admin/reports/margins` fetches whole catalog unconditionally.** Unscalable beyond a few thousand SKUs. Fix: materialized view `product_margins_mv` refreshed nightly.
- **A-M5 — `/admin/orders` list — carrier templates fetched sequentially before orders.** Fix: Promise.all.
- **A-M6 — `/admin/attributes` fetches every variant's attribute_combo + every spec to compute "which attributes are in use."** Fix: `attribute_usage` view (`attribute_id, is_variant_axis, is_spec`).
- **A-M7 — `/admin/returns` fetches all return_requests unbounded.** Fix: filter + range pagination.

### Low severity

- **A-L1 — `/admin` dashboard runs 4 stat counts sequentially.** Fix: conditional list + Promise.all.
- **A-L2 — Repeated metadata fetches across pages.** `categories`/`suppliers`/`vat_rates`/`attributes`/`attribute_values` re-fetched independently by many pages. Fix: shared `getAdminCatalogMetadata()` helper with `unstable_cache` + tag invalidation.

---

## Server actions / write paths

### High severity

**W-H1 — `fulfillOrder` loops over order_items with sequential consume + update + cost-snapshot.** ([src/lib/fulfillment/fulfillOrder.ts:91-155](src/lib/fulfillment/fulfillOrder.ts)) If item 3 of 5 fails, items 1-2 already consumed with no rollback. **Fix:** `fulfill_order_atomic(p_order_id)` RPC.

**W-H2 — `reserveAllOrFail` / `holdSoftAllOrFail` / `promoteAllOrFail` per-line RPC loops with JS rollback.** ([src/lib/inventory/reserveAllOrFail.ts:43-66](src/lib/inventory/reserveAllOrFail.ts) and siblings) See Theme A. Highest-leverage write-path fix.

**W-H3 — `transitionOrderStatus` per-item RPC loop with `dispatchWishlistNotifications` inline.** ([src/actions/orders/transitionOrderStatus.ts:233-252](src/actions/orders/transitionOrderStatus.ts)) Mid-loop failure leaves partial inventory effect. **Fix:** batched RPCs from Theme A; move wishlist dispatch to a queued tickle.

**W-H4 — `refundOrder` UPDATE then per-item `restore_inventory` loop, not atomic.** ([src/actions/orders/refundOrder.ts:214-242](src/actions/orders/refundOrder.ts)) Webhook race could observe "refunded" with inventory not yet restored. Swallows errors silently. **Fix:** `refund_order(orderId)` RPC.

**W-H5 — `createOrder` three-step write with patched-notes-on-failure error handling.** ([src/actions/orders/createOrder.ts:280-332](src/actions/orders/createOrder.ts)) Fix: reuse `commit_order_with_lines` + the batched reserve RPC.

**W-H6 — `handleSessionEvents` Stripe webhook is 4 unrelated writes per event, no transaction, per-item wishlist dispatch in the release loop.** ([src/lib/payment/handleSessionEvents.ts:108-126, 167-177, 197-223](src/lib/payment/handleSessionEvents.ts)) 5xx between releases means Stripe retries and `release_reservation` re-fires with INSUFFICIENT_RESERVED noise. **Fix:** `handle_session_completed_atomic` RPC; queue wishlist dispatch.

**W-H7 — `deleteOrder` per-item release + restore loop with fallback-then-fallback pattern.** ([src/actions/orders/deleteOrder.ts:152-188](src/actions/orders/deleteOrder.ts)) Failure at item 4 of 6 leaves 1-3 released and 5-6 not. **Fix:** `delete_order_safe(orderId)` RPC.

### Medium severity

- **W-M1 — `identifyContested` sequential RPC per cart item on contention modal hot path.** ([src/actions/checkout/startCheckoutSession.ts:276-303](src/actions/checkout/startCheckoutSession.ts)) See Theme A.
- **W-M2 — `bulkSetQuantity` upserts N rows one at a time.** ([src/actions/inventory/bulkInventoryOps.ts:67-80](src/actions/inventory/bulkInventoryOps.ts)) Fix: single bulk upsert.
- **W-M3 — `addAxisValueToProduct` / `addAxisToProduct` per-combo INSERT loop.** Fix: single bulk insert.
- **W-M4 — `mergeCustomers` (admin path) does the unsafe multi-step write** that `placeOrder` already replaced with `merge_offline_customer`. ([src/actions/customers/mergeCustomers.ts:120-168](src/actions/customers/mergeCustomers.ts)) Fix: call the existing RPC.
- **W-M5 — `createProduct` does 5-6 separate inserts with hand-rolled compensating deletes** that can themselves fail. ([src/actions/products/createProduct.ts:152-315](src/actions/products/createProduct.ts)) Fix: `create_product_atomic` RPC OR move non-critical inserts (SEO metadata) to truly best-effort retry queue.
- **W-M6 — `deleteAttributeValue` scans every variant in the catalog in JS.** ([src/actions/attributes/deleteAttributeValue.ts:29-44](src/actions/attributes/deleteAttributeValue.ts)) Fix: PG-side existence query using `jsonb_path_exists` or `@>` with a GIN index.
- **W-M7 — `addProductSpec` / `updateProductSpec` read-modify-write race on attribute_values.** ([src/actions/product-specifications/addProductSpec.ts:101-127](src/actions/product-specifications/addProductSpec.ts)) Two concurrent admins adding the same value can both pass the "not found" check. Fix: `INSERT ... ON CONFLICT (attribute_id, slug) DO NOTHING`.

### Low severity

- **W-L1 — `logAuditEvent` is one INSERT per call, fired 1-3× per mutation.** Floor of mutation latency. Fix: buffered writer flushing every ~250ms or every N events.
- **W-L2 — `saveOrderTracking` SELECT-then-INSERT not atomic.** Concurrent createVoucher could double-insert. Fix: unique index + ON CONFLICT DO NOTHING.
- **W-L3 — Stripe webhook idempotency claim is two round-trips** (insert claim then update outcome). Fix: insert with `outcome='success'` after work, or single INSERT...ON CONFLICT.
- **W-L4 — `createCheckoutSession` three sequential SELECTs that could Promise.all.** Fix: parallelize.

---

## Schema and indexes

### High severity

**SC-H1 — `effective_available_for()` does heavy joins on every variant page view + a write.** ([20260530000002_viewer_aware_effective_available.sql:44-93](supabase/migrations/20260530000002_viewer_aware_effective_available.sql)) Fires `cleanup_expired_sessions_for_variant` then three SUM queries. `LANGUAGE plpgsql` (not STABLE) so PostgREST can't cache. The `orders JOIN order_items` filter on `(customer_id, payment_status, variant_id)` has no composite index. **Fix:**
```sql
CREATE INDEX idx_order_items_order_variant ON order_items(order_id, variant_id);
CREATE INDEX idx_orders_customer_active ON orders(customer_id) WHERE payment_status='pending';
```
Consider returning STABLE and short-circuiting cleanup when no expired sessions exist.

**SC-H2 — `update_cart_totals` trigger chain on cart_items writes does 2× correlated SUM subqueries per row change.** ([20260430000030_functions_and_triggers.sql:165-189](supabase/migrations/20260430000030_functions_and_triggers.sql)) Combined with the soft-hold reaper + `cleanup_expired_sessions_for_variant` + `touch_updated_at` cascade, every cart op fans into 5+ writes. **Fix:** fold the SUM into one CTE; make the trigger STATEMENT-level.

**SC-H3 — `/admin/orders` list paginates `ORDER BY created_at DESC` + `.eq("fulfillment_status",X)` with single-column indexes only.** At 10k+ orders, filtered pages do bitmap-AND or full scan + sort. **Fix:**
```sql
CREATE INDEX idx_orders_fulfillment_created ON orders(fulfillment_status, created_at DESC);
CREATE INDEX idx_orders_payment_created ON orders(payment_status, created_at DESC);
```

**SC-H4 — `reconcile_orphan_soft_held()` cron (every 5 min) scans entire `inventory_items` for `quantity_soft_held > 0`.** ([20260525000002_opportunistic_cleanup_and_reconciliation.sql:197-248](supabase/migrations/20260525000002_opportunistic_cleanup_and_reconciliation.sql)) **Fix:**
```sql
CREATE INDEX idx_inventory_items_soft_held_active ON inventory_items(variant_id) WHERE quantity_soft_held > 0;
```

### Medium severity

- **SC-M1 — `searchCustomers` uses leading-wildcard ILIKE (`%X%`).** ([src/actions/orders/searchCustomers.ts:44-46](src/actions/orders/searchCustomers.ts)) Forces sequential scans. **Fix:**
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX customers_search_trgm ON customers
  USING gin (email gin_trgm_ops, first_name gin_trgm_ops, last_name gin_trgm_ops, phone gin_trgm_ops);
```
- **SC-M2 — `wishlist_items.customer_id` has no standalone index.** UNIQUE on `(customer_id, product_id, variant_id)` covers equality but doesn't satisfy `WHERE customer_id=X ORDER BY created_at DESC`. **Fix:** `CREATE INDEX idx_wishlist_items_customer ON wishlist_items(customer_id, created_at DESC);`
- **SC-M3 — `cart_items.product_id` / `order_items.product_id` / `collapse_notifications.variant_id` + `.product_id` FK columns have no indexes.** CASCADE DELETEs scan these tables. Fix: btree on each.
- **SC-M4 — `audit_events` queried by `(action, resource_type, resource_id) ORDER BY created_at DESC`** ([src/app/admin/operations/daily-handoff/page.tsx:79-82](src/app/admin/operations/daily-handoff/page.tsx)) but only `(resource_type, resource_id)` is indexed. **Fix:** `CREATE INDEX idx_audit_action_resource ON audit_events(action, resource_type, resource_id, created_at DESC);`
- **SC-M5 — `idx_orders_fees_breakdown_gin` is unused** ([20260520000002_orders_fees_breakdown.sql:30-31](supabase/migrations/20260520000002_orders_fees_breakdown.sql)). No query uses `@>` or `?` on it. Pure write overhead. **Fix:** drop unless a planned report needs containment queries.
- **SC-M6 — `validate_attribute_combo` trigger** runs `SELECT FROM attributes ... slug=k` + `SELECT FROM attribute_values ... id=...` per key per variant write. Bulk variant inserts in createProduct pay this multiplied. Fix: STATEMENT-level trigger variant when called from bulk insert.

### Low severity

- **SC-L1 — `trg_products_require_variant` / `trg_variants_require_at_least_one` use `count(*)` instead of `EXISTS`.** Tiny win to switch.
- **SC-L2 — `idx_orders_carrier_slug` is non-partial** despite most rows being NULL on store_pickup. Storage waste only. Fix: `WHERE carrier_slug IS NOT NULL`.
- **SC-L3 — `uq_product_variants_combo` casts JSONB to text and is sensitive to key ordering.** Bounded impact (write-time only).

---

## Caching and invalidation

### High severity

**C-H1 — Inventory mutations skip `catalog-facets` invalidation.** ([src/actions/inventory/setInventoryLevel.ts:103-105](src/actions/inventory/setInventoryLevel.ts), [bulkInventoryOps.ts:89,143,195](src/actions/inventory/bulkInventoryOps.ts)) Inventory → OOS flip changes facet counts; only paths get busted, the 5-min facet tag serves stale data. **Fix:** add `revalidateTag("catalog-facets")` to every inventory mutation.

**C-H2 — Variant mutations don't bust `catalog-facets`.** ([src/actions/variants/addVariant.ts:71](src/actions/variants/addVariant.ts) and 5 siblings) Adding/removing variants directly changes facet sets shown on `/products`. Fix: add `revalidateTag("catalog-facets")` after each.

**C-H3 — Variant add/axis actions don't revalidate storefront pages.** Only the admin edit page is revalidated. A new variant is publicly purchasable instantly but `/products` and `/products/[slug]` stay cached for up to 60s. Fix: add `revalidatePath("/products")` and the slug variant.

**C-H4 — `setProductCategories` doesn't bust storefront/facets.** ([src/actions/products/setProductCategories.ts:45](src/actions/products/setProductCategories.ts)) Fix: add `revalidatePath("/products")` + `revalidateTag("catalog-facets")` + `revalidateTag("categories")`.

**C-H5 — `signOut` revalidates entire layout.** ([src/actions/auth/signOut.ts:84](src/actions/auth/signOut.ts)) Busts every cached RSC payload site-wide on every sign-out. Fix: scope to `/account` and `/admin`, or use an `auth` tag.

**C-H6 — Attribute admin actions bust the whole admin layout.** ([src/actions/attributes/*.ts](src/actions/attributes/)) All call `revalidatePath("/admin", "layout")`. Drops every admin page from cache on each attribute tweak. Fix: drop the layout call; the `catalog-facets` tag plus `/admin/attributes` path are enough.

### Medium severity

- **C-M1 — `bulkUpdateProducts` and `bulkDeleteProducts` miss storefront tags.** Bulk active-flag flips affect `/products` and facets. Fix: add `revalidatePath("/products")`, `/sitemap.xml`, `revalidateTag("catalog-facets")`.
- **C-M2 — `placeOrder` doesn't revalidate `/admin/inventory` or `/admin/orders`** despite reserving stock. Fix: add both paths.
- **C-M3 — `getCatalogFacets` 300s TTL is redundant** since admin mutations comprehensively bust the tag (once items C-H1–C-H4 are fixed). Fix: raise to 86400 (or `false`).
- **C-M4 — `/products` `revalidate: 60` with no tag** means admin product/inventory edits can't push-bust filtered URLs. Fix: wrap `searchVariants` in `unstable_cache` keyed by filters with `tags: ["catalog-facets","products"]`.

### Low severity

- **C-L1 — `/products/[slug]` re-fetches `attributes` + `attribute_values` per request.** Global dictionaries. Fix: `unstable_cache` with `tags: ["attributes"]`.

---

## RPC, RLS, and Realtime

### High severity

**R-H1 — Per-row N+1 in checkout hot path** (`reserveAllOrFail`, `holdSoftAllOrFail`, `promoteAllOrFail`, `releaseSoftAll`). See Theme A.

**R-H2 — `identifyContested` per-item RPC** on checkout contention path. See Theme A.

**R-H3 — `collapse_soft_wait_queue_for_session` loops with two `DELETE ... WHERE id =` per waiter.** ([20260526000002_priority_hold_rpcs.sql:294-345](supabase/migrations/20260526000002_priority_hold_rpcs.sql)) **Fix:** convert to set-based `DELETE FROM cart_items WHERE id IN (SELECT cart_item_id ...)` + `DELETE FROM soft_waits WHERE checkout_session_id = $1` after one priority-hold update CTE.

**R-H4 — `useCartRealtime` subscribes to ALL changes on `soft_waits` + `priority_holds`.** See Theme E. Fix: add `filter: 'customer_id=eq.${customerId}'`.

**R-H5 — `SoftWaitNextInLineWatcher` subscribes to entire `soft_waits` table.** See Theme E. Fix: debounced timer-based refetch, or filter on the relevant `checkout_session_id`.

### Medium severity

- **R-M1 — `EXCEPTION WHEN OTHERS THEN RAISE NOTICE` in 14+ RPCs.** See Theme D.
- **R-M2 — `order_items` RLS subquery joins through `orders` and `customers` per row.** ([20260518000001_customers_entity.sql:301-311](supabase/migrations/20260518000001_customers_entity.sql)) Fix: add denormalized `customer_id` on `order_items` with FK + index; policy becomes a single-column lookup.
- **R-M3 — Reapers loop `release_soft` per cart_item.** ([20260601000001_conditional_contention_timer.sql:129-154,182-208](supabase/migrations/20260601000001_conditional_contention_timer.sql), [20260526000003_priority_hold_reaper.sql:125-160,183-216](supabase/migrations/20260526000003_priority_hold_reaper.sql)) Cron-driven so not user-blocking but O(sessions × items) at scale. Fix: aggregate into one UPDATE on `inventory_items` per cleanup batch via a CTE.
- **R-M4 — `reserve_inventory` / `hold_soft` etc. default to SECURITY INVOKER without explicit declaration.** Fine today (callers use service_role) but a future authenticated caller would fail RLS. Fix: explicit `SECURITY DEFINER` + `SET search_path` to match the established pattern.
- **R-M5 — `commit_order_with_lines` is SECURITY DEFINER without explicit permission gate.** ([20260610000012_commit_order_atomically.sql:34-72](supabase/migrations/20260610000012_commit_order_atomically.sql)) Relies on caller being service_role. Fix: `REVOKE EXECUTE FROM public, authenticated`.
- **R-M6 — `collapse_notifications` publication broadcasts every INSERT site-wide before RLS filters.** Acceptable today. Mitigation: Realtime Authorization (`private: true`) per `customer:{id}` topic.

### Low severity

- **R-L1 — `inventory_items` Realtime publication.** Anon browsers receive every inventory mutation before client filtering. Server-side filters on subscriptions mitigate the per-client volume but WAL traffic to Realtime grows with writes. Revisit at >1k SKUs.

---

## Prioritized remediation roadmap

A suggested order of operations. Each phase is roughly a half-day of focused work + testing.

### Phase 1 — The order-placement hot-path overhaul (highest leverage)

1. Build the batch inventory RPCs: `reserve_inventory_batch(p_lines jsonb)`, `hold_soft_batch`, `promote_soft_batch`, `release_soft_batch`, `effective_available_for_many(uuid[])`, `contestable_available_for_variants(uuid[])`.
2. Migrate `reserveAllOrFail`, `holdSoftAllOrFail`, `promoteAllOrFail`, `releaseSoftAll`, `identifyContested` to use them.
3. Migrate the three storefront callers of the per-variant `effective_available_for` (`getEffectiveAvailable`, `getContestableAvailable`, `getWishlist`).
4. Build `fulfill_order_atomic`, `refund_order_atomic`, `delete_order_safe`, `handle_session_completed_atomic` and migrate the corresponding actions/webhooks.

**Wins:** order placement latency drops to ~150ms (from ~600ms+), webhook handler latency drops similarly, partial-state risk on inventory mutations eliminated.

### Phase 2 — Cache correctness

Add the missing `revalidateTag("catalog-facets")` to:
- All inventory mutations (setInventoryLevel, bulkInventoryOps)
- All variant mutations (addVariant, addAxis*, addMatrixCombos, updateVariant, deleteVariant)
- setProductCategories, bulkUpdateProducts, bulkDeleteProducts

Scope back the over-broad invalidations:
- `signOut` from `revalidatePath("/", "layout")` → `revalidatePath("/account")` + `revalidatePath("/admin")`
- All attribute actions: drop `revalidatePath("/admin", "layout")`

**Wins:** customers stop seeing stale OOS badges; admin layout cache stops thrashing.

### Phase 3 — Indexes + admin list pagination

1. Add the composite indexes: `idx_orders_fulfillment_created`, `idx_orders_payment_created`, `idx_order_items_order_variant`, `idx_orders_customer_active`, `idx_wishlist_items_customer`, `idx_audit_action_resource`.
2. Add the partial `idx_inventory_items_soft_held_active`.
3. Add `pg_trgm` + the customer search GIN.
4. Add btree indexes to the unindexed FK columns (cart_items.product_id, order_items.product_id, collapse_notifications.{variant_id,product_id}).
5. Drop the unused `idx_orders_fees_breakdown_gin`.

Convert the JS-pagination admin pages to server-side `range()`:
- /admin/inventory (with a `inventory_with_product_status` view)
- /admin/supply-orders (both views)
- /admin/customers/[id] (with `customer_summary` view)
- /admin/customers (same view)
- /admin/reports/margins (materialized view, nightly refresh)
- /admin/attributes (attribute_usage view)
- /admin/returns

**Wins:** admin pages stay latency-stable beyond 10k records; customer search becomes usable.

### Phase 4 — Realtime tightening + safety

1. Add `.eq()` filters to `useCartRealtime` and `SoftWaitNextInLineWatcher`.
2. Replace the broad `EXCEPTION WHEN OTHERS THEN RAISE NOTICE` catches in 14+ RPCs with typed catches.
3. Convert `update_cart_totals` trigger to STATEMENT-level.
4. Convert `collapse_soft_wait_queue_for_session` loops to set-based DELETEs.
5. Migrate `mergeCustomers` (admin) to use `merge_offline_customer` RPC.
6. Add `REVOKE EXECUTE` to all SECURITY DEFINER RPCs that aren't meant for `authenticated`.

**Wins:** less Realtime traffic per connected client; visible logs of real perf issues (lock waits, serialization failures) that are currently swallowed; admin merge becomes race-safe.

### Phase 5 — Read-path tightening (lower leverage but compounding)

1. `searchVariants` column selection + push pagination/cascade into SQL.
2. `getCatalogFacets` push active-product filter into SQL.
3. `getCart` Promise.all the independent follow-up queries.
4. `getProductBySlug` hoist the post-Promise.all attribute_values fetch.
5. `bulkSetQuantity` single upsert; `addAxisValue/Axis` single bulk insert; `deleteAttributeValue` PG-side existence check.

**Wins:** modest per-page latency win on storefront; the catalog page stops scanning the whole catalog server-side.

---

## What's already in good shape (worth noting)

- **Optimistic locking foundation.** `touch_updated_at` trigger + `expected_updated_at` predicate is wired up on the highest-risk admin actions (orders, customers, products, variants).
- **Atomic RPC primitives.** `commit_order_with_lines`, `merge_offline_customer`, `consume_priority_holds_for_checkout`, `addMatrixCombos` supplier propagation, `merge_offline_customer` advisory lock pattern — these are well-designed and become the templates for Phase 1.
- **Stripe webhook idempotency.** `stripe_events_processed` claim row + delete-on-error pattern is solid.
- **RLS coverage.** All public-data tables have RLS enabled (per the recent outlier-tables migration). The structure is comprehensive.
- **Channel cleanup.** Every Realtime `.subscribe()` site I audited pairs with `removeChannel` in the effect cleanup. No leaks.
- **Type discipline.** The discriminated-union mode='create'|'edit' pattern + Zod schemas at action boundaries + the actions' `Result<T>` envelope catches a lot before it hits production.

The codebase has the right shape. Most of this audit is about applying its own already-proven patterns more consistently.

---

## Appendix — investigation methodology

This audit was synthesized from six parallel investigations:

1. **Storefront read paths** — `src/app/(storefront)/**`, `src/components/features/**`, storefront-facing lib helpers.
2. **Admin read paths** — `src/app/admin/**`, with focus on the heaviest pages (product edit, orders, inventory, supply orders, customers).
3. **Server actions / write paths** — `src/actions/**`, fulfillment + inventory + customer helpers.
4. **Schema + indexes** — 123 migrations in `supabase/migrations/**`, cross-referenced with src/ query patterns.
5. **Caching + invalidation** — `unstable_cache`, `revalidatePath`, `revalidateTag`, `export const dynamic|revalidate` usage across src/.
6. **RPC + RLS + Realtime** — Postgres function definitions, RLS policies, Supabase Realtime subscriptions.

Each investigation produced an independent findings list (severity-sorted, file:line cited). This document is the deduplicated synthesis, with cross-cutting themes lifted out as headline sections.

Findings labels: `S-` (storefront), `A-` (admin), `W-` (write), `SC-` (schema), `C-` (cache), `R-` (rpc/rls/realtime). Within each section, items are sorted HIGH → MED → LOW.
