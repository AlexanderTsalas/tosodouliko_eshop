-- =============================================================================
-- Phase 1a — Performance indexes from the data-layer audit.
--
-- All indexes are additive + IF NOT EXISTS so this migration is safe to
-- re-run. No code changes accompany this migration; existing query
-- patterns immediately benefit from the new access paths.
--
-- Findings addressed:
--   SC-H1 — effective_available_for hot path (orders join indexes)
--   SC-H3 — /admin/orders filtered list (composite indexes)
--   SC-H4 — reconcile_orphan_soft_held cron (partial index)
--   SC-M2 — wishlist_items.customer_id missing index
--   SC-M3 — missing FK indexes on cart_items/order_items/
--           collapse_notifications product/variant FK columns
--   SC-M4 — audit_events action+resource+created composite
--   SC-M5 — drop unused fees_breakdown GIN
--   SC-L2 — orders.carrier_slug partial (instead of full)
-- =============================================================================

-- ──── /admin/orders filtered list (SC-H3) ────────────────────────────────────
-- Composite on (status, created_at DESC) lets the planner do an
-- index-only scan when the admin filters by status and orders by date.
-- Previously the single-column indexes forced bitmap-AND or a sort
-- step after retrieval.
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_created
  ON public.orders(fulfillment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_payment_created
  ON public.orders(payment_status, created_at DESC);

-- ──── effective_available_for hot path (SC-H1) ───────────────────────────────
-- effective_available_for joins order_items to orders to count the
-- viewer's in-flight reservations for a variant. Without
-- (order_id, variant_id) this becomes a nested-loop with a seq scan
-- on order_items at >10k orders.
CREATE INDEX IF NOT EXISTS idx_order_items_order_variant
  ON public.order_items(order_id, variant_id);

-- Partial on pending-status orders only. The vast majority of orders
-- are paid/refunded; the predicate `payment_status='pending'` shrinks
-- the index footprint significantly while still satisfying the
-- effective_available_for query.
CREATE INDEX IF NOT EXISTS idx_orders_customer_active
  ON public.orders(customer_id)
  WHERE payment_status = 'pending';

-- ──── reconcile_orphan_soft_held cron (SC-H4) ────────────────────────────────
-- The 5-min reconciliation cron scans inventory_items for rows where
-- quantity_soft_held > 0 and fixes drift. Without this partial index
-- the scan is full-table; with it, the seek hits only the (very few)
-- variants that actually have a live soft-hold.
CREATE INDEX IF NOT EXISTS idx_inventory_items_soft_held_active
  ON public.inventory_items(variant_id)
  WHERE quantity_soft_held > 0;

-- ──── Wishlist hot read (SC-M2) ──────────────────────────────────────────────
-- The UNIQUE on (customer_id, product_id, variant_id) covers equality
-- by customer_id alone (leftmost-prefix), but doesn't satisfy queries
-- that filter on customer + order by created_at. Add a composite that
-- does.
CREATE INDEX IF NOT EXISTS idx_wishlist_items_customer_created
  ON public.wishlist_items(customer_id, created_at DESC);

-- ──── Audit log hot query (SC-M4) ────────────────────────────────────────────
-- The daily-handoff page queries audit_events by
-- (action, resource_type, resource_id) ORDER BY created_at DESC.
-- The existing (resource_type, resource_id) index forces a
-- post-filter sort. New composite is leftmost-prefix on action,
-- which is the most selective.
CREATE INDEX IF NOT EXISTS idx_audit_action_resource_created
  ON public.audit_events(action, resource_type, resource_id, created_at DESC);

-- ──── Missing FK indexes (SC-M3) ─────────────────────────────────────────────
-- Postgres does NOT auto-index FK columns. When the referenced row is
-- deleted (cart_items.product_id → products.id with CASCADE), the
-- cascade scans the FK column. Without an index this scan can grow
-- linearly with the cart_items table.
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id
  ON public.cart_items(product_id);

CREATE INDEX IF NOT EXISTS idx_order_items_product_id
  ON public.order_items(product_id);

CREATE INDEX IF NOT EXISTS idx_collapse_notifications_variant_id
  ON public.collapse_notifications(variant_id);

CREATE INDEX IF NOT EXISTS idx_collapse_notifications_product_id
  ON public.collapse_notifications(product_id);

-- ──── orders.carrier_slug: full → partial (SC-L2) ────────────────────────────
-- The existing idx_orders_carrier_slug is a full-table index, but most
-- store_pickup orders have carrier_slug IS NULL. A partial index
-- skipping NULLs is smaller without losing any query coverage (every
-- query that filters on carrier_slug also implicitly excludes NULL).
DROP INDEX IF EXISTS public.idx_orders_carrier_slug;
CREATE INDEX IF NOT EXISTS idx_orders_carrier_slug_partial
  ON public.orders(carrier_slug)
  WHERE carrier_slug IS NOT NULL;

-- ──── Drop unused GIN on orders.fees_breakdown (SC-M5) ───────────────────────
-- The GIN was added speculatively for containment queries on the
-- jsonb fees_breakdown column, but no query in src/ actually uses
-- @> or ? operators on it (only column-level SELECT). The GIN
-- maintains every jsonb row on every order INSERT/UPDATE — pure
-- write-time cost with no read-side benefit.
DROP INDEX IF EXISTS public.idx_orders_fees_breakdown_gin;

NOTIFY pgrst, 'reload schema';
