-- ──────────────────────────────────────────────────────────────────────────
-- ASSERTIONS for contention-basic-race scenario.
--
-- Run this AFTER k6 finishes. Expected output: every row's `pass` column
-- should be `true`. Any `false` indicates the contention design failed
-- under the test's load.
--
-- For these assertions to be meaningful, the test must have started from
-- the seed state (`npm run seed:contention`) — variant has 1 unit stock
-- and the queue is empty.
--
-- The contested variant id is read from `inventory_items` matching the
-- product slug `trenaki-xylino` (per the contention seed's CONTESTED_SLUG).
-- ──────────────────────────────────────────────────────────────────────────

WITH target AS (
  SELECT pv.id AS variant_id, p.id AS product_id
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  WHERE p.slug = 'trenaki-xylino'
),
inv AS (
  SELECT i.quantity_available, i.quantity_reserved, i.quantity_soft_held
  FROM public.inventory_items i
  JOIN target t ON t.variant_id = i.variant_id
),
orders_count AS (
  SELECT count(*)::int AS n
  FROM public.order_items oi
  JOIN target t ON t.variant_id = oi.variant_id
),
softwaits_count AS (
  SELECT count(*)::int AS n
  FROM public.soft_waits sw
  JOIN target t ON t.variant_id = sw.variant_id
),
collapse_count AS (
  SELECT count(*)::int AS n
  FROM public.collapse_notifications cn
  JOIN target t ON t.variant_id = cn.variant_id
)
SELECT 'A1: inventory.available == 0'  AS check,
       (SELECT quantity_available FROM inv) AS actual,
       0 AS expected,
       (SELECT quantity_available FROM inv) = 0 AS pass
UNION ALL SELECT 'A2: inventory.reserved == 1',
       (SELECT quantity_reserved FROM inv),
       1,
       (SELECT quantity_reserved FROM inv) = 1
UNION ALL SELECT 'A3: inventory.soft_held == 0 (post-race)',
       (SELECT quantity_soft_held FROM inv),
       0,
       (SELECT quantity_soft_held FROM inv) = 0
UNION ALL SELECT 'A4: NO negative inventory anywhere',
       (CASE WHEN
           (SELECT quantity_available FROM inv) >= 0 AND
           (SELECT quantity_reserved FROM inv) >= 0 AND
           (SELECT quantity_soft_held FROM inv) >= 0
         THEN 1 ELSE 0 END),
       1,
       (SELECT quantity_available FROM inv) >= 0 AND
       (SELECT quantity_reserved FROM inv) >= 0 AND
       (SELECT quantity_soft_held FROM inv) >= 0
UNION ALL SELECT 'A5: exactly 1 order placed for contested variant',
       (SELECT n FROM orders_count),
       1,
       (SELECT n FROM orders_count) = 1
UNION ALL SELECT 'A6: soft_waits drained (queue empty after collapse)',
       (SELECT n FROM softwaits_count),
       0,
       (SELECT n FROM softwaits_count) = 0
UNION ALL SELECT 'A7: collapse_notifications match (VU_COUNT - 1)',
       (SELECT n FROM collapse_count),
       -- this assertion compares against expected loser count; update
       -- manually based on the VU_COUNT you ran with:
       --   5 VUs  → expected 4
       --   25 VUs → expected 24
       --   50 VUs → expected 49
       4,
       (SELECT n FROM collapse_count) = 4
;
