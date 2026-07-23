# Data-Layer Remediation: Implementation Plan

**Companion to:** `docs/data-layer-performance-audit.md`
**Created:** 2026-06-10
**Estimated total effort:** ~25-35 hours of focused engineering, executed in 11 dependency-ordered phases.

This document is the execution playbook for applying every finding in the performance audit. Each phase is self-contained: it lists the migrations to create, the code files to touch, the validation strategy, the rollback plan, and the dependencies on earlier phases.

---

## ⚠️ Critical security context discovered during planning

While investigating function signatures for the new batch RPCs, the audit surfaced **existing privilege-escalation gaps** that MUST be fixed in Phase 0 before any new SECURITY DEFINER function lands. Without this baseline, the new batch RPCs would inherit the same gap and we'd be compounding the problem.

**The existing critical issues (any authenticated user can call these today):**

| Function | What goes wrong if called by a non-admin | Severity |
|---|---|---|
| `grant_role_by_email` | Self-grant `admin` role to any account | **CRITICAL** — full privilege escalation |
| `grant_admin_by_email` | Same | **CRITICAL** |
| `revoke_role_by_email` | Lock out the real admin | **CRITICAL** |
| `mint_mfa_enrollment_token` | Mint MFA token for any user if pepper is known | **HIGH** |
| `commit_order_with_lines` | Insert arbitrary orders under any customer_id | **HIGH** |
| `merge_offline_customer` | Move orders + delete customer rows | **HIGH** |
| `increment_inventory` | Inflate stock arbitrarily | **HIGH** |
| `hold_soft`, `release_soft`, `reserve_inventory`, `release_reservation`, `promote_soft_to_reserved`, `consume_reservation`, `restore_inventory`, `decrement_inventory`, `release_priority`, `promote_to_priority`, `consume_priority_to_soft` | Move other shoppers' inventory buckets by id | **HIGH** |
| `log_audit_event` | Spoof audit rows under any actor identity | **MED** |

These weren't in the original perf audit scope, but **Phase 0 below addresses them**. The fixes are mechanical (`REVOKE EXECUTE FROM public, anon, authenticated; GRANT EXECUTE TO service_role`) and add internal `has_permission` gates for defence in depth.

---

## Cross-cutting principles

These apply to every phase. Read once, follow throughout.

### Migration naming
- Format: `YYYYMMDDhhmmss_<descriptive_slug>.sql` matching the existing convention.
- All migrations include `NOTIFY pgrst, 'reload schema';` at the bottom when they change function signatures or table shapes.
- All `CREATE FUNCTION` statements use `CREATE OR REPLACE` for idempotent re-runs.

### Function safety convention (apply to every new SECURITY DEFINER function)

```sql
CREATE OR REPLACE FUNCTION public.my_new_func(...)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ ... $$;

COMMENT ON FUNCTION public.my_new_func(...) IS '...';

-- ALWAYS revoke + grant explicitly. PostgreSQL's PUBLIC default would
-- otherwise let any authenticated user call the function.
REVOKE EXECUTE ON FUNCTION public.my_new_func(...) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_new_func(...) TO service_role;
```

### Additive-first, removal-last
- New batch RPCs are added alongside existing per-row RPCs. They do not replace them.
- Callers in JS are migrated one at a time. After all callers are migrated, an explicit cleanup phase can drop the old per-row RPCs.
- This makes every migration trivially reversible.

### Custom SQLSTATE codes (defined once in Phase 1, used everywhere)
Five 5-character codes for typed catches:
- `ISFTL` — INSUFFICIENT_SOFT_HELD
- `IRSRV` — INSUFFICIENT_RESERVED
- `IINVT` — INSUFFICIENT_INVENTORY
- `IPRIO` — INSUFFICIENT_PRIORITY_HELD
- `INVQT` — INVALID_QUANTITY

Functions raise `RAISE EXCEPTION USING ERRCODE = 'ISFTL', MESSAGE = '...'`. Callers catch via `WHEN SQLSTATE 'ISFTL'`. SQLERRM message is preserved so legacy log scrapes still work.

### Validation expectations per phase
- **Migration safety:** Each migration is `CREATE OR REPLACE` or `CREATE ... IF NOT EXISTS` so re-runs are no-ops.
- **Type-check:** `npx tsc --noEmit` clean after every TS file change.
- **Smoke test:** Each phase includes specific manual smoke-test paths (no automated DB test framework in repo).
- **Rollback drill:** Every phase lists what to do if it goes wrong. Most are git-revert-able.

### Phase dependency graph

```
Phase 0  (Security baseline + observability table)
   │
Phase 1  (Indexes + custom SQLSTATEs)
   │
Phase 2  (Batch inventory RPCs + storefront read path)  ← HIGHEST LEVERAGE
   ├──► Phase 3  (Atomic order operations — depends on Phase 2 batch RPCs)
   │
Phase 4  (Cache invalidation — independent of Phase 2-3, can parallelize)
Phase 5  (Admin views + pagination — independent)
Phase 6  (pg_trgm customer search — independent)
Phase 7  (Realtime filtering — independent)
   │
Phase 8  (Pgsql safety hardening — depends on Phase 1 SQLSTATEs)
Phase 9  (Read-path polishing — independent)
Phase 10 (Monitoring surface — depends on Phase 8's typed catches)
```

Phases 4, 5, 6, 7, 9 can each be done by a different person in parallel after Phase 2 lands. Phase 3 is the only one that strictly depends on Phase 2 finishing first. Phase 10 closes the loop on Phase 8's observability.

---

## Phase 0 — Security baseline + observability primitives

**Goal:** Close the existing privilege-escalation gaps + create the infrastructure that later phases depend on.

**Dependencies:** none.

**Estimated effort:** 1-2 hours.

### Migrations

#### `2026MMDDhhmmss_revoke_unsafe_function_execute.sql`

Single migration that revokes anonymous/authenticated EXECUTE on every unsafe function discovered:

```sql
-- ──── Critical: RBAC bootstrap functions ───────────────────────────
-- These were intended as superuser/admin-only setup but never had
-- their EXECUTE grant scoped. Any authenticated user can currently
-- call them and self-grant the 'admin' role.
REVOKE EXECUTE ON FUNCTION public.grant_role_by_email(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_admin_by_email(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_role_by_email(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_role_by_email(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_admin_by_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_role_by_email(text, text) TO service_role;

-- ──── Inventory primitives ─────────────────────────────────────────
-- Caller-supplied (variant_id, qty) lets any authenticated user move
-- other shoppers' soft/priority/available buckets.
REVOKE EXECUTE ON FUNCTION public.hold_soft(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_soft(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_inventory(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_reservation(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.promote_soft_to_reserved(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_reservation(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.restore_inventory(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_inventory(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_inventory(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_priority(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.promote_to_priority(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_priority_to_soft(uuid, integer) FROM PUBLIC, anon, authenticated;
-- Grant back to service_role for the admin client
GRANT EXECUTE ON FUNCTION public.hold_soft(uuid, integer) TO service_role;
-- (repeat GRANT for each — abbreviated for brevity in this doc)

-- ──── Order + customer commit RPCs ─────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.commit_order_with_lines(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.merge_offline_customer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_order_with_lines(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_offline_customer(uuid, uuid) TO service_role;

-- ──── MFA + audit + customer reapers ───────────────────────────────
REVOKE EXECUTE ON FUNCTION public.mint_mfa_enrollment_token(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_audit_event(...) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reap_orphaned_anon_customers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mint_mfa_enrollment_token(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_audit_event(...) TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_orphaned_anon_customers() TO service_role;

NOTIFY pgrst, 'reload schema';
```

#### `2026MMDDhhmmss_system_errors_table.sql`

Defense-in-depth observability surface for typed catches added in Phase 8 + 10:

```sql
CREATE TABLE IF NOT EXISTS public.system_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,           -- 'reap_stale_soft_sessions', 'fulfill_order_atomic', etc.
  severity text NOT NULL CHECK (severity IN ('info','warn','error','critical')),
  entity_kind text,                -- 'variant', 'order', 'customer', etc.
  entity_id uuid,
  sqlstate text NOT NULL,
  sqlerrm text NOT NULL,
  metadata jsonb,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.user_profiles(id)
);

CREATE INDEX idx_system_errors_occurred ON public.system_errors(occurred_at DESC);
CREATE INDEX idx_system_errors_source_occurred ON public.system_errors(source, occurred_at DESC);
CREATE INDEX idx_system_errors_unresolved ON public.system_errors(occurred_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.system_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read system errors" ON public.system_errors
  FOR SELECT USING (public.has_permission('view:audit_log'));
-- Writes only through SECURITY DEFINER helper below (no INSERT policy = service_role only)
```

Insert helper used by Phase 8's typed-catch functions:

```sql
CREATE OR REPLACE FUNCTION public.log_system_error(
  p_source text,
  p_severity text,
  p_sqlstate text,
  p_sqlerrm text,
  p_entity_kind text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.system_errors (source, severity, sqlstate, sqlerrm, entity_kind, entity_id, metadata)
  VALUES (p_source, p_severity, p_sqlstate, p_sqlerrm, p_entity_kind, p_entity_id, p_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  -- Logging must never break the caller. Worst case: the error is lost
  -- but the original operation succeeds.
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.log_system_error(text, text, text, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_system_error(text, text, text, text, text, uuid, jsonb) TO service_role;
```

### Code changes

None. This phase is DB-only.

### Validation

After applying:

1. **Smoke test the user-facing flows** — every flow currently uses `createAdminClient` (service_role), so all of these REVOKEs should be no-ops for the legitimate paths:
   - Place an order → expect success
   - Refund an order → expect success
   - Soft-hold a cart item → expect success
   - MFA enrollment flow → expect success
   - Customer merge via admin → expect success

2. **Verify the REVOKEs took effect** — try calling one of the REVOKEd functions with an `anon` Supabase client:
   ```ts
   const anon = createAnonClient();
   const { error } = await anon.rpc("grant_admin_by_email", { p_email: "test@example.com" });
   // Expect error: "permission denied for function grant_admin_by_email"
   ```

3. **Confirm `system_errors` table exists** with the index set + RLS policy.

### Rollback

If any flow breaks (shouldn't — service_role retains EXECUTE):

```sql
GRANT EXECUTE ON FUNCTION public.<broken_func>(...) TO authenticated;
```

Selectively roll back per function.

---

## Phase 1 — Postgres infrastructure (indexes + custom SQLSTATE codes)

**Goal:** Lay down all the missing indexes from the schema audit + document the custom SQLSTATE codes that later phases will use. No code changes — pure DB-side wins.

**Dependencies:** Phase 0.

**Estimated effort:** 1.5 hours migration + 30min EXPLAIN verification.

### Migrations

#### `2026MMDDhhmmss_perf_indexes_phase1.sql`

```sql
-- Composite indexes for /admin/orders filtered list (audit SC-H3)
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_created
  ON public.orders(fulfillment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_created
  ON public.orders(payment_status, created_at DESC);

-- effective_available_for hot path (audit SC-H1)
CREATE INDEX IF NOT EXISTS idx_order_items_order_variant
  ON public.order_items(order_id, variant_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_active
  ON public.orders(customer_id)
  WHERE payment_status = 'pending';

-- Partial: reconcile_orphan_soft_held reaper hot path (audit SC-H4)
CREATE INDEX IF NOT EXISTS idx_inventory_items_soft_held_active
  ON public.inventory_items(variant_id)
  WHERE quantity_soft_held > 0;

-- Wishlist hot read (audit SC-M2)
CREATE INDEX IF NOT EXISTS idx_wishlist_items_customer_created
  ON public.wishlist_items(customer_id, created_at DESC);

-- Audit log hot query (audit SC-M4)
CREATE INDEX IF NOT EXISTS idx_audit_action_resource_created
  ON public.audit_events(action, resource_type, resource_id, created_at DESC);

-- Missing FK indexes (audit SC-M3)
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id
  ON public.cart_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id
  ON public.order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_collapse_notifications_variant_id
  ON public.collapse_notifications(variant_id);
CREATE INDEX IF NOT EXISTS idx_collapse_notifications_product_id
  ON public.collapse_notifications(product_id);

-- Partial: orders.carrier_slug only non-null on shipped orders (audit SC-L2)
DROP INDEX IF EXISTS public.idx_orders_carrier_slug;
CREATE INDEX idx_orders_carrier_slug_partial
  ON public.orders(carrier_slug)
  WHERE carrier_slug IS NOT NULL;

-- Drop the unused GIN on orders.fees_breakdown (audit SC-M5).
-- No query in src/ uses @> or ? operators on this column; the GIN is
-- pure write-time overhead.
DROP INDEX IF EXISTS public.idx_orders_fees_breakdown_gin;

NOTIFY pgrst, 'reload schema';
```

#### `2026MMDDhhmmss_custom_sqlstate_documentation.sql`

This migration adds a comment-only function whose entire purpose is to document the custom SQLSTATE codes used in Phase 2+. It does nothing at runtime; it exists so that anyone running `\df+ public.*sqlstate*` in psql sees the canonical reference.

```sql
CREATE OR REPLACE FUNCTION public._documentation_custom_sqlstates()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- This function exists only to host the documentation comment below.
  -- It is never called. See COMMENT ON FUNCTION.
  RAISE NOTICE 'See COMMENT ON FUNCTION for the canonical SQLSTATE map.';
END $$;

COMMENT ON FUNCTION public._documentation_custom_sqlstates() IS
'Canonical map of custom SQLSTATE codes used by this codebase. Use these via:
    RAISE EXCEPTION USING ERRCODE = ''ISFTL'', MESSAGE = ''INSUFFICIENT_SOFT_HELD'';
And catch with:
    WHEN SQLSTATE ''ISFTL'' THEN ...

Codes (5 chars, first char must NOT be 0-4 or P0..XX which are reserved):
  ISFTL — INSUFFICIENT_SOFT_HELD (release_soft, soft_to_reserved)
  IRSRV — INSUFFICIENT_RESERVED (release_reservation, consume_reservation)
  IINVT — INSUFFICIENT_INVENTORY (hold_soft, reserve_inventory, decrement_inventory)
  IPRIO — INSUFFICIENT_PRIORITY_HELD (release_priority, consume_priority)
  INVQT — INVALID_QUANTITY (qty <= 0 on any inventory primitive)';
```

### Code changes

None.

### Validation

Run EXPLAIN against the queries the new indexes target, before and after:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, order_number, total
FROM orders
WHERE fulfillment_status = 'shipped'
ORDER BY created_at DESC
LIMIT 30 OFFSET 0;
```

Expect an `Index Scan using idx_orders_fulfillment_created`. Should drop from ~200ms to <20ms at realistic order counts.

### Rollback

```sql
DROP INDEX IF EXISTS public.idx_orders_fulfillment_created;
-- ... etc
```

---

## Phase 2 — Inventory batch RPCs + storefront read-path migration

**The highest-leverage phase.** Replaces all per-line RPC loops with batched ones; replaces per-variant availability reads with batch reads.

**Goal:** Compress order placement + storefront reads from O(N) round-trips to O(1).

**Dependencies:** Phase 0 (security baseline), Phase 1 (SQLSTATE codes).

**Estimated effort:** 4-6 hours.

### Migrations

#### `2026MMDDhhmmss_batch_inventory_rpcs.sql`

Six new batch RPCs. Each takes a `jsonb` array of `{variant_id, qty}` pairs, processes them all in a single PL/pgSQL transaction, and returns a structured result.

Canonical shape (all six follow the same pattern):

```sql
CREATE OR REPLACE FUNCTION public.hold_soft_batch(p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line       jsonb;
  v_variant_id uuid;
  v_qty        integer;
  v_processed  integer := 0;
  v_count      integer;
BEGIN
  -- Validate input shape upfront so we fail fast.
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT', MESSAGE = 'p_lines must be a non-null jsonb array';
  END IF;
  v_count := jsonb_array_length(p_lines);
  IF v_count = 0 THEN
    -- Zero lines is a valid no-op; just return ok.
    RETURN jsonb_build_object('ok', true, 'processed', 0);
  END IF;

  -- Loop in PL/pgSQL — wrapped in the function's implicit transaction.
  -- Any RAISE EXCEPTION from a per-line UPDATE rolls back the whole
  -- batch. The JS-layer compensating-rollback pattern is gone.
  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_variant_id := (v_line ->> 'variant_id')::uuid;
    v_qty := (v_line ->> 'qty')::integer;

    IF v_qty <= 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'INVQT',
        MESSAGE = format('Invalid qty=%s for variant %s at index %s', v_qty, v_variant_id, v_processed);
    END IF;

    -- Same row-level UPDATE as the existing single-row hold_soft.
    -- If quantity_available < v_qty, NOT FOUND fires and we raise.
    UPDATE public.inventory_items
       SET quantity_available = quantity_available - v_qty,
           quantity_soft_held = quantity_soft_held + v_qty,
           updated_at = now()
     WHERE variant_id = v_variant_id
       AND quantity_available >= v_qty;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'IINVT',
        MESSAGE = format(
          'INSUFFICIENT_INVENTORY for variant %s (requested %s) at index %s',
          v_variant_id, v_qty, v_processed
        );
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', v_processed);
END $$;

COMMENT ON FUNCTION public.hold_soft_batch(jsonb) IS
'Atomic batch soft-hold. Accepts jsonb array of {variant_id, qty}. All lines succeed or all roll back. Raises SQLSTATE INVQT (invalid qty) or IINVT (insufficient inventory) with the failed index in the message.';

REVOKE EXECUTE ON FUNCTION public.hold_soft_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_soft_batch(jsonb) TO service_role;
```

The same shape for the other five — each replicates the existing single-row RPC's UPDATE statement and SQLSTATE raise:

- `release_soft_batch(p_lines jsonb)` — raises `ISFTL` on insufficient soft-held
- `reserve_inventory_batch(p_lines jsonb)` — raises `IINVT`
- `release_reservation_batch(p_lines jsonb)` — raises `IRSRV`
- `promote_soft_to_reserved_batch(p_lines jsonb)` — raises `ISFTL`
- `restore_inventory_batch(p_lines jsonb)` — no insufficient check (additive)

Note: we explicitly are NOT creating `consume_reservation_batch` here — it's only ever called inside `fulfill_order_atomic` (Phase 3) which handles its own loop internally.

#### `2026MMDDhhmmss_batch_availability_rpcs.sql`

Set-based replacements for the per-variant availability functions:

```sql
CREATE OR REPLACE FUNCTION public.effective_available_for_many(
  p_variant_ids uuid[],
  p_viewer_id   uuid DEFAULT NULL
)
RETURNS TABLE(variant_id uuid, qty integer)
LANGUAGE plpgsql
STABLE  -- Note: we deliberately drop the inline cleanup side-effect
        -- for the batch variant. Cleanup runs from the cron + the
        -- per-variant function still does it. The batch variant is a
        -- read-only optimisation.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT i.variant_id, i.quantity_available
    FROM public.inventory_items i
    WHERE i.variant_id = ANY(p_variant_ids)
  ),
  -- Viewer's own soft contributions (so they see what they reserved come back)
  own_soft AS (
    SELECT ci.variant_id, sum(ci.quantity)::integer AS qty
    FROM public.cart_checkout_sessions s
    JOIN public.carts c        ON c.id = s.cart_id
    JOIN public.cart_items ci  ON ci.cart_id = c.id
    WHERE s.state IN ('soft','hard')
      AND p_viewer_id IS NOT NULL
      AND c.customer_id = p_viewer_id
      AND ci.variant_id = ANY(p_variant_ids)
    GROUP BY ci.variant_id
  ),
  -- Viewer's active priority holds
  own_prio AS (
    SELECT ph.variant_id, sum(ph.quantity)::integer AS qty
    FROM public.priority_holds ph
    WHERE p_viewer_id IS NOT NULL
      AND ph.customer_id = p_viewer_id
      AND ph.consumed_at IS NULL
      AND ph.expires_at > now()
      AND ph.variant_id = ANY(p_variant_ids)
    GROUP BY ph.variant_id
  ),
  -- Viewer's in-flight orders (pending payment, not yet consumed)
  own_pending AS (
    SELECT oi.variant_id, sum(oi.quantity)::integer AS qty
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE p_viewer_id IS NOT NULL
      AND o.customer_id = p_viewer_id
      AND o.payment_status = 'pending'
      AND oi.variant_id = ANY(p_variant_ids)
    GROUP BY oi.variant_id
  )
  SELECT
    b.variant_id,
    GREATEST(
      b.quantity_available
        + COALESCE(os.qty, 0)
        + COALESCE(op.qty, 0)
        + COALESCE(opd.qty, 0),
      0
    )::integer AS qty
  FROM base b
  LEFT JOIN own_soft    os  ON os.variant_id  = b.variant_id
  LEFT JOIN own_prio    op  ON op.variant_id  = b.variant_id
  LEFT JOIN own_pending opd ON opd.variant_id = b.variant_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.effective_available_for_many(uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effective_available_for_many(uuid[], uuid) TO service_role;
```

```sql
CREATE OR REPLACE FUNCTION public.contestable_available_for_many(
  p_variant_ids uuid[]
)
RETURNS TABLE(variant_id uuid, qty integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT i.variant_id,
         (i.quantity_available + i.quantity_soft_held + COALESCE(ph.priority_qty, 0))::integer AS qty
  FROM public.inventory_items i
  LEFT JOIN (
    SELECT ph.variant_id, sum(ph.quantity)::integer AS priority_qty
    FROM public.priority_holds ph
    WHERE ph.consumed_at IS NULL
      AND ph.expires_at > now()
      AND ph.variant_id = ANY(p_variant_ids)
    GROUP BY ph.variant_id
  ) ph ON ph.variant_id = i.variant_id
  WHERE i.variant_id = ANY(p_variant_ids);
END $$;

REVOKE EXECUTE ON FUNCTION public.contestable_available_for_many(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contestable_available_for_many(uuid[]) TO service_role;
```

### Code changes

Each JS caller migrates its per-line loop to a single RPC call. The wrapper function signatures stay the same so downstream callers (placeOrder, refundOrder, etc.) don't need to know.

**A. `src/lib/inventory/holdSoftAllOrFail.ts`** (entire rewrite of internals):

```ts
export async function holdSoftAllOrFail(items: HoldLine[]): Promise<Result<void>> {
  if (items.length === 0) return ok(undefined);
  const admin = createAdminClient();
  const { error } = await admin.rpc("hold_soft_batch", {
    p_lines: items.map((i) => ({ variant_id: i.variantId, qty: i.qty })),
  });
  if (error) {
    if (error.code === "IINVT") return fail("INSUFFICIENT_INVENTORY", "INSUFFICIENT_INVENTORY");
    if (error.code === "INVQT") return fail("INVALID_QUANTITY", "INVALID_QUANTITY");
    return fail(error.message, error.code);
  }
  return ok(undefined);
}
```

The JS-layer compensating-rollback block is GONE (the Postgres transaction handles it). Net: ~50 lines removed per file.

**B–F. Same shape for:**
- `src/lib/inventory/reserveAllOrFail.ts` → `reserve_inventory_batch`
- `src/lib/inventory/promoteAllOrFail.ts` → `promote_soft_to_reserved_batch`
- `src/lib/inventory/releaseSoftAll.ts` → `release_soft_batch`
- Any `releaseAllReservations` / `restoreInventoryForOrder` helper → `release_reservation_batch` / `restore_inventory_batch`

**G. `src/lib/inventory/getEffectiveAvailable.ts`** (the read-path version):

```ts
export async function getEffectiveAvailableForVariants(
  variantIds: string[],
  viewerId: string | null
): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("effective_available_for_many", {
    p_variant_ids: variantIds,
    p_viewer_id: viewerId,
  });
  if (error || !data) return new Map();
  return new Map((data as Array<{variant_id: string; qty: number}>).map(r => [r.variant_id, r.qty]));
}
```

**H.** `src/lib/inventory/getContestableAvailable.ts` — same shape but uses `contestable_available_for_many`.

**I.** `src/lib/wishlist/getWishlist.ts:152-158`:
- Collect all variant_ids first
- Single call to `getEffectiveAvailableForVariants`
- Map result back into the wishlist items

**J.** `src/actions/checkout/startCheckoutSession.ts:276-303` (`identifyContested`):
- Replace per-line `await admin.rpc("effective_available_for", ...)` with one `getEffectiveAvailableForVariants` call

### Validation

1. **Type-check clean.** Run `npx tsc --noEmit`.

2. **Cart smoke test** with 5-item cart:
   - Add 5 different variants to cart, confirm soft-holds applied.
   - Force one variant to be over-requested (manually set qty in DB low), retry add — confirm error + NO partial state.
   - Place order — confirm 5 promote_soft_to_reserved + commit happen in expected ~250ms (was ~600-1000ms).

3. **Product detail page response time** in browser dev tools:
   - 10-variant product → page render should drop from ~600-1200ms to ~110-160ms.

4. **Wishlist page** with 8 items → loads in one batch, not 8 sequential RPCs.

5. **Webhook handler latency** (next phase improves this further, but verify no regression):
   - Trigger Stripe webhook in test mode → confirm faster handling.

### Rollback

Each migrated JS file is a single-commit diff. To roll back:

```bash
git revert <commit-hash>
```

The old per-row RPCs still exist in the DB; the batch ones can stay (no harm). The system falls back to the old N-round-trip path.

---

## Phase 3 — Atomic order operations

**Goal:** Eliminate multi-step write sequences in fulfill / refund / delete / webhook-handler paths. Use the batch RPCs from Phase 2 + a small set of new orchestrator RPCs.

**Dependencies:** Phase 2 (batch inventory RPCs).

**Estimated effort:** 4-6 hours.

### Migrations

#### `2026MMDDhhmmss_fulfill_order_atomic.sql`

```sql
CREATE OR REPLACE FUNCTION public.fulfill_order_atomic(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row    public.orders%ROWTYPE;
  v_item   public.order_items%ROWTYPE;
  v_wac    record;
  v_count  integer := 0;
BEGIN
  -- Load + validate order eligibility (same checks fulfillOrder.ts did in JS)
  SELECT * INTO v_row FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ORDER_NOT_FOUND';
  END IF;
  IF v_row.fulfillment_status IN ('preparing','shipped','ready_for_pickup','delivered','picked_up') THEN
    -- Idempotent: already past inventory-decrement step
    RETURN jsonb_build_object('ok', true, 'already_fulfilled', true);
  END IF;
  IF v_row.payment_method <> 'stripe' OR v_row.payment_status <> 'paid' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'BAD_STATE';
  END IF;

  -- Loop items in PG. Each variant: consume reservation, snapshot cost.
  -- Single transaction — any failure rolls back the whole order.
  FOR v_item IN
    SELECT * FROM public.order_items WHERE order_id = p_order_id AND variant_id IS NOT NULL
  LOOP
    -- Consume from reserved bucket
    UPDATE public.inventory_items
       SET quantity_reserved = quantity_reserved - v_item.quantity,
           updated_at = now()
     WHERE variant_id = v_item.variant_id
       AND quantity_reserved >= v_item.quantity;
    IF NOT FOUND THEN
      -- Fallback for pre-Phase-1 orders that decremented directly
      UPDATE public.inventory_items
         SET quantity_available = quantity_available - v_item.quantity,
             updated_at = now()
       WHERE variant_id = v_item.variant_id
         AND quantity_available >= v_item.quantity;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'IRSRV', MESSAGE = format('INSUFFICIENT_RESERVED for variant %s', v_item.variant_id);
      END IF;
    END IF;

    -- Snapshot unit_cost_at_sale (strict currency mode — see fulfillOrder.ts comment)
    IF v_item.unit_cost_at_sale IS NULL THEN
      SELECT * INTO v_wac FROM public.get_weighted_average_cost(v_item.variant_id, v_row.currency) LIMIT 1;
      IF v_wac.reason IS NULL AND v_wac.avg_cost IS NOT NULL THEN
        UPDATE public.order_items
           SET unit_cost_at_sale = v_wac.avg_cost,
               unit_cost_at_sale_currency = v_wac.currency
         WHERE id = v_item.id;
      END IF;
    END IF;
    v_count := v_count + 1;
  END LOOP;

  -- Flip the order status
  UPDATE public.orders
     SET fulfillment_status = 'preparing',
         updated_at = now()
   WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'items_consumed', v_count, 'order_id', p_order_id);
END $$;

REVOKE EXECUTE ON FUNCTION public.fulfill_order_atomic(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_order_atomic(uuid) TO service_role;
```

Note: this assumes `get_weighted_average_cost` already exists as a SQL function (it currently exists as a TS helper in `src/lib/suppliers/getWeightedAverageCost.ts`). If not, port it to SQL as part of this migration — it's a self-contained aggregation.

#### `2026MMDDhhmmss_refund_order_atomic.sql`

Similar shape: validates eligibility, loops order_items doing restore_inventory (only for stripe + not-shipped path), flips payment_status='refunded' + transitions fulfillment_status. Audit log entry is created server-side via `log_audit_event`.

#### `2026MMDDhhmmss_delete_order_safe.sql`

```sql
CREATE OR REPLACE FUNCTION public.delete_order_safe(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row    public.orders%ROWTYPE;
  v_item   public.order_items%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ORDER_NOT_FOUND';
  END IF;

  -- Reverse whatever inventory effect this order had, based on its
  -- current state. The JS logic in deleteOrder.ts had branching
  -- (released vs restored vs cancelled-no-op); same branching here
  -- but inside one transaction.
  FOR v_item IN
    SELECT * FROM public.order_items WHERE order_id = p_order_id AND variant_id IS NOT NULL
  LOOP
    IF v_row.fulfillment_status IN ('pending','confirmed','preparing') AND v_row.payment_status <> 'refunded' THEN
      -- Reservation existed → release back to available
      UPDATE public.inventory_items
         SET quantity_available = quantity_available + v_item.quantity,
             quantity_reserved = GREATEST(quantity_reserved - v_item.quantity, 0),
             updated_at = now()
       WHERE variant_id = v_item.variant_id;
    ELSIF v_row.fulfillment_status IN ('shipped','delivered','picked_up') THEN
      -- Already consumed → restore (give back to available, nothing in reserved)
      UPDATE public.inventory_items
         SET quantity_available = quantity_available + v_item.quantity,
             updated_at = now()
       WHERE variant_id = v_item.variant_id;
    END IF;
    -- Other states (cancelled/refunded): inventory already reconciled, no-op
  END LOOP;

  -- The actual DELETE — order_items CASCADE-deletes via FK
  DELETE FROM public.orders WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id);
END $$;

REVOKE EXECUTE ON FUNCTION public.delete_order_safe(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_order_safe(uuid) TO service_role;
```

#### `2026MMDDhhmmss_handle_session_completed_atomic.sql`

```sql
CREATE OR REPLACE FUNCTION public.handle_session_completed_atomic(
  p_session_id text,
  p_provider   text,
  p_amount_minor integer,
  p_event_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_intent      public.payment_intents%ROWTYPE;
  v_order_id    uuid;
BEGIN
  -- Find the payment_intent + order
  SELECT * INTO v_intent FROM public.payment_intents WHERE provider_session_id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_INTENT_NOT_FOUND';
  END IF;
  v_order_id := v_intent.order_id;

  -- Update payment_intents → completed
  UPDATE public.payment_intents
     SET status = 'completed',
         updated_at = now()
   WHERE id = v_intent.id;

  -- Update orders: payment_status='paid', fulfillment stays 'pending'
  -- until fulfill_order_atomic runs (called separately by the webhook
  -- handler after this completes).
  UPDATE public.orders
     SET payment_status = 'paid',
         updated_at = now()
   WHERE id = v_order_id
     AND payment_status = 'pending';

  -- Mark the cart_checkout_session as 'completed'
  UPDATE public.cart_checkout_sessions
     SET state = 'completed',
         updated_at = now()
   WHERE order_id = v_order_id;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id);
END $$;

REVOKE EXECUTE ON FUNCTION public.handle_session_completed_atomic(text, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_session_completed_atomic(text, text, integer, jsonb) TO service_role;
```

### Code changes

**A. `src/lib/fulfillment/fulfillOrder.ts`** — strip the 100-line orchestration:

```ts
export async function fulfillOrder(input: { orderId: string }): Promise<Result<{ orderId: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail("Invalid input", "INVALID_INPUT");
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fulfill_order_atomic", { p_order_id: parsed.data.orderId });
  if (error) {
    if (error.message === "ORDER_NOT_FOUND") return fail("Order not found", "ORDER_NOT_FOUND");
    if (error.message === "BAD_STATE") return fail("Cannot fulfill from current state", "BAD_STATE");
    return fail(error.message, error.code);
  }
  // Side effects that aren't part of the atomic txn (best-effort)
  await sendFulfillmentEmail(parsed.data.orderId);
  await logAuditEvent({ action: "order.fulfilled", resource_type: "order", resource_id: parsed.data.orderId, actor_type: "system" });
  return ok({ orderId: parsed.data.orderId });
}
```

**B.** `src/actions/orders/refundOrder.ts` — same shape using `refund_order_atomic`.

**C.** `src/actions/orders/deleteOrder.ts` — same shape using `delete_order_safe`.

**D.** `src/lib/payment/handleSessionEvents.ts` — `handle_session_completed_atomic` + invoke `fulfillOrder` after.

**E.** `src/actions/orders/transitionOrderStatus.ts` — replace per-item RPC loop with the batched RPCs from Phase 2 (`reserve_inventory_batch`, `release_reservation_batch`, etc.). The status-transition outer logic stays; only the inventory bit gets batched.

**F.** `src/actions/orders/createOrder.ts` — use `commit_order_with_lines` (already exists) + `reserve_inventory_batch` (new in Phase 2). Audit W-H5.

**G.** `src/actions/customers/mergeCustomers.ts` — switch to the existing `merge_offline_customer` RPC. Audit W-M4.

### Validation

For each migrated action, run a focused smoke test:

1. **fulfillOrder** — pay a test order via Stripe, verify webhook → status flips to 'preparing' + inventory.quantity_reserved decremented.
2. **refundOrder** — refund a paid order, verify payment_status='refunded' + inventory restored.
3. **deleteOrder** — delete a pending order, verify inventory.quantity_available restored.
4. **handleSessionEvents** — trigger checkout.session.completed in Stripe test mode, verify response under 100ms.
5. **transitionOrderStatus** — cancel a confirmed order, verify all reservations release atomically.
6. **mergeCustomers admin path** — merge two test customers from admin UI, verify orders + addresses moved + source deleted.

### Rollback

Same pattern as Phase 2: each JS file is git-revert-able. The new RPCs in DB can stay.

---

## Phase 4 — Cache invalidation correctness

**Goal:** Fix the storefront seeing stale data after admin mutations + scope back over-broad invalidations.

**Dependencies:** None — can ship in parallel with Phase 2-3.

**Estimated effort:** 2-3 hours.

### Code changes (no migrations)

**A. Add `revalidateTag("catalog-facets")` to inventory + variant mutations:**

| File | Line | Change |
|---|---|---|
| `src/actions/inventory/setInventoryLevel.ts` | 103-105 | Add `revalidateTag("catalog-facets")` |
| `src/actions/inventory/bulkInventoryOps.ts` | 89, 143, 195 | Add to each of the 3 sites |
| `src/actions/variants/addVariant.ts` | 71 | Add |
| `src/actions/variants/addAxisToProduct.ts` | 189 | Add |
| `src/actions/variants/addAxisValueToProduct.ts` | 190 | Add |
| `src/actions/variants/addMatrixCombos.ts` | 287 | Add |
| `src/actions/variants/updateVariant.ts` | 65-67 | Add |
| `src/actions/variants/deleteVariant.ts` | 67-71 | Add |
| `src/actions/products/setProductCategories.ts` | 45 | Add + `revalidatePath("/products")` + `revalidateTag("categories")` |

**B. Add storefront path revalidations to variant ops:**

For each variant add/axis action (`addVariant`, `addAxisToProduct`, `addAxisValueToProduct`, `addMatrixCombos`):
```ts
revalidatePath("/products");
revalidatePath(`/products/${productSlug}`);
```

**C. Scope back overly-broad invalidations:**

`src/actions/auth/signOut.ts:84` — change:
```ts
- revalidatePath("/", "layout");
+ revalidatePath("/account");
+ revalidatePath("/admin");
```

Every attribute action (7 files) — remove the layout-level admin bust:
```ts
- revalidatePath("/admin", "layout");
  revalidatePath("/admin/attributes");
  revalidateTag("catalog-facets");  // (already there)
```

**D. Raise `getCatalogFacets` TTL to 24h** since tag busting now comprehensively covers it ([src/lib/site-search/getCatalogFacets.ts:346](src/lib/site-search/getCatalogFacets.ts)):
```ts
{ revalidate: 86400, tags: ["catalog-facets"] }
```

**E. Wrap `searchVariants` in `unstable_cache`** so filtered-URL catalog pages are also invalidated by tag ([src/lib/site-search/searchVariants.ts](src/lib/site-search/searchVariants.ts)):
```ts
const searchVariantsCached = unstable_cache(
  async (params) => /* the search body */,
  ["search-variants"],
  { revalidate: 60, tags: ["catalog-facets", "products"] }
);
```

Add `revalidateTag("products")` to product mutations that change product-row content.

**F. Add `placeOrder` invalidations:**

`src/actions/checkout/placeOrder.ts:895-896` — add:
```ts
revalidatePath("/admin/inventory");
revalidatePath("/admin/orders");
```

**G. Add `attributes` tag for cached attribute lookups:**

Wrap `attributes` + `attribute_values` lookups on product detail page in `unstable_cache` with `tags: ["attributes"]`. Bust on every attribute mutation.

### Validation

1. Open `/products` in one tab.
2. In another tab, run admin: set inventory of a product to 0.
3. Hard-refresh `/products` — confirm OOS badge appears immediately (vs. up-to-5-min stale before).
4. Same for variant creation: add a new color to a product, verify catalog updates.
5. Verify sign-out doesn't bust everything: storefront product pages stay cached after a sign-out event.

### Rollback

Git-revert per file.

---

## Phase 5 — Admin views + list pagination

**Goal:** Stop fetching whole tables to paginate in JS.

**Dependencies:** Phase 1 (indexes — particularly the composite indexes on orders + audit_events).

**Estimated effort:** 6-8 hours.

### Migrations

#### `2026MMDDhhmmss_admin_views.sql`

Four views that aggregate in SQL what admin pages currently aggregate in JS:

```sql
-- customer_summary: per-customer aggregates for the customers list +
-- the customer detail header. Replaces the JS loop that loads every
-- order per customer just to compute count + sum + last_order_at.
CREATE OR REPLACE VIEW public.customer_summary AS
SELECT
  c.id              AS customer_id,
  c.email,
  c.first_name,
  c.last_name,
  c.phone,
  c.auth_user_id,
  c.created_at,
  COALESCE(o.order_count, 0)         AS order_count,
  COALESCE(o.lifetime_value_minor, 0) AS lifetime_value_minor,
  o.last_order_at,
  o.last_order_currency
FROM public.customers c
LEFT JOIN (
  SELECT
    customer_id,
    count(*)                                              AS order_count,
    sum(total * 100)::integer                             AS lifetime_value_minor,
    max(created_at)                                       AS last_order_at,
    (array_agg(currency ORDER BY created_at DESC))[1]     AS last_order_currency
  FROM public.orders
  WHERE payment_status IN ('paid','refunded')
  GROUP BY customer_id
) o ON o.customer_id = c.id;

-- inventory_with_product_status: inventory_items joined to product
-- active/category/supplier metadata for /admin/inventory's filter UI.
-- Replaces the MAX_FETCH=2000 + JS-filter hack.
CREATE OR REPLACE VIEW public.inventory_with_product_status AS
SELECT
  inv.variant_id,
  inv.quantity_available,
  inv.quantity_reserved,
  inv.quantity_soft_held,
  inv.low_stock_threshold,
  v.sku,
  v.price,
  v.is_active                AS variant_active,
  v.attribute_combo,
  p.id                       AS product_id,
  p.name                     AS product_name,
  p.slug                     AS product_slug,
  p.active                   AS product_active,
  p.default_supplier_id,
  (SELECT array_agg(pc.category_id) FROM public.product_categories pc WHERE pc.product_id = p.id) AS category_ids,
  CASE
    WHEN inv.quantity_available <= 0 THEN 'out'
    WHEN inv.quantity_available <= inv.low_stock_threshold THEN 'low'
    ELSE 'ok'
  END AS stock_status
FROM public.inventory_items inv
JOIN public.product_variants v ON v.id = inv.variant_id
JOIN public.products p          ON p.id = v.product_id;

-- product_stock_rollup: per-product totals for /admin/products list.
-- Replaces JS-side stock filter (which currently produces wrong page
-- totals because filter runs AFTER pagination).
CREATE OR REPLACE VIEW public.product_stock_rollup AS
SELECT
  v.product_id,
  count(v.id)                                        AS variant_count,
  COALESCE(sum(inv.quantity_available), 0)::integer  AS total_available,
  COALESCE(sum(inv.quantity_reserved), 0)::integer   AS total_reserved,
  count(*) FILTER (WHERE inv.quantity_available <= 0) AS oos_variant_count
FROM public.product_variants v
LEFT JOIN public.inventory_items inv ON inv.variant_id = v.id
GROUP BY v.product_id;

-- attribute_usage: which attributes are in use anywhere, and how.
-- Replaces /admin/attributes scanning every variant.attribute_combo +
-- every spec.
CREATE OR REPLACE VIEW public.attribute_usage AS
SELECT
  a.id AS attribute_id,
  a.name,
  a.slug,
  EXISTS (
    SELECT 1 FROM public.product_variants v
    WHERE v.attribute_combo ? a.slug
  ) AS is_variant_axis,
  EXISTS (
    SELECT 1 FROM public.product_specifications ps
    WHERE ps.attribute_id = a.id
  ) AS is_spec,
  (
    SELECT count(*) FROM public.attribute_values av WHERE av.attribute_id = a.id
  ) AS value_count
FROM public.attributes a;

NOTIFY pgrst, 'reload schema';
```

#### `2026MMDDhhmmss_product_margins_mv.sql`

Materialized view + refresh schedule for the margin report:

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS public.product_margins_mv AS
SELECT
  p.id AS product_id,
  p.name,
  p.slug,
  p.base_price,
  p.currency,
  p.vat_rate_id,
  COALESCE(vr.rate, 0)            AS vat_rate,
  -- Effective cost: explicit preferred supplier cost > fallback
  COALESCE(
    (SELECT sp.unit_cost FROM public.supplier_products sp
      JOIN public.product_variants v ON v.id = sp.variant_id
      WHERE v.product_id = p.id AND sp.is_preferred LIMIT 1),
    p.cost_price
  )                                AS effective_cost,
  -- Margin computed at MV-build time
  (p.base_price / (1 + COALESCE(vr.rate, 0))) - COALESCE(...)  AS margin_amount
FROM public.products p
LEFT JOIN public.vat_rates vr ON vr.id = p.vat_rate_id
WHERE p.active = true;

CREATE UNIQUE INDEX product_margins_mv_pk ON public.product_margins_mv(product_id);
CREATE INDEX product_margins_mv_margin ON public.product_margins_mv(margin_amount DESC);

-- Refresh once nightly via pg_cron
SELECT cron.schedule(
  'refresh-product-margins',
  '0 3 * * *',  -- 03:00 daily
  'REFRESH MATERIALIZED VIEW CONCURRENTLY public.product_margins_mv'
);
```

### Code changes

For each affected admin page, replace the JS-aggregation/JS-pagination path with view-backed `.range()`:

**A. `src/app/admin/inventory/page.tsx`** — drop `MAX_FETCH=2000`, switch to:
```ts
const { data, count } = await admin
  .from("inventory_with_product_status")
  .select("*", { count: "exact" })
  .eq(filterColumn, filterValue) // server-side filter
  .range(from, to)
  .order("product_name");
```

**B. `src/app/admin/supply-orders/page.tsx`** — drafts view: replace per-supplier loop with `.in('id', supplierIdsWithoutDraft)`. Tracking view: 4 parallel `head: true, count: 'exact'` queries for badge counts + range-paginated query for the visible page.

**C. `src/app/admin/customers/page.tsx`** — query `customer_summary` view directly; drop the JS aggregation loop.

**D. `src/app/admin/customers/[id]/page.tsx`** — same, plus paginate the orders table via `.range()`.

**E. `src/app/admin/reports/margins/page.tsx`** — read from `product_margins_mv` instead of in-JS aggregation.

**F. `src/app/admin/attributes/page.tsx`** — query `attribute_usage` view.

**G. `src/app/admin/returns/page.tsx`** — add status filter + range pagination.

**H. `src/app/admin/products/page.tsx`** — use `product_stock_rollup` view; push stock filter into SQL.

**I. `src/app/admin/orders/page.tsx`** — `Promise.all` the delivery_carriers + orders fetches.

**J. `src/app/admin/orders/[id]/page.tsx`** — include `delivery_carriers(...)` in the orders embed; capabilities becomes pure transform.

**K. `src/app/admin/page.tsx`** — collect the 4 stat queries into a single `Promise.all` array.

### Validation

For each migrated page:
1. Verify the visible row count matches the pre-migration result on small data.
2. Stress-test with seeded data: e.g. seed 10k orders + verify /admin/orders pagination stays sub-100ms.
3. Verify filter counts on /admin/inventory match across all stock_status filters.

### Rollback

Each admin page is a single-file change. Views can stay (no harm). Git-revert per page.

---

## Phase 6 — Customer search trigram

**Goal:** Make customer search usable at >5k customers.

**Dependencies:** none.

**Estimated effort:** 1-2 hours.

### Migrations

#### `2026MMDDhhmmss_customer_search_trigram.sql`

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index on customer searchable columns. Trigram approach handles
-- leading-wildcard ILIKE (%X%) which the existing
-- idx_customers_email_phone_normalized cannot. Stem of the audit
-- finding SC-M1.
CREATE INDEX IF NOT EXISTS idx_customers_search_trgm
  ON public.customers
  USING gin (
    coalesce(email,'') gin_trgm_ops,
    coalesce(first_name,'') gin_trgm_ops,
    coalesce(last_name,'') gin_trgm_ops,
    coalesce(phone,'') gin_trgm_ops
  );

NOTIFY pgrst, 'reload schema';
```

### Code changes

**A. `src/actions/orders/searchCustomers.ts`** — the leading-wildcard ILIKE pattern stays the same in SQL terms (`%X%`), but with the GIN index Postgres now uses the trigram lookup. Verify via EXPLAIN. No code change actually required — the indexing alone delivers the win.

If a tighter form is wanted, expose a new RPC `search_customers(q text, limit int)` returning a ranked list using `similarity()` operator. This is optional polish.

### Validation

1. EXPLAIN ANALYZE the search query before + after — expect `Bitmap Heap Scan using idx_customers_search_trgm`.
2. Seed 5000 test customers + search → verify response time drops from ~500-2000ms to ~10-50ms.

### Rollback

```sql
DROP INDEX IF EXISTS public.idx_customers_search_trgm;
-- pg_trgm extension can stay
```

---

## Phase 7 — Realtime tightening

**Goal:** Reduce per-client Realtime bandwidth + drop the broad table-wide subscriptions.

**Dependencies:** none.

**Estimated effort:** 1-2 hours.

### Code changes (no migrations)

**A. `src/hooks/useCartRealtime.ts:54-63`** — add server-side filter on soft_waits + priority_holds subscriptions:

```ts
.on("postgres_changes", {
  event: "*",
  schema: "public",
  table: "soft_waits",
  filter: `customer_id=eq.${customerId}`,
}, handler)
```

Same for `priority_holds`.

**B. `src/components/features/contention/SoftWaitNextInLineWatcher.tsx:153-166`** — two options:
- Option 1: Subscribe with `filter: 'checkout_session_id=eq.${holderSessionId}'` (the specific session the customer is waiting behind, known from the polled state).
- Option 2: Replace subscription with a debounced timer-based refetch (every 5s while the watcher is mounted). Simpler; doesn't depend on knowing the holder session id.

### Validation

1. Open two browser windows as different customers contending on the same variant.
2. Trigger a contention event in window A.
3. Confirm window B (different customer) does NOT receive the event payload (visible in network tab on the realtime websocket).

### Rollback

Git-revert.

---

## Phase 8 — Postgres safety improvements

**Goal:** Replace `EXCEPTION WHEN OTHERS THEN RAISE NOTICE` with typed catches; convert ROW-level triggers to STATEMENT-level where it matters; convert per-row loops in reapers/collapse to set-based ops.

**Dependencies:** Phase 1 (SQLSTATE codes are defined), Phase 0 (system_errors table for logging).

**Estimated effort:** 4-6 hours.

### Migrations

#### `2026MMDDhhmmss_typed_sqlstates_inventory_primitives.sql`

Replace the `RAISE EXCEPTION 'INSUFFICIENT_*'` plain-text raises in every primitive with `USING ERRCODE` raises:

```sql
CREATE OR REPLACE FUNCTION public.release_soft(p_variant_id uuid, p_qty integer)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.inventory_items%ROWTYPE;
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT', MESSAGE = 'INVALID_QUANTITY';
  END IF;
  UPDATE public.inventory_items
     SET quantity_available = quantity_available + p_qty,
         quantity_soft_held = quantity_soft_held - p_qty,
         updated_at = now()
   WHERE variant_id = p_variant_id AND quantity_soft_held >= p_qty
   RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ISFTL', MESSAGE = 'INSUFFICIENT_SOFT_HELD';
  END IF;
  RETURN v_row;
END $$;
```

Apply same shape to: `hold_soft`, `reserve_inventory`, `release_reservation`, `promote_soft_to_reserved`, `consume_reservation`, `decrement_inventory`, `release_priority`, `promote_to_priority`, `consume_priority_to_soft`. Plus add `SECURITY DEFINER` + `SET search_path` + REVOKE/GRANT (from Phase 0 if not already done).

#### `2026MMDDhhmmss_typed_catches_in_reapers.sql`

Replace the `EXCEPTION WHEN OTHERS THEN ... SQLERRM LIKE '%X%'` blocks in reapers with `WHEN SQLSTATE 'ISFTL'` catches, and log non-benign errors to `system_errors`:

```sql
CREATE OR REPLACE FUNCTION public.reap_stale_soft_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_released integer := 0;
  v_session  record;
  v_item     record;
BEGIN
  FOR v_session IN
    SELECT id, cart_id FROM public.cart_checkout_sessions
    WHERE state = 'soft' AND expires_at < now()
  LOOP
    IF v_session.cart_id IS NOT NULL THEN
      FOR v_item IN
        SELECT variant_id, quantity FROM public.cart_items
        WHERE cart_id = v_session.cart_id AND variant_id IS NOT NULL AND quantity > 0
      LOOP
        BEGIN
          PERFORM public.release_soft(v_item.variant_id, v_item.quantity);
        EXCEPTION
          WHEN SQLSTATE 'ISFTL' THEN
            -- Benign: hold already released by another path
            CONTINUE;
          WHEN OTHERS THEN
            -- Real failure: log so it's visible
            PERFORM public.log_system_error(
              'reap_stale_soft_sessions',
              'error',
              SQLSTATE,
              SQLERRM,
              'variant',
              v_item.variant_id,
              jsonb_build_object('session_id', v_session.id, 'qty', v_item.quantity)
            );
            CONTINUE;
        END;
      END LOOP;
    END IF;
    UPDATE public.cart_checkout_sessions SET state = 'released', updated_at = now() WHERE id = v_session.id;
    v_released := v_released + 1;
  END LOOP;
  RETURN v_released;
END $$;
```

Same shape applied to:
- `cleanup_expired_sessions_for_variant`
- `release_idle_soft_sessions`
- `release_stale_heartbeat_sessions`
- `release_expired_priority_holds`
- `advance_soft_wait_queue_for_session`
- `advance_soft_wait_queue_after_priority_expiry`
- `collapse_soft_wait_queue_for_session`
- `consume_priority_holds_for_checkout`
- `reconcile_orphan_soft_held`
- Pre-cleanup blocks in `hold_soft`, `effective_available_for`, `contestable_available_for` (these stay as catch-all but call `log_system_error`)

#### `2026MMDDhhmmss_cart_totals_statement_trigger.sql`

Convert `update_cart_totals` from ROW-level to STATEMENT-level:

```sql
DROP TRIGGER IF EXISTS on_cart_item_change ON public.cart_items;

CREATE OR REPLACE FUNCTION public.update_cart_totals_stmt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Recompute cart totals for every cart touched in this statement.
  WITH touched_carts AS (
    SELECT DISTINCT cart_id FROM new_rows
    UNION
    SELECT DISTINCT cart_id FROM old_rows
  ),
  totals AS (
    SELECT
      ci.cart_id,
      count(*) AS item_count,
      coalesce(sum(ci.unit_price * ci.quantity), 0) AS subtotal
    FROM public.cart_items ci
    WHERE ci.cart_id IN (SELECT cart_id FROM touched_carts)
    GROUP BY ci.cart_id
  )
  UPDATE public.carts c
  SET item_count = COALESCE(t.item_count, 0),
      subtotal   = COALESCE(t.subtotal, 0),
      updated_at = now()
  FROM totals t
  WHERE c.id = t.cart_id;
  RETURN NULL;
END $$;

CREATE TRIGGER on_cart_items_change_stmt
AFTER INSERT OR UPDATE OR DELETE ON public.cart_items
REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.update_cart_totals_stmt();
```

#### `2026MMDDhhmmss_collapse_queue_set_based.sql`

Rewrite `collapse_soft_wait_queue_for_session` to use set-based DELETEs:

```sql
CREATE OR REPLACE FUNCTION public.collapse_soft_wait_queue_for_session(p_session_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_affected integer;
BEGIN
  -- Step 1: collect cart_item_ids of all waiters for this session
  WITH waiter_items AS (
    SELECT cart_item_id, customer_id FROM public.soft_waits
    WHERE checkout_session_id = p_session_id
  )
  -- Step 2: release any of their priority_holds that match (set-based)
  UPDATE public.priority_holds ph
  SET consumed_at = now(),
      updated_at = now()
  FROM waiter_items wi
  WHERE ph.cart_item_id = wi.cart_item_id
    AND ph.consumed_at IS NULL;

  -- Step 3: delete cart_items in one shot
  DELETE FROM public.cart_items
  WHERE id IN (SELECT cart_item_id FROM public.soft_waits WHERE checkout_session_id = p_session_id);

  -- Step 4: delete soft_waits in one shot
  DELETE FROM public.soft_waits WHERE checkout_session_id = p_session_id;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected;
END $$;
```

### Code changes

None (DB-only phase).

### Validation

1. Force a non-benign error in a reaper (e.g. temporarily break a CHECK constraint and run the cron) — verify `system_errors` table receives the row.
2. Cart smoke test: add/remove/update items, verify cart total stays correct.
3. Contention smoke test: 3 customers contending on same variant, force collapse via session expiry, verify all waiters cleared correctly.

### Rollback

Each migration is a full `CREATE OR REPLACE` — re-apply the old version of the function. Keep the old migrations for reference; rollback = create a new migration that restores the old definition.

---

## Phase 9 — Read-path polishing

**Goal:** Final compounding wins on storefront/admin reads.

**Dependencies:** none — purely additive.

**Estimated effort:** 4-6 hours.

### Code changes

**A. `src/lib/site-search/searchVariants.ts`** — column selection + push pagination/cascade into SQL:
- Replace `products.select("*")` with explicit list of catalog-card columns
- Push OOS/visibility cascade + pagination into a new SQL view `catalog_searchable_variants` (defined in Phase 5 if not yet)

**B. `src/lib/site-search/getCatalogFacets.ts`** — push the products.active join filter into SQL so Node doesn't deserialize every variant.

**C. `src/lib/cart/getCart.ts:54, 76, 102`** — Promise.all the soft_waits + priority_holds + admin pending queries.

**D. `src/lib/site-search/getProductBySlug.ts:126-130`** — hoist the sequential attribute_values fetch into the main Promise.all.

**E. `src/app/(storefront)/products/[slug]/page.tsx:38-42`** — wrap `generateMetadata`'s value lookup in `React.cache` so the page render and metadata share results.

**F. `src/actions/inventory/bulkInventoryOps.ts:67-80`** — single bulk upsert via `onConflict: "variant_id"`.

**G. `src/actions/variants/addAxisValueToProduct.ts:165-188` + `addAxisToProduct.ts:161-181`** — single bulk insert with `onConflict: ignore`.

**H. `src/actions/attributes/deleteAttributeValue.ts:29-44`** — PG-side existence check:
```ts
const { data: usedBy } = await admin.rpc("attribute_value_in_use", { p_value_id: id });
```

Migration to add the helper:
```sql
CREATE OR REPLACE FUNCTION public.attribute_value_in_use(p_value_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.product_variants v
    WHERE v.attribute_combo @> jsonb_build_object('_dummy', p_value_id::text)
    -- Better: scan jsonb values
    OR (SELECT bool_or(value::text = p_value_id::text)
        FROM jsonb_each_text(coalesce(v.attribute_combo, '{}'::jsonb)))
  );
$$;
```

(The above is illustrative; the actual implementation needs care with how `attribute_combo` values are queried — JSONB GIN index helps.)

**I. `src/lib/courier/listActiveCarriers.ts`** — wrap in `unstable_cache` with `carriers` tag. Add invalidation in `updateCarrier`, `createCustomCarrier`, `deleteCustomCarrier`, etc.

**J. `src/actions/orders/saveOrderTracking.ts`** — convert SELECT-then-INSERT to single `INSERT ... ON CONFLICT DO NOTHING` against a `(order_id, tracking_number)` unique index.

**K. Stripe webhook idempotency** — single INSERT with `outcome='success'` after work succeeds (one round-trip vs current insert-then-update).

**L. `src/actions/payment/createCheckoutSession.ts:60-106`** — Promise.all the 3 sequential SELECTs (customer → order → items).

**M. `src/actions/product-specifications/addProductSpec.ts:101-127` + `updateProductSpec.ts:46-72`** — `INSERT ... ON CONFLICT (attribute_id, slug) DO NOTHING` with display_order via `coalesce((select max...), 0) + 1` in the same statement.

### Validation

Per change, verify the output matches the pre-change result on small data, then verify response time improvement on larger data.

### Rollback

Per-file git-revert.

---

## Phase 10 — Monitoring + observability

**Goal:** Surface the new `system_errors` data + provide the optional buffered audit log.

**Dependencies:** Phase 0 (system_errors table), Phase 8 (typed catches actually log to it).

**Estimated effort:** 3-4 hours.

### Migrations

None new — the table + helper are in Phase 0.

### Code changes

**A. New admin route: `src/app/admin/system-errors/page.tsx`**

Server-rendered list of recent rows from `system_errors`, with:
- Time range filter
- Source filter
- Severity filter
- Per-row "Mark as investigated" action (writes `resolved_at` + `resolved_by`)
- Group-by-source summary view at the top

**B. New action: `src/actions/system-errors/markResolved.ts`** — flips `resolved_at` + `resolved_by`.

**C. Add to admin nav** — under "Operations" or "System".

**D. (Optional) Buffered audit log writer:**

`src/lib/audit-log/bufferedLogger.ts` — accumulates events in a module-scoped queue, flushes every 250ms via `setInterval` (or on `unmount`/page transition). Reduces per-mutation audit-log INSERT cost from ~10-50ms to ~0ms (queueing).

Wire `logAuditEvent` to use the buffered writer instead of immediate INSERT.

### Validation

1. Trigger a deliberate error in a reaper (e.g. lock a row externally so an UPDATE fails) → verify it shows up in /admin/system-errors.
2. Mark as resolved → row updates correctly.

### Rollback

Page can be hidden via nav config. Buffered logger can be reverted to direct-write per-call.

---

## Cumulative impact estimate (after all phases)

Cross-referencing the audit's performance projections with this implementation plan, here are the realistic compound wins after all 11 phases ship:

| Scenario | Today | After all phases | Multiplier |
|---|---|---|---|
| Place 5-item order (action latency) | ~600-1000ms | ~150-250ms | **3-4x** |
| Product detail page (10-variant) | ~600-1200ms | ~110-160ms | **5-10x** |
| Wishlist page (8 items) | ~400-800ms | ~80-150ms | **5x** |
| Admin /orders filtered list (10k orders) | ~200-500ms | ~30-50ms | **8-10x** |
| Customer search (5k customers) | ~500-2000ms | ~10-30ms | **20-50x** |
| Stripe webhook handler | ~300-500ms | ~30-80ms | **5-10x** |
| Bulk inventory update (50 variants) | ~1.5-4s | ~50-150ms | **20-30x** |
| Catalog facet cache miss | ~300-600ms | ~60-120ms | **3-5x** |
| /admin/inventory at 5k variants | broken | working | n/a |

**Scaling ceilings shift** (per audit): 2k variants → 50k, 10k orders → 500k, 5k customers → 500k, 1k SKUs → 50k.

**DB load** (baseline, not user-visible): cron reaper CPU drops ~80%; cart trigger fan-out drops ~50%; Realtime traffic per client drops ~90% under contention.

---

## Execution recommendation

**Sequence to ship:**

1. **Day 1 (3-4 hours):** Phase 0 + Phase 1. Pure additive; zero risk. Ship to production immediately. Closes the privilege-escalation gaps + adds the indexes that hurt nothing.

2. **Days 2-3 (5-7 hours):** Phase 2. The big one. Stage in dev, run full smoke tests against test orders + carts, verify the rollback path works, then deploy. Watch logs for the first 24h.

3. **Days 4-5 (5-7 hours):** Phase 3 (depends on Phase 2). Same staging discipline.

4. **Day 6 (3-4 hours):** Phase 4 (cache fixes). Low-risk; ship.

5. **Day 7-8 (7-9 hours):** Phase 5 (admin pagination + views). Stage with seeded large datasets.

6. **Day 9 (3-4 hours):** Phases 6 + 7 + 9 in parallel — they're independent. Customer search, Realtime filtering, read-path polishing.

7. **Day 10-11 (5-7 hours):** Phase 8 (Postgres safety). Test reaper behavior under load.

8. **Day 12 (3-4 hours):** Phase 10 (monitoring surface).

**Total elapsed time: ~2 weeks of focused work**, but only Phases 2 + 3 + 5 + 8 require dedicated stage-test cycles. The rest can ship the same day they're implemented.

**Do not skip Phase 0.** Privilege-escalation issues need to be fixed before any new SECURITY DEFINER function lands, or new functions inherit the same gap.

---

## Appendix A — File-by-file change summary

For quick navigation when executing each phase, here's every source file that gets touched. Cross-reference with the audit's `file:line` citations.

### Migrations to CREATE (16 new)
- Phase 0: 2 migrations (unsafe-function REVOKE, system_errors table)
- Phase 1: 2 migrations (indexes, SQLSTATE doc)
- Phase 2: 2 migrations (batch inventory, batch availability)
- Phase 3: 4 migrations (fulfill, refund, delete, session-completed)
- Phase 5: 2 migrations (admin views, margins MV)
- Phase 6: 1 migration (trigram)
- Phase 8: 4 migrations (typed sqlstates, typed catches, cart totals stmt, collapse set-based)

### TS/TSX files to modify (~45 files)

Inventory libs (Phase 2): `holdSoftAllOrFail.ts`, `reserveAllOrFail.ts`, `promoteAllOrFail.ts`, `releaseSoftAll.ts`, `getEffectiveAvailable.ts`, `getContestableAvailable.ts`.

Wishlist lib (Phase 2): `getWishlist.ts`.

Checkout actions (Phase 2 + 3): `startCheckoutSession.ts`, `placeOrder.ts`, `createCheckoutSession.ts`.

Order actions (Phase 3): `fulfillOrder.ts`, `refundOrder.ts`, `deleteOrder.ts`, `transitionOrderStatus.ts`, `createOrder.ts`, `saveOrderTracking.ts`.

Customer actions (Phase 3): `mergeCustomers.ts`.

Payment / webhook (Phase 3): `handleSessionEvents.ts`, the Stripe webhook route.

Cache-invalidation tags (Phase 4): `setInventoryLevel.ts`, `bulkInventoryOps.ts`, all 6 variant action files, `setProductCategories.ts`, `signOut.ts`, all 7 attribute action files, `searchVariants.ts`, `getCatalogFacets.ts`.

Admin pages (Phase 5): `/admin/inventory/page.tsx`, `/admin/supply-orders/page.tsx`, `/admin/customers/{page,[id]}.tsx`, `/admin/reports/margins/page.tsx`, `/admin/attributes/page.tsx`, `/admin/returns/page.tsx`, `/admin/products/page.tsx`, `/admin/orders/{page,[id]}.tsx`, `/admin/page.tsx`.

Customer search (Phase 6): `searchCustomers.ts` (verify EXPLAIN — no JS change required).

Realtime (Phase 7): `useCartRealtime.ts`, `SoftWaitNextInLineWatcher.tsx`.

Read-path polish (Phase 9): `searchVariants.ts`, `getCatalogFacets.ts`, `getCart.ts`, `getProductBySlug.ts`, product `[slug]/page.tsx`, `bulkInventoryOps.ts`, `addAxisValueToProduct.ts`, `addAxisToProduct.ts`, `deleteAttributeValue.ts`, `listActiveCarriers.ts`, `addProductSpec.ts`, `updateProductSpec.ts`.

Monitoring (Phase 10): new `/admin/system-errors/page.tsx`, optional `bufferedLogger.ts`.

---

## Appendix B — Risk register

| Risk | Mitigation |
|---|---|
| Phase 2 batch RPC introduces a regression in atomic semantics | Stage in dev; verify rollback via simulated partial failures; old per-row RPCs still in DB for fallback |
| Phase 5 admin views diverge from current JS aggregations | Compare row-by-row output on small data before deploying |
| Phase 8 typed-catch refactor accidentally swallows real errors | Each typed catch falls through to `log_system_error` for non-benign codes — visibility goes UP, not down |
| Phase 0 REVOKE breaks an unexpected caller | Every flow is smoke-tested before ship; rollback = single GRANT statement |
| Materialized view drift (margins) | Concurrent refresh on cron; stale-by-up-to-24h is acceptable for the report use case |
| pg_trgm extension not enabled on Supabase tier | Extension is available on all Supabase tiers as of 2024 |
| Realtime filter syntax differs between Supabase versions | Use the standard `'column=eq.value'` filter — supported since v1 |

---

This plan is now ready for execution. The phases are dependency-ordered, each one is self-contained with its own validation + rollback story, and the cumulative impact maps cleanly back to the audit's projected performance gains.
