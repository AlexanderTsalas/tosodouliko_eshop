-- =============================================================================
-- Phase 5a — Admin views.
--
-- Background:
--   Several admin pages currently fetch entire tables and aggregate in
--   JS to render counts / status badges / list views:
--
--     - /admin/customers + /[id]    loop orders per customer, count in JS
--     - /admin/inventory             MAX_FETCH=2000 rows + JS filter
--     - /admin/products              JS stock-status filter post-pagination
--     - /admin/attributes            scans every variant.attribute_combo +
--                                    every spec to compute is_axis/is_spec
--
--   These views express the aggregations in SQL once so the pages can
--   SELECT + .range() instead of fetch-everything-then-reduce. At scale
--   (~10k orders, ~5k variants) the view path stays sub-100ms while the
--   JS path either silently truncates or blocks for seconds.
--
-- Views are non-materialized — fresh on every query. Admin pages render
-- on demand and need live data; the freshness wins over the recompute
-- cost (the underlying tables already have the indexes from Phase 1).
--
-- RLS note: views in Postgres inherit the calling user's permissions on
-- the underlying tables. All admin pages use createAdminClient
-- (service_role) which bypasses RLS, so no extra policy work is needed
-- here. If a future caller uses an anon/authenticated client against
-- these views, RLS on the underlying tables (customers, orders,
-- inventory_items, etc.) applies as usual.
-- =============================================================================

-- ──── customer_summary ──────────────────────────────────────────────────────
-- Per-customer aggregates for the /admin/customers list + the customer
-- detail page header. Replaces the JS loop that loads every order per
-- customer just to compute count + last_order_at.
--
-- Counts only orders that 'happened' (paid or refunded). Pending / failed
-- carts that never converted should not inflate lifetime value.
CREATE OR REPLACE VIEW public.customer_summary AS
SELECT
  c.id,
  c.email,
  c.phone,
  c.first_name,
  c.last_name,
  c.auth_user_id,
  c.source,
  c.created_at,
  c.updated_at,
  c.email_normalized,
  c.phone_normalized,
  COALESCE(o.order_count,    0)                          AS order_count,
  COALESCE(o.lifetime_total, 0)::numeric(12,2)           AS lifetime_total,
  o.last_order_at,
  o.last_order_currency
FROM public.customers c
LEFT JOIN LATERAL (
  SELECT
    count(*)                                                AS order_count,
    sum(total)                                              AS lifetime_total,
    max(created_at)                                         AS last_order_at,
    (array_agg(currency ORDER BY created_at DESC))[1]       AS last_order_currency
  FROM public.orders
  WHERE customer_id = c.id
    AND payment_status IN ('paid', 'refunded')
) o ON true;

COMMENT ON VIEW public.customer_summary IS
'Per-customer aggregates (order_count, lifetime_total, last_order_at) computed in SQL via LATERAL. Replaces JS-side reduce loops in /admin/customers and /admin/customers/[id].';

-- ──── inventory_with_product_status ─────────────────────────────────────────
-- inventory_items joined to product + variant metadata for the
-- /admin/inventory page's filter UI. Eliminates the legacy
-- MAX_FETCH=2000 silent truncation by enabling server-side range()
-- pagination with all filters pushed into SQL.
--
-- stock_status is computed here so the JS code stops doing it
-- post-fetch (which broke pagination — the pre-Phase-5 page filtered
-- AFTER paginating, producing under-filled pages and wrong totals).
CREATE OR REPLACE VIEW public.inventory_with_product_status AS
SELECT
  inv.id                        AS inventory_id,
  inv.variant_id,
  inv.quantity_available,
  inv.quantity_reserved,
  inv.quantity_soft_held,
  inv.quantity_priority_held,
  inv.low_stock_threshold,
  inv.updated_at                AS inventory_updated_at,

  v.sku,
  v.price                       AS variant_price,
  v.is_active                   AS variant_active,
  v.attribute_combo,
  v.track_supply,
  v.show_when_oos,

  p.id                          AS product_id,
  p.name                        AS product_name,
  p.slug                        AS product_slug,
  p.active                      AS product_active,
  p.default_supplier_id,
  p.currency,

  CASE
    WHEN NOT v.track_supply                          THEN 'untracked'
    WHEN inv.quantity_available <= 0                 THEN 'out'
    WHEN inv.quantity_available <= inv.low_stock_threshold
     AND inv.low_stock_threshold > 0                 THEN 'low'
    ELSE                                                  'ok'
  END                           AS stock_status
FROM public.inventory_items inv
JOIN public.product_variants v ON v.id = inv.variant_id
JOIN public.products p          ON p.id = v.product_id;

COMMENT ON VIEW public.inventory_with_product_status IS
'inventory_items joined to product + variant metadata with a pre-computed stock_status column. Lets /admin/inventory use server-side .range() pagination instead of MAX_FETCH=2000 + JS filter (which silently truncated past 2k variants).';

-- ──── product_stock_rollup ──────────────────────────────────────────────────
-- Per-product totals for /admin/products list. Replaces JS-side stock
-- filter that currently produces wrong page totals because the filter
-- runs AFTER pagination.
CREATE OR REPLACE VIEW public.product_stock_rollup AS
SELECT
  v.product_id,
  count(v.id)                                          AS variant_count,
  count(*) FILTER (WHERE v.is_active)                   AS active_variant_count,
  COALESCE(sum(inv.quantity_available), 0)::integer    AS total_available,
  COALESCE(sum(inv.quantity_reserved),  0)::integer    AS total_reserved,
  COALESCE(sum(inv.quantity_soft_held), 0)::integer    AS total_soft_held,
  count(*) FILTER (
    WHERE v.is_active
      AND v.track_supply
      AND (inv.quantity_available IS NULL OR inv.quantity_available <= 0)
  )                                                    AS oos_variant_count,
  count(*) FILTER (
    WHERE v.is_active
      AND v.track_supply
      AND inv.low_stock_threshold > 0
      AND inv.quantity_available <= inv.low_stock_threshold
      AND inv.quantity_available > 0
  )                                                    AS low_variant_count,
  -- Pre-computed rolled-up status (mirrors rollUp() in
  -- src/app/admin/products/page.tsx). Exposed as a column so the
  -- stock-filter dropdown on /admin/products can push the filter into
  -- SQL instead of applying it post-pagination (which created
  -- under-filled pages + wrong totals).
  --
  --   total_available <= 0                  → 'out'
  --   any tracked variant is out OR low     → 'low'
  --   otherwise                             → 'ok'
  CASE
    WHEN COALESCE(sum(inv.quantity_available), 0) <= 0 THEN 'out'
    WHEN count(*) FILTER (
      WHERE v.is_active
        AND v.track_supply
        AND inv.low_stock_threshold > 0
        AND inv.quantity_available <= inv.low_stock_threshold
    ) > 0 THEN 'low'
    ELSE 'ok'
  END                                                  AS rolled_up_status
FROM public.product_variants v
LEFT JOIN public.inventory_items inv ON inv.variant_id = v.id
GROUP BY v.product_id;

COMMENT ON VIEW public.product_stock_rollup IS
'Per-product summed inventory (available/reserved/soft_held) + counts (variants/active/OOS/low). Lets /admin/products filter by stock status in SQL without JS post-fetch reduce.';

-- ──── attribute_usage ───────────────────────────────────────────────────────
-- Per-attribute usage flags + value count for /admin/attributes.
-- Replaces a full table scan of product_variants.attribute_combo + a
-- full scan of product_specifications.
CREATE OR REPLACE VIEW public.attribute_usage AS
SELECT
  a.id                          AS attribute_id,
  a.name,
  a.slug,
  a.type,
  a.created_at,
  EXISTS (
    SELECT 1
    FROM public.product_variants v
    WHERE v.attribute_combo ? a.slug
  )                             AS is_variant_axis,
  EXISTS (
    SELECT 1
    FROM public.product_specifications ps
    WHERE ps.attribute_id = a.id
  )                             AS is_spec,
  (SELECT count(*) FROM public.attribute_values av WHERE av.attribute_id = a.id) AS value_count
FROM public.attributes a;

COMMENT ON VIEW public.attribute_usage IS
'Per-attribute usage flags (is_variant_axis = referenced by any variant.attribute_combo jsonb, is_spec = used in product_specifications) + value_count. Replaces full table scans in /admin/attributes.';

NOTIFY pgrst, 'reload schema';
