-- ──────────────────────────────────────────────────────────────────────────
-- ASSERTIONS for contention-abandon-chain scenario (Test 2a).
--
-- Verifies the soft-wait → priority-hold promotion chain advanced
-- correctly through all queue members. Every assertion's `pass` column
-- must be `true` for the chain to be considered correct.
--
-- IMPORTANT: replace `:vu_count` (used in B5 + B6) with the actual VU_COUNT
-- you ran with. We can't parametrize PostgREST/psql cleanly from a single
-- file. With 10 VUs → expected = 9 (one is the winner).
--
-- For 10 VUs, use 9 in the two indicated places below.
-- ──────────────────────────────────────────────────────────────────────────

WITH target AS (
  SELECT pv.id AS variant_id, p.id AS product_id
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  WHERE p.slug = 'trenaki-xylino'
),
inv AS (
  SELECT i.quantity_available, i.quantity_reserved,
         i.quantity_soft_held, i.quantity_priority_held
  FROM public.inventory_items i
  JOIN target t ON t.variant_id = i.variant_id
),
softwait_stats AS (
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE promoted_at IS NULL)::int     AS unpromoted,
    count(*) FILTER (WHERE promoted_at IS NOT NULL)::int AS promoted
  FROM public.soft_waits sw
  JOIN target t ON t.variant_id = sw.variant_id
),
priorityhold_stats AS (
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE consumed_at IS NULL)::int     AS active,
    count(*) FILTER (WHERE consumed_at IS NOT NULL)::int AS terminal,
    count(*) FILTER (WHERE source = 'soft_wait_promotion')::int AS from_soft_wait
  FROM public.priority_holds ph
  JOIN target t ON t.variant_id = ph.variant_id
),
fifo_check AS (
  -- Verify priority_holds.granted_at order matches soft_waits.created_at
  -- order. We join each priority_hold to its origin_soft_wait and check
  -- that the granted_at order is consistent with the created_at order.
  -- A "FIFO violation" would be any pair (a, b) where:
  --   a.granted_at < b.granted_at  BUT  origin_a.created_at > origin_b.created_at
  -- i.e., a was promoted before b, but a's origin wait was created AFTER b's.
  SELECT count(*)::int AS violations
  FROM public.priority_holds ph_a
  JOIN public.soft_waits sw_a ON sw_a.id = ph_a.origin_soft_wait_id
  JOIN target t ON t.variant_id = ph_a.variant_id
  CROSS JOIN public.priority_holds ph_b
  JOIN public.soft_waits sw_b ON sw_b.id = ph_b.origin_soft_wait_id
  WHERE ph_b.variant_id = t.variant_id
    AND ph_a.id <> ph_b.id
    AND ph_a.granted_at < ph_b.granted_at
    AND sw_a.created_at > sw_b.created_at
)
SELECT 'B1: inventory available restored to 1' AS check,
       (SELECT quantity_available FROM inv)::text AS actual,
       '1' AS expected,
       (SELECT quantity_available FROM inv) = 1 AS pass
UNION ALL SELECT 'B2: no reserved (no order placed in this test)',
       (SELECT quantity_reserved FROM inv)::text,
       '0',
       (SELECT quantity_reserved FROM inv) = 0
UNION ALL SELECT 'B3: no soft_held (all sessions released)',
       (SELECT quantity_soft_held FROM inv)::text,
       '0',
       (SELECT quantity_soft_held FROM inv) = 0
UNION ALL SELECT 'B4: no priority_held (all holds consumed)',
       (SELECT quantity_priority_held FROM inv)::text,
       '0',
       (SELECT quantity_priority_held FROM inv) = 0
UNION ALL SELECT 'B5: ALL soft_waits promoted (every waiter got a turn)',
       (SELECT unpromoted FROM softwait_stats)::text,
       '0',
       (SELECT unpromoted FROM softwait_stats) = 0
UNION ALL SELECT 'B6: priority_holds count matches loser count (VU_COUNT - 1)',
       (SELECT from_soft_wait FROM priorityhold_stats)::text,
       -- CHANGE THIS to (VU_COUNT - 1): 9 for 10 VUs, 24 for 25, 49 for 50
       '9' AS expected,
       (SELECT from_soft_wait FROM priorityhold_stats) = 9
UNION ALL SELECT 'B7: all priority_holds are terminal (consumed_at IS NOT NULL)',
       (SELECT active FROM priorityhold_stats)::text,
       '0',
       (SELECT active FROM priorityhold_stats) = 0
UNION ALL SELECT 'B8: FIFO order preserved across chain (zero violations)',
       (SELECT violations FROM fifo_check)::text,
       '0',
       (SELECT violations FROM fifo_check) = 0
;
