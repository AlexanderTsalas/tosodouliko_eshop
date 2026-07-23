-- ──────────────────────────────────────────────────────────────────────────
-- DIAGNOSTICS for contention-basic-race scenario.
--
-- Run after assert-basic-race.sql if any assertion failed. Gives a verbose
-- view of every contention-related row for the test variant, so you can
-- see what actually happened vs what was expected.
--
-- Read top-to-bottom; the sections answer specific debugging questions.
-- ──────────────────────────────────────────────────────────────────────────

WITH target AS (
  SELECT pv.id AS variant_id, p.id AS product_id
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  WHERE p.slug = 'trenaki-xylino'
)
-- 1. Inventory state right now
SELECT 'inventory_items' AS source,
       jsonb_build_object(
         'quantity_available', i.quantity_available,
         'quantity_reserved', i.quantity_reserved,
         'quantity_soft_held', i.quantity_soft_held,
         'quantity_priority_held', i.quantity_priority_held,
         'updated_at', i.updated_at
       ) AS detail
FROM public.inventory_items i
JOIN target t ON t.variant_id = i.variant_id;

-- 2. Orders + order_items for the contested variant
WITH target AS (
  SELECT pv.id AS variant_id, p.id AS product_id
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  WHERE p.slug = 'trenaki-xylino'
)
SELECT 'orders' AS source,
       jsonb_build_object(
         'order_id', o.id,
         'customer_id', o.customer_id,
         'status', o.status,
         'payment_status', o.payment_status,
         'created_at', o.created_at
       ) AS detail
FROM public.orders o
JOIN public.order_items oi ON oi.order_id = o.id
JOIN target t ON t.variant_id = oi.variant_id
ORDER BY o.created_at;

-- 3. All cart_checkout_sessions touched during the run
SELECT 'cart_checkout_sessions' AS source,
       jsonb_build_object(
         'id', s.id,
         'customer_id', s.customer_id,
         'cart_id', s.cart_id,
         'state', s.state,
         'expires_at', s.expires_at,
         'created_at', s.created_at,
         'updated_at', s.updated_at
       ) AS detail
FROM public.cart_checkout_sessions s
ORDER BY s.created_at;

-- 4. All soft_waits — should be empty if collapse fired correctly
SELECT 'soft_waits (leftover)' AS source,
       jsonb_build_object(
         'id', sw.id,
         'customer_id', sw.customer_id,
         'variant_id', sw.variant_id,
         'checkout_session_id', sw.checkout_session_id,
         'cart_item_id', sw.cart_item_id,
         'quantity', sw.quantity,
         'created_at', sw.created_at,
         'promoted_at', sw.promoted_at
       ) AS detail
FROM public.soft_waits sw;

-- 5. All collapse_notifications fired
WITH target AS (
  SELECT pv.id AS variant_id, p.id AS product_id
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  WHERE p.slug = 'trenaki-xylino'
)
SELECT 'collapse_notifications' AS source,
       jsonb_build_object(
         'id', cn.id,
         'customer_id', cn.customer_id,
         'variant_id', cn.variant_id,
         'product_name', cn.product_name,
         'acknowledged_at', cn.acknowledged_at,
         'created_at', cn.created_at
       ) AS detail
FROM public.collapse_notifications cn
JOIN target t ON t.variant_id = cn.variant_id
ORDER BY cn.created_at;
