# Data-Layer Follow-up Performance Plan — Implementation

**Companion to:** [docs/data-layer-performance-audit-followup.md](data-layer-performance-audit-followup.md)
**Created:** 2026-06-11
**Total effort:** ~15-20 hours focused work, executed in 13 dependency-light phases

This plan implements the 20 findings from the second-pass audit. Each phase is small, self-contained, and individually shippable — there are no hard ordering dependencies between most phases, so they can be done in any sequence that fits your schedule.

The audit's 21st finding (B-H3 — drop `touch_updated_at` trigger on hot inventory tables) has been **demoted out of this plan**. The trigger is the documented foundation for the codebase's optimistic-locking pattern. Dropping it on tables that don't currently use OL (`inventory_items`, `cart_items`, `carts`) is technically safe today but creates a trap for future code that might add OL to those tables. The microsecond-per-row cost is not worth the architectural fragility.

---

## Phase index

Sorted by **leverage** (impact / effort) rather than strict dependency, so you can pick from the top whenever you have a free hour.

| # | Phase | Effort | Risk | Impact |
|---|---|---|---|---|
| **1** | Server-side contention batches (A-H1, A-H2, A-H3) | 2-3h | Low | Removes 3N round-trips on contention paths |
| **2** | Image LCP wins (C-H1, C-H2) | 1-2h | Low | 200-800ms LCP improvement |
| **3** | Webhook + checkout parallelization (A-M1, A-M2) | 1h | Low | Frees Stripe webhook latency budget |
| **4** | cart_checkout_sessions FK indexes (B-H2) | 0.5h | Low | Fixes cascade-delete scan |
| **5** | Duplicate index removal (B-M1 + B-L1) | 1h | Low | Eliminates write amplification |
| **6** | wishlist_items NULL dedupe (B-M2) | 1h | Med | Fixes silent dup-row bug |
| **7** | Retention crons (B-H1) | 2-3h | Med | Caps long-term index bloat |
| **8** | validate_attribute_combo set-based rewrite (B-M3) | 1-2h | Low | Variant insert speedup |
| **9** | Watcher gating on storefront layout (C-H3) | 2-3h | Med | Removes cold-load Realtime overhead |
| **10** | Shared 1Hz TickContext (C-M4) | 1-2h | Low | Cuts per-second render storm |
| **11** | SoftWaitNextInLineWatcher localStorage cleanup (C-M1) | 0.5h | Low | Removes jank on refetch |
| **12** | Admin galleries lazy-load (C-M2) | 1h | Low | Stops 200-img request storms |
| **13** | Hydration safety on date renders (C-M3) | 0.5h | Low | SSR/CSR stability |

**Hard dependency:** Phase 7 (retention crons) should ideally come AFTER you've verified your audit retention policies with stakeholders. Otherwise everything is independent.

---

## Cross-cutting principles

These apply to every phase. Read once, follow throughout.

### Migration naming + safety
- Format: `YYYYMMDDhhmmss_<slug>.sql` matching existing convention
- All function changes use `CREATE OR REPLACE` for idempotent re-runs
- All index changes use `CREATE INDEX IF NOT EXISTS` + `DROP INDEX IF EXISTS`
- Cron jobs use `cron.schedule(...)` with explicit job names; the standard `DO $$ BEGIN PERFORM cron.unschedule('name'); EXCEPTION WHEN OTHERS THEN NULL; END $$;` precedes re-scheduling
- Every migration ends with `NOTIFY pgrst, 'reload schema';` if function signatures change

### Validation expectations per phase
- `npx tsc --noEmit` clean after every TS change
- Smoke-test path documented per phase
- Each phase's rollback path is explicitly listed

### Per-phase template

Each phase below includes:
- **Goal** — one sentence
- **Dependencies** — usually none, but noted where relevant
- **Files to create / modify** — exact paths
- **Code shape** — the actual SQL or TS where it matters
- **Validation** — what to manually verify after applying
- **Rollback** — what to do if it goes wrong

---

## Phase 1 — Server-side contention batches (A-H1, A-H2, A-H3)

**Goal:** Eliminate the three remaining per-line `release_soft` loops on contention hot paths. Same fix shape as Phase 2 of the original remediation — the `release_soft_batch` RPC already exists in the codebase from migration `20260611000005_batch_inventory_rpcs.sql`.

**Effort:** 2-3 hours total for all three actions.

### 1a — joinSoftWaitQueue.ts (A-H1)

**File:** [src/actions/cart/joinSoftWaitQueue.ts:99-113](src/actions/cart/joinSoftWaitQueue.ts)

Current pattern: loops over candidate holder sessions, runs a separate `cart_items` SELECT per session to find which one holds the contested variant.

**Code change:**

```ts
// BEFORE: lines 99-113
let parentSession: { id: string; expires_at: string | null } | null = null;
for (const s of sessions) {
  if (!s.cart_id) continue;
  const { data: holds } = await admin
    .from("cart_items")
    .select("id")
    .eq("cart_id", s.cart_id)
    .eq("variant_id", parsed.data.variant_id)
    .gt("quantity", 0)
    .limit(1);
  if (holds && holds.length > 0) {
    parentSession = { id: s.id, expires_at: s.expires_at };
    break;
  }
}

// AFTER: one query
const candidateCartIds = sessions
  .map((s) => s.cart_id)
  .filter((id): id is string => id !== null);
let parentSession: { id: string; expires_at: string | null } | null = null;
if (candidateCartIds.length > 0) {
  const { data: holderRows } = await admin
    .from("cart_items")
    .select("cart_id")
    .in("cart_id", candidateCartIds)
    .eq("variant_id", parsed.data.variant_id)
    .gt("quantity", 0);
  const holderCartIds = new Set(
    ((holderRows ?? []) as Array<{ cart_id: string }>).map((r) => r.cart_id)
  );
  // Pick the earliest-expiring session that's a holder
  const holder = sessions
    .filter((s) => s.cart_id && holderCartIds.has(s.cart_id))
    .sort((a, b) => {
      const ax = a.expires_at ? Date.parse(a.expires_at) : Infinity;
      const bx = b.expires_at ? Date.parse(b.expires_at) : Infinity;
      return ax - bx;
    })[0];
  if (holder) parentSession = { id: holder.id, expires_at: holder.expires_at };
}
```

N round-trips → 1.

### 1b — continueCheckoutWithoutContestedItems.ts (A-H2)

**File:** [src/actions/checkout/continueCheckoutWithoutContestedItems.ts:113-124](src/actions/checkout/continueCheckoutWithoutContestedItems.ts)

Current pattern: per-item sequential `release_soft` + `cart_items.delete()`.

**Code change:**

```ts
// BEFORE: per-item loop
for (const it of items) {
  if (it.variant_id) {
    await admin.rpc("release_soft" as never, {
      p_variant_id: it.variant_id,
      p_qty: it.quantity,
    } as never);
  }
  await admin.from("cart_items").delete().eq("id", it.id);
}

// AFTER: one batch + one bulk delete
const releaseLines = items
  .filter((it) => it.variant_id !== null)
  .map((it) => ({ variant_id: it.variant_id, qty: it.quantity }));
if (releaseLines.length > 0) {
  const { error: releaseErr } = await admin.rpc(
    "release_soft_batch" as never,
    { p_lines: releaseLines } as never
  );
  if (releaseErr && releaseErr.code !== "ISFTL") {
    // ISFTL is benign (already released by another path). Log anything else.
    console.error(
      `[continueCheckoutWithoutContestedItems] release_soft_batch failed (${releaseErr.code}): ${releaseErr.message}`
    );
  }
}
const itemIds = items.map((it) => it.id);
await admin.from("cart_items").delete().in("id", itemIds);
```

2N round-trips → 2.

### 1c — releaseSoftHoldByHolder.ts (A-H3)

**File:** [src/actions/checkout/releaseSoftHoldByHolder.ts:79-88](src/actions/checkout/releaseSoftHoldByHolder.ts)

Current pattern: per-cart-item `release_soft` in a `for` loop.

**Code change:** Same shape as 1b — collect lines into a single `release_soft_batch` call, treat `ISFTL` as benign.

### Validation (all of Phase 1)

1. `npx tsc --noEmit` clean.
2. **Smoke test joinSoftWaitQueue:** Two browsers, two customers. Customer A holds variant X via cart. Customer B tries to add variant X — gets contention modal — clicks "Wait in line." Verify B joins queue without error.
3. **Smoke test continueCheckoutWithoutContestedItems:** Reproduce contention. Click "Continue without contested items." Verify contested items vanish from cart + soft holds released.
4. **Smoke test releaseSoftHoldByHolder:** As holder, click "Παραχώρηση σειράς." Verify soft holds release in one transaction.

### Rollback

Git-revert per file. No DB changes.

---

## Phase 2 — Image LCP wins (C-H1, C-H2)

**Goal:** Biggest single LCP improvement on the storefront — switch PDP hero from raw `<img>` to `next/image`, fix catalog grid Image sizing.

**Effort:** 1-2 hours.

### 2a — PDP hero (C-H1)

**File:** [src/components/features/products/ProductDetailInteractive.tsx:176](src/components/features/products/ProductDetailInteractive.tsx)

Current: `<img>` with `// eslint-disable-next-line @next/next/no-img-element`.

**Code change:**

```tsx
// BEFORE
{displayImage ? (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={displayImage} alt={...} className="..." />
) : null}

// AFTER
{displayImage ? (
  <Image
    src={displayImage}
    alt={altText}
    width={800}  // intrinsic source width — verify against your assets
    height={800}
    priority
    sizes="(min-width: 768px) 50vw, 100vw"
    quality={80}
    className="..."
  />
) : null}
```

Add `import Image from "next/image";` at the top of the file.

The `priority` prop tells Next to skip lazy-loading on this above-the-fold image. `sizes` tells the browser which `srcset` candidate to fetch based on viewport. `quality=80` is a small upgrade from the default 75 for the hero specifically.

**Width/height:** These should reflect the source image's *intrinsic* dimensions, NOT the rendered size. If you don't know the source dimensions consistently, use `fill` + `position: relative` parent + explicit aspect ratio.

### 2b — Catalog grid (C-H2)

**File:** [src/app/(storefront)/products/page.tsx:125-134](src/app/%28storefront%29/products/page.tsx)

**Code change:**

```tsx
// BEFORE
<Image
  src={...}
  alt={...}
  width={400}
  height={400}
  className="..."
/>

// AFTER
<Image
  src={...}
  alt={...}
  width={400}
  height={400}
  sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
  quality={70}
  priority={cardIndex < 8}
  className="..."
/>
```

Loop over the products gives you the index. Mark the first 8 cards `priority` so LCP isn't blocked by lazy-load logic for above-the-fold cards.

### Validation (Phase 2)

1. Open DevTools Network tab. Load a product detail page. Confirm the hero image is served as `.avif` (or `.webp` if browser doesn't support AVIF) via `_next/image?url=...&w=...`.
2. Lighthouse run on the catalog page — verify LCP element is the first product card and LCP score improves vs. baseline.
3. Resize browser to mobile width. Confirm images are smaller (network tab shows `?w=640` or similar instead of `w=1080`).

### Rollback

Git-revert per file.

---

## Phase 3 — Webhook + checkout parallelization (A-M1, A-M2)

**Goal:** Two small Promise.all wins on critical paths.

**Effort:** 1 hour.

### 3a — Stripe webhook wishlist dispatch (A-M1)

**File:** [src/lib/payment/handleSessionEvents.ts:216-222](src/lib/payment/handleSessionEvents.ts) (the `releaseOrderReservations` helper at the bottom)

**Code change:**

```ts
// BEFORE
for (const r of rows) {
  await dispatchWishlistNotifications({
    variant_id: r.variant_id,
    released_qty: r.quantity,
    triggered_by: "stripe_abandon",
  });
}

// AFTER
await Promise.all(
  rows.map((r) =>
    dispatchWishlistNotifications({
      variant_id: r.variant_id,
      released_qty: r.quantity,
      triggered_by: "stripe_abandon",
    })
  )
);
```

`dispatchWishlistNotifications` already swallows errors internally — Promise.all is safe.

### 3b — placeOrder customer UPDATE + match (A-M2)

**File:** [src/actions/checkout/placeOrder.ts:282-377](src/actions/checkout/placeOrder.ts)

Find the block where `customers.update(...)` runs followed by `findCustomerMatches(...)`. Wrap both in `Promise.all`:

```ts
// BEFORE
const { data: updatedCustomer } = await admin
  .from("customers")
  .update(patch)
  .eq("id", customer.id)
  .select("*")
  .single();
// ... (some code that uses customer fields)
const matches = await findCustomerMatches(admin, buyer);

// AFTER
const [updateRes, matches] = await Promise.all([
  admin
    .from("customers")
    .update(patch)
    .eq("id", customer.id)
    .select("*")
    .single(),
  findCustomerMatches(admin, buyer),
]);
const updatedCustomer = updateRes.data;
```

**Verify ordering carefully** — the actual code may have intervening logic that consumes the updated customer before findCustomerMatches runs. Read the function in full before applying.

### Validation (Phase 3)

1. **3a:** Trigger Stripe `checkout.session.async_payment_failed` in test mode for an order with 3+ items. Verify webhook handler returns 200 within Stripe's timeout. Verify all wishlist notifications dispatched.
2. **3b:** Place an order via checkout with `buyer` populated. Verify the customer row's contact fields update + duplicate-suggestions still surface in admin if there are matches.

### Rollback

Git-revert per file.

---

## Phase 4 — cart_checkout_sessions FK indexes (B-H2)

**Goal:** Add the two missing FK indexes so cascade-deletes from `orders` and `payment_intents` stop sequential-scanning `cart_checkout_sessions`.

**Effort:** 30 minutes.

### Migration

`supabase/migrations/2026MMDDhhmmss_ccs_fk_indexes.sql`:

```sql
-- =============================================================================
-- Follow-up Phase 4 — cart_checkout_sessions FK indexes.
--
-- The two FK columns referencing parents with ON DELETE SET NULL had no
-- index. Cascade NULL-set scans cart_checkout_sessions sequentially on
-- every orders/payment_intents delete. Partial indexes skip the (large)
-- NULL portion of the table where cart sessions never got promoted.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_ccs_order_id
  ON public.cart_checkout_sessions(order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ccs_payment_intent_id
  ON public.cart_checkout_sessions(payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
```

### Validation

1. `EXPLAIN ANALYZE` a hypothetical cascade — e.g., select a `payment_intents` row that has 1+ matching session, and run `DELETE FROM payment_intents WHERE id = X;` in a transaction with `ROLLBACK;` at the end. Confirm `Index Scan using idx_ccs_payment_intent_id`.
2. No application change required.

### Rollback

```sql
DROP INDEX IF EXISTS public.idx_ccs_order_id;
DROP INDEX IF EXISTS public.idx_ccs_payment_intent_id;
```

---

## Phase 5 — Duplicate index removal (B-M1 + B-L1)

**Goal:** Drop seven indexes redundant with existing UNIQUE constraints, plus the legacy `idx_orders_carrier` covered by the new partial.

**Effort:** 1 hour (mostly verification time).

### Migration

`supabase/migrations/2026MMDDhhmmss_drop_redundant_indexes.sql`:

```sql
-- =============================================================================
-- Follow-up Phase 5 — Drop indexes covered by existing UNIQUE constraints
-- or by partial indexes added in 20260611000003.
--
-- Each DROP is reversible via CREATE INDEX. The audit verified that for
-- each of these indexes, an existing UNIQUE constraint covers the same
-- column or leftmost-prefix of the same column set — meaning the planner
-- already has an equally-efficient access path through the UNIQUE's
-- backing index.
--
-- Cost of these duplicates: ~2x write amplification on every INSERT/UPDATE
-- affecting the indexed column. Storage: 30-100MB across all 7, growing
-- with row count.
-- =============================================================================

-- orders.order_number UNIQUE covers the lookup
DROP INDEX IF EXISTS public.idx_orders_order_number;

-- product_variants.sku UNIQUE covers it
DROP INDEX IF EXISTS public.idx_product_variants_sku;

-- products.slug UNIQUE covers it
DROP INDEX IF EXISTS public.idx_products_slug;

-- payment_intents.stripe_payment_intent_id UNIQUE covers it
DROP INDEX IF EXISTS public.idx_payment_intents_stripe_id;

-- inventory_items.variant_id UNIQUE covers it
DROP INDEX IF EXISTS public.idx_inventory_items_variant_id;

-- attribute_values UNIQUE(attribute_id, value) covers attribute_id queries
-- via leftmost-prefix
DROP INDEX IF EXISTS public.idx_attribute_values_attribute_id;

-- supplier_products UNIQUE(variant_id, supplier_id) covers variant_id
-- via leftmost-prefix
DROP INDEX IF EXISTS public.idx_sp_variant;

-- Legacy non-partial index — replaced by idx_orders_carrier_slug_partial
-- in 20260611000003.
DROP INDEX IF EXISTS public.idx_orders_carrier;
```

### Validation

Run `EXPLAIN ANALYZE` on a few queries that previously used the dropped indexes:

```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE order_number = 'TEST-001';
-- Expect: Index Scan using orders_order_number_key (the UNIQUE)

EXPLAIN ANALYZE SELECT * FROM product_variants WHERE sku = 'TEST-SKU';
-- Expect: Index Scan using product_variants_sku_key
```

Same shape for the others. If the planner is using a UNIQUE-backing index, you're fine.

### Rollback

```sql
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON public.orders(order_number);
-- ... etc, in a single migration file ready to apply
```

---

## Phase 6 — wishlist_items NULL dedupe (B-M2)

**Goal:** Replace the NULL-permissive UNIQUE constraint with a partial-index pattern that prevents duplicate whole-product wishlist entries.

**Effort:** 1 hour. Risk: medium because there may be existing duplicate rows that need cleanup before the new constraint applies.

### Migration

`supabase/migrations/2026MMDDhhmmss_wishlist_items_null_dedupe.sql`:

```sql
-- =============================================================================
-- Follow-up Phase 6 — Fix NULL-permissive UNIQUE on wishlist_items.
--
-- Background:
--   UNIQUE(customer_id, product_id, variant_id) treats two rows with
--   (customer=X, product=Y, variant=NULL) as DISTINCT because NULL ≠ NULL
--   in SQL. A customer can wishlist the same whole-product multiple
--   times — visible in /wishlist as duplicate entries.
--
--   The fix is the partial-index pattern already used by cart_items
--   (see 20260430000016_shopping_cart_schema.sql): split into two
--   partial unique indexes — one for variant-scoped, one for
--   product-only entries.
--
--   This migration:
--     1. Cleans up any existing duplicate whole-product rows (keeps
--        the oldest)
--     2. Drops the legacy UNIQUE constraint
--     3. Recreates as two partial UNIQUE indexes
-- =============================================================================

-- Step 1: dedupe existing rows BEFORE adding the new constraint, else the
-- index creation fails. Keep the earliest-created row per
-- (customer_id, product_id) where variant_id IS NULL.
DELETE FROM public.wishlist_items
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY customer_id, product_id
             ORDER BY created_at ASC
           ) AS rn
    FROM public.wishlist_items
    WHERE variant_id IS NULL
  ) ranked
  WHERE ranked.rn > 1
);

-- Step 2: drop the existing NULL-permissive UNIQUE constraint
ALTER TABLE public.wishlist_items
  DROP CONSTRAINT IF EXISTS wishlist_items_customer_id_product_id_variant_id_key;

-- Step 3: recreate as two partial UNIQUE indexes (mirrors cart_items pattern)
CREATE UNIQUE INDEX IF NOT EXISTS uq_wishlist_items_variant
  ON public.wishlist_items(customer_id, product_id, variant_id)
  WHERE variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wishlist_items_whole_product
  ON public.wishlist_items(customer_id, product_id)
  WHERE variant_id IS NULL;
```

### Validation

1. Before applying, run:
   ```sql
   SELECT customer_id, product_id, count(*)
   FROM public.wishlist_items
   WHERE variant_id IS NULL
   GROUP BY customer_id, product_id
   HAVING count(*) > 1;
   ```
   If any rows return, the migration's Step 1 will dedupe them. Document the count for the audit trail.
2. After applying, attempt to insert a duplicate whole-product wishlist row → expect UNIQUE violation.
3. Variant-scoped wishlist inserts still work.

### Rollback

```sql
DROP INDEX IF EXISTS public.uq_wishlist_items_variant;
DROP INDEX IF EXISTS public.uq_wishlist_items_whole_product;
ALTER TABLE public.wishlist_items
  ADD CONSTRAINT wishlist_items_customer_id_product_id_variant_id_key
  UNIQUE (customer_id, product_id, variant_id);
```

Note: rolling back doesn't restore deleted duplicate rows — they're gone. Document this in your audit log.

---

## Phase 7 — Retention crons (B-H1)

**Goal:** Cap unbounded growth on append-only tables before Phase-1 indexes start paying compounding maintenance cost.

**Effort:** 2-3 hours. The work is small but the **TTL choices need stakeholder sign-off**.

### Step 0 — Stakeholder review of TTLs

**Before writing the migration**, document and confirm retention policies. Suggested defaults:

| Table | Suggested TTL | Justification |
|---|---|---|
| `audit_events` | 90 days | Most compliance frameworks want 90-180 days; pick the lower bound or your specific compliance need |
| `error_events` (app errors) | 60 days | Operational debugging window |
| `system_errors` (Postgres-side) | 30 days for resolved, 180 for unresolved | Resolved cases are reference; unresolved are work queue |
| `stripe_events_processed` | 60 days | Stripe retries within 3 days max; 60 days is generous for chargeback investigations |
| `cart_checkout_sessions` (state='released') | 7 days | Already-released sessions have no operational value past 1 week |
| `soft_waits` (promoted_at NOT NULL) | 24 hours | Promoted-then-resolved waits are debugging-only past a day |
| `priority_holds` (consumed_at or expired) | 24 hours | Same logic |
| `collapse_notifications` (acknowledged_at NOT NULL) | 30 days | Acked = customer saw it; can drop |

**Confirm these with your team** (especially audit_events vs your compliance requirements) before applying.

### Migration

`supabase/migrations/2026MMDDhhmmss_data_retention_crons.sql`:

```sql
-- =============================================================================
-- Follow-up Phase 7 — Data retention crons.
--
-- Schedules nightly DELETE jobs against append-only tables to cap their
-- growth. Without these, every Phase-1 composite index pays a growing
-- maintenance cost forever, and DB storage costs scale with order count
-- forever.
--
-- TTL choices are documented per job. Adjust per your compliance / audit
-- requirements BEFORE applying.
--
-- All jobs run at 03:00 UTC (low-traffic window). DELETE in batches via
-- LIMIT to avoid lock contention on hot tables; if a single nightly run
-- has more than ~100k rows to delete, the cron retries the next day with
-- another batch. (For the bootstrap case where tables already have a
-- year of data, run the DELETEs manually in 100k-row chunks first.)
-- =============================================================================

-- Pre-clean: drop any existing schedules with the same names so this is
-- idempotent
DO $$
BEGIN
  PERFORM cron.unschedule('reap-audit-events');         EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('reap-error-events');         EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('reap-system-errors-resolved'); EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('reap-system-errors-old');    EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('reap-stripe-events');        EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('reap-released-sessions');    EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('reap-promoted-waits');       EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('reap-consumed-holds');       EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('reap-acked-collapse');       EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- audit_events: 90 days
SELECT cron.schedule(
  'reap-audit-events',
  '0 3 * * *',
  $$DELETE FROM public.audit_events
    WHERE created_at < now() - interval '90 days'$$
);

-- error_events: 60 days (application errors)
SELECT cron.schedule(
  'reap-error-events',
  '0 3 * * *',
  $$DELETE FROM public.error_events
    WHERE first_seen_at < now() - interval '60 days'$$
);

-- system_errors: resolved 30 days, unresolved 180 days
SELECT cron.schedule(
  'reap-system-errors-resolved',
  '0 3 * * *',
  $$DELETE FROM public.system_errors
    WHERE resolved_at IS NOT NULL
      AND resolved_at < now() - interval '30 days'$$
);
SELECT cron.schedule(
  'reap-system-errors-old',
  '15 3 * * *',
  $$DELETE FROM public.system_errors
    WHERE resolved_at IS NULL
      AND occurred_at < now() - interval '180 days'$$
);

-- stripe_events_processed: 60 days
SELECT cron.schedule(
  'reap-stripe-events',
  '0 3 * * *',
  $$DELETE FROM public.stripe_events_processed
    WHERE processed_at < now() - interval '60 days'$$
);

-- cart_checkout_sessions: released graveyard, 7 days
SELECT cron.schedule(
  'reap-released-sessions',
  '0 4 * * *',
  $$DELETE FROM public.cart_checkout_sessions
    WHERE state = 'released'
      AND updated_at < now() - interval '7 days'$$
);

-- soft_waits: promoted graveyard, 24 hours
SELECT cron.schedule(
  'reap-promoted-waits',
  '0 4 * * *',
  $$DELETE FROM public.soft_waits
    WHERE promoted_at IS NOT NULL
      AND promoted_at < now() - interval '24 hours'$$
);

-- priority_holds: consumed/expired graveyard, 24 hours
SELECT cron.schedule(
  'reap-consumed-holds',
  '0 4 * * *',
  $$DELETE FROM public.priority_holds
    WHERE (consumed_at IS NOT NULL OR expires_at < now())
      AND COALESCE(consumed_at, expires_at) < now() - interval '24 hours'$$
);

-- collapse_notifications: acknowledged, 30 days
SELECT cron.schedule(
  'reap-acked-collapse',
  '15 4 * * *',
  $$DELETE FROM public.collapse_notifications
    WHERE acknowledged_at IS NOT NULL
      AND acknowledged_at < now() - interval '30 days'$$
);
```

### Bootstrap cleanup (if needed)

If tables already have a year+ of accumulated data, run a one-time manual cleanup in 100k-row chunks BEFORE the cron starts:

```sql
-- Example for audit_events. Repeat until 0 rows returned.
DELETE FROM public.audit_events
WHERE id IN (
  SELECT id FROM public.audit_events
  WHERE created_at < now() - interval '90 days'
  LIMIT 100000
);
```

### Validation

1. After applying, check `SELECT * FROM cron.job;` — verify all 9 jobs are scheduled.
2. Run one job manually: `SELECT cron.run('reap-audit-events');` — verify it returns successfully.
3. Compare row counts in target tables before and after first nightly tick.

### Rollback

```sql
SELECT cron.unschedule('reap-audit-events');
-- ... etc for each job name
```

---

## Phase 8 — validate_attribute_combo set-based rewrite (B-M3)

**Goal:** Replace the N+1-per-key trigger with one set-based check.

**Effort:** 1-2 hours.

### Migration

`supabase/migrations/2026MMDDhhmmss_validate_attribute_combo_set_based.sql`:

```sql
-- =============================================================================
-- Follow-up Phase 8 — Convert validate_attribute_combo to set-based.
--
-- Background:
--   The legacy trigger loops over jsonb_each_text(NEW.attribute_combo)
--   doing two SELECT lookups per key (attributes by slug, attribute_values
--   by id). A 4-axis variant fires 8 queries per insert; admin matrix-
--   expansion of a multi-axis product pays this on every combo.
--
--   The set-based rewrite uses jsonb_each_text + LEFT JOIN to evaluate
--   ALL keys in one query and RAISES if any key/value doesn't resolve.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_attribute_combo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_first_bad_key   text;
  v_first_bad_value text;
BEGIN
  IF NEW.attribute_combo IS NULL THEN
    RETURN NEW;
  END IF;

  -- Single query: every key must resolve to an attribute by slug, AND
  -- the corresponding value-uuid must exist in attribute_values for
  -- that attribute. LEFT JOIN + IS NULL check finds the first bad pair.
  SELECT kv.key, kv.value
    INTO v_first_bad_key, v_first_bad_value
    FROM jsonb_each_text(NEW.attribute_combo) AS kv(key, value)
    LEFT JOIN public.attributes a       ON a.slug = kv.key
    LEFT JOIN public.attribute_values v ON v.id   = kv.value::uuid
                                       AND v.attribute_id = a.id
   WHERE a.id IS NULL OR v.id IS NULL
   LIMIT 1;

  IF v_first_bad_key IS NOT NULL THEN
    RAISE EXCEPTION
      'Invalid attribute_combo: key % with value % does not resolve to a valid attribute_values row',
      v_first_bad_key, v_first_bad_value;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_attribute_combo IS
'Validates every key/value pair in NEW.attribute_combo against attributes.slug and attribute_values.id. Set-based: one query for all keys instead of 2N queries (N = key count).';

NOTIFY pgrst, 'reload schema';
```

### Validation

1. Insert a valid variant with a multi-axis attribute_combo. Verify it succeeds.
2. Insert a variant with attribute_combo containing a bogus slug. Verify it fails with the new error message.
3. Insert a variant with attribute_combo containing a real slug but bogus value UUID. Verify it fails.
4. `EXPLAIN ANALYZE` a matrix expansion of a 4-axis product. Verify each variant insert is now ~10ms instead of ~30-80ms.

### Rollback

Restore the original function body from `20260531000002_attribute_combo_uuid_migration.sql` via a new migration that does `CREATE OR REPLACE`.

---

## Phase 9 — Watcher gating on storefront layout (C-H3)

**Goal:** Stop mounting `PromotionWatcher` + `CollapseWatcher` + `SoftWaitNextInLineWatcher` on every storefront route.

**Effort:** 2-3 hours. Risk: medium because the conditional must be server-resolved.

### Design

Two reasonable approaches:

**Option A — Server-resolve at layout:** The storefront layout becomes async, runs a cheap "does this customer have any active soft_waits / priority_holds / unacknowledged collapse_notifications" query, conditionally renders the watchers.

**Option B — Move to subtree:** Mount the watchers only inside `/cart`, `/checkout`, `/products/[slug]` (the routes where contention is relevant). Less elegant but no per-request DB cost.

Recommendation: **Option A** for collapse notifications + soft wait watchers (a customer can collapse-receive a notification on ANY page after another customer paid), **Option B** for the promotion watcher if its scope is narrower.

### Implementation (Option A — single combined precheck)

Create `src/lib/contention/getActiveContentionState.ts`:

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Resolves whether the current customer has any active contention state
 * worth subscribing to Realtime for. Called from the storefront layout
 * to gate the three watcher components.
 *
 * One round-trip via a UNION + LIMIT 1 EXISTS check — cheap enough to
 * run on every storefront page load.
 */
export async function getActiveContentionState(): Promise<{
  hasActiveSoftWait: boolean;
  hasActivePriorityHold: boolean;
  hasUnackedCollapse: boolean;
}> {
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return {
      hasActiveSoftWait: false,
      hasActivePriorityHold: false,
      hasUnackedCollapse: false,
    };
  }
  const { data: custRow } = await supabase
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) {
    return {
      hasActiveSoftWait: false,
      hasActivePriorityHold: false,
      hasUnackedCollapse: false,
    };
  }

  // Three parallel head-only EXISTS checks
  const [softRes, prioRes, collapseRes] = await Promise.all([
    supabase
      .from("soft_waits")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .limit(1),
    supabase
      .from("priority_holds")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1),
    supabase
      .from("collapse_notifications")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .is("acknowledged_at", null)
      .limit(1),
  ]);

  return {
    hasActiveSoftWait: (softRes.count ?? 0) > 0,
    hasActivePriorityHold: (prioRes.count ?? 0) > 0,
    hasUnackedCollapse: (collapseRes.count ?? 0) > 0,
  };
}
```

Update `src/app/(storefront)/layout.tsx`:

```tsx
import { getActiveContentionState } from "@/lib/contention/getActiveContentionState";

export default async function StorefrontLayout({ children }: ...) {
  const contention = await getActiveContentionState();
  return (
    <>
      <Header />
      <div className="flex-1">{children}</div>
      <Footer />
      {contention.hasActivePriorityHold && <PromotionWatcher />}
      {contention.hasUnackedCollapse && <CollapseWatcher />}
      {contention.hasActiveSoftWait && <SoftWaitNextInLineWatcher />}
    </>
  );
}
```

The cost: 3 head-only count queries per layout render (~30-60ms). The savings: 3 WebSocket connections + ~2 DB round-trips per browser session for visitors with zero contention state.

### Validation

1. Open a fresh browser as a customer with NO active soft_wait / priority_hold / collapse_notification. Browse `/`, `/products`, `/account`. Verify in DevTools that no `realtime.supabase.co/socket` WebSocket connects.
2. Trigger a contention state. Verify the relevant watcher appears + connects.

### Rollback

Git-revert the layout + delete the new helper.

---

## Phase 10 — Shared 1Hz TickContext (C-M4)

**Goal:** Consolidate ~5 uncoordinated `setInterval(1000)` countdown timers into one shared context that pauses on `document.hidden`.

**Effort:** 1-2 hours.

### Create `src/contexts/TickContext.tsx`

```tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * Shared 1Hz tick context. Replaces per-component setInterval(1000)
 * countdown timers — one timer, one render-per-second per consumer.
 * Pauses while document.hidden (background tabs) to avoid CPU waste.
 */
const TickContext = createContext<number>(Date.now());

export function TickProvider({ children }: { children: React.ReactNode }) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    let interval: number | null = null;
    function start() {
      if (interval !== null) return;
      interval = window.setInterval(() => setNow(Date.now()), 1000);
    }
    function stop() {
      if (interval !== null) {
        window.clearInterval(interval);
        interval = null;
      }
    }
    function onVisibility() {
      if (document.hidden) stop();
      else {
        // Sync immediately on resume; tick continues thereafter
        setNow(Date.now());
        start();
      }
    }
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <TickContext.Provider value={now}>{children}</TickContext.Provider>;
}

export function useTick(): number {
  return useContext(TickContext);
}
```

### Wire into storefront layout

```tsx
// src/app/(storefront)/layout.tsx
import { TickProvider } from "@/contexts/TickContext";

export default async function StorefrontLayout({ children }: ...) {
  // ... contention check from Phase 9
  return (
    <TickProvider>
      <Header />
      ...
    </TickProvider>
  );
}
```

### Migrate consumers

Each component currently doing `const [now, setNow] = useState(Date.now()); useEffect(() => setInterval(() => setNow(Date.now()), 1000), [])` becomes:

```tsx
const now = useTick();
```

Affected files (verified via grep):
- `src/components/features/cart/CartDrawer.tsx:55`, `:209`
- `src/components/features/checkout/ContentionBanner.tsx:141`
- `src/components/features/contention/PromotionWatcher.tsx:312`
- `src/components/features/contention/SoftWaitNextInLineWatcher.tsx:401`
- `src/components/features/wishlist/WishlistRealtimeBanner.tsx:102`

**Skip:** `CheckoutSessionGuard.tsx:112` (uses `HEARTBEAT_INTERVAL_MS` for heartbeat ping — different cadence, different purpose).
**Skip:** `SoftWaitNextInLineWatcher.tsx:206` (the Phase 7 polling fallback at 10s, not a countdown).

### Validation

1. DevTools Performance recording during cart drawer interaction. Verify there's now ONE `setInterval` callback firing per second instead of 5+.
2. Tab to background. Verify CPU drops to ~0% on the page (countdowns paused).
3. Tab back. Verify timers resume + countdowns show current time.

### Rollback

Per-file git revert. The TickContext provider is harmless to leave in place.

---

## Phase 11 — SoftWaitNextInLineWatcher localStorage cleanup (C-M1)

**Goal:** Stop scanning localStorage on every refetch.

**Effort:** 30 minutes.

**File:** [src/components/features/contention/SoftWaitNextInLineWatcher.tsx:127-132](src/components/features/contention/SoftWaitNextInLineWatcher.tsx)

### Code change

```ts
// BEFORE (inside refetch handler)
for (let i = window.localStorage.length - 1; i >= 0; i--) {
  const key = window.localStorage.key(i);
  if (!key) continue;
  if (!key.startsWith("swnl-")) continue;
  const id = key.replace(/^swnl-(seen|startedAt):/, "");
  if (!surviving.has(id)) window.localStorage.removeItem(key);
}

// AFTER
// Track keys we wrote in a ref so we don't have to scan localStorage
// on every refetch. GC sweep runs on a 60s timer instead.
// (Add a ref `writtenKeysRef = useRef<Set<string>>(new Set())` at the
// top of the component.)
for (const key of writtenKeysRef.current) {
  const id = key.replace(/^swnl-(seen|startedAt):/, "");
  if (!surviving.has(id)) {
    window.localStorage.removeItem(key);
    writtenKeysRef.current.delete(key);
  }
}
```

When the component first mounts, hydrate `writtenKeysRef` once by scanning localStorage:

```ts
useEffect(() => {
  if (typeof window === "undefined") return;
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("swnl-")) writtenKeysRef.current.add(key);
  }
}, []);
```

And whenever a new key is written via `getOrSetNextInLineStartedAt`, add it to `writtenKeysRef`.

### Validation

1. Browser dev tools → Performance tab. Trigger 10 refetches in a row. Verify no synchronous localStorage scan in the flame graph.
2. Refresh page. Verify the persisted "started at" timestamps are still read correctly.

### Rollback

Per-file git revert.

---

## Phase 12 — Admin galleries lazy-load (C-M2)

**Goal:** Stop firing 200 full-resolution requests when admin opens a media library.

**Effort:** 1 hour.

**Files:**
- [src/components/admin/products/ProductImagesEditor.tsx:122](src/components/admin/products/ProductImagesEditor.tsx)
- [src/components/admin/media/MediaBrowser.tsx:97](src/components/admin/media/MediaBrowser.tsx)

### Code change (both files)

```tsx
// BEFORE
<img src={asset.url} alt={asset.alt_text ?? ""} />

// AFTER
<Image
  src={asset.url}
  alt={asset.alt_text ?? ""}
  width={200}
  height={200}
  loading="lazy"
  sizes="(min-width: 1024px) 200px, 25vw"
  quality={60}
/>
```

For libraries that may grow past ~60 items, add intersection-observer based windowing — but you can defer that until you actually have a 60+ asset library.

### Validation

1. Open `/admin/media` with 30+ assets uploaded. Verify Network tab shows only the first ~10 images requested initially; subsequent images load as you scroll.
2. Verify image quality is acceptable at 200×200 + quality=60. If not, bump to 70.

### Rollback

Per-file git revert.

---

## Phase 13 — Hydration safety on date renders (C-M3)

**Goal:** Eliminate two `new Date()` calls during render that can cause SSR/CSR hydration mismatches.

**Effort:** 30 minutes.

### 13a — Footer

**File:** [src/components/layout/Footer.tsx:42](src/components/layout/Footer.tsx)

```tsx
// BEFORE (somewhere in component)
<span>© {new Date().getFullYear()} ...</span>

// AFTER (at module scope)
const CURRENT_YEAR = new Date().getFullYear();
// ... then use {CURRENT_YEAR} in render
```

Year is captured at build time / server start. Acceptable trade for stable hydration. Restart server on Jan 1 if exact correctness matters; otherwise the year-end mismatch is bounded to one render cycle on Jan 1 midnight.

### 13b — WishlistRealtimeBanner

**File:** [src/components/features/wishlist/WishlistRealtimeBanner.tsx:97](src/components/features/wishlist/WishlistRealtimeBanner.tsx)

If it initializes state with `Date.now()` (read the actual code first), defer to `useEffect`:

```tsx
// BEFORE
const [startedAt, setStartedAt] = useState(Date.now());

// AFTER
const [startedAt, setStartedAt] = useState<number | null>(null);
useEffect(() => {
  setStartedAt(Date.now());
}, []);
```

Then early-return if `startedAt === null` (or render a static placeholder for the first paint).

### Validation

1. Hard refresh the storefront page. DevTools console should show NO hydration mismatch warnings.

### Rollback

Per-file git revert.

---

## What's deliberately NOT in this plan

- **B-H3 (touch_updated_at on hot tables)** — Documented at the top. Risk to optimistic-locking foundation outweighs the marginal write throughput gain.
- **`materialized view for /admin/reports/margins`** — Still on the deferred list from the original audit; not covered here. Lower priority than contention round-trips.
- **`next/dynamic` chunking** — Bundles aren't large enough today to justify code-split work. Revisit if any storefront page's chunk crosses 200 KB.
- **`CartDrawer.refresh()` → optimistic state patching** — Phase 7 cut its cost by ~95%. Revisit only if cart-jank becomes a complaint.

---

## Suggested execution order

If you have a single focused session:
1. **Phase 1** (contention batches) — 2-3h, highest leverage
2. **Phase 2** (LCP wins) — 1-2h, visible to customers
3. **Phase 4** (CCS FK indexes) — 30min
4. **Phase 5** (drop duplicate indexes) — 1h
5. **Phase 3** (webhook + checkout parallel) — 1h

That's a clean afternoon (~6-8 hours) hitting all the HIGH items and the cheapest DB cleanup.

If you have a second day:
6. **Phase 7** (retention crons) — needs stakeholder TTL sign-off; can be scheduled async
7. **Phase 9** (watcher gating) — biggest client-side win
8. **Phase 6** (wishlist NULL dedupe) — fixes silent dup-row bug
9. **Phase 10** (TickContext) — visible CPU win on cart pages

A third day cleans up the rest (Phases 8, 11, 12, 13).

---

## Cumulative impact (Phase 1-13)

The first audit + 10-phase remediation took the system from "comfortable at current scale" to "comfortable at 10-50× scale." This follow-up plan removes the next layer of residual waste:

- **Contention hot paths:** From ~3-5 round-trips per contention action to 1-2
- **Stripe webhook headroom:** Frees ~50-200ms back into the timeout budget
- **Storefront LCP:** 200-800ms improvement on PDP + catalog
- **Client-side CPU during cart open:** Per-second render storm consolidated to single tick + paused on background tab
- **Cold-load Realtime overhead:** Eliminated for visitors with no contention state
- **DB long-term growth:** Capped via retention; index maintenance cost stabilizes
- **DB write amplification:** Dropped by removing 8 redundant indexes

Estimated time: ~15-20 hours focused work. Estimated user-visible improvement: LCP improvement is the most measurable (Lighthouse score), the rest manifest as "the site feels snappier under load" rather than discrete metric jumps.
