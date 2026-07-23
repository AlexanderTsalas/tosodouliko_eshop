-- ──────────────────────────────────────────────────────────────────────────
-- ASSERTIONS for contention-abandon-chain-parallel scenario (Test 2b).
--
-- Verifies that THREE concurrent contention chains all drained correctly,
-- with FIFO preserved within each, and ZERO cross-chain leakage.
--
-- Assumes VUS_PER_CHAIN = 10 (so each chain should produce 9 priority_holds).
-- The contested variants are read by slug from contention-parallel.mjs's
-- CONTESTED_SLUGS array.
-- ──────────────────────────────────────────────────────────────────────────

WITH targets AS (
  SELECT pv.id AS variant_id, p.id AS product_id, p.slug AS slug
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  WHERE p.slug IN ('trenaki-xylino', 'kouklospito-mini', 'puzzle-100-kommatia')
),
inv_per_chain AS (
  SELECT
    t.slug,
    i.quantity_available,
    i.quantity_reserved,
    i.quantity_soft_held,
    i.quantity_priority_held
  FROM public.inventory_items i
  JOIN targets t ON t.variant_id = i.variant_id
),
softwait_per_chain AS (
  SELECT
    t.slug,
    count(*)::int AS total,
    count(*) FILTER (WHERE promoted_at IS NULL)::int     AS unpromoted,
    count(*) FILTER (WHERE promoted_at IS NOT NULL)::int AS promoted
  FROM public.soft_waits sw
  JOIN targets t ON t.variant_id = sw.variant_id
  GROUP BY t.slug
),
priorityhold_per_chain AS (
  SELECT
    t.slug,
    count(*)::int AS total,
    count(*) FILTER (WHERE consumed_at IS NULL)::int     AS active,
    count(*) FILTER (WHERE consumed_at IS NOT NULL)::int AS terminal
  FROM public.priority_holds ph
  JOIN targets t ON t.variant_id = ph.variant_id
  GROUP BY t.slug
),
fifo_violations_per_chain AS (
  SELECT
    t.slug,
    count(*)::int AS violations
  FROM public.priority_holds ph_a
  JOIN public.soft_waits sw_a ON sw_a.id = ph_a.origin_soft_wait_id
  JOIN targets t ON t.variant_id = ph_a.variant_id
  CROSS JOIN public.priority_holds ph_b
  JOIN public.soft_waits sw_b ON sw_b.id = ph_b.origin_soft_wait_id
  WHERE ph_b.variant_id = t.variant_id
    AND ph_a.id <> ph_b.id
    AND ph_a.granted_at < ph_b.granted_at
    AND sw_a.created_at > sw_b.created_at
  GROUP BY t.slug
),
-- Cross-chain leakage check: any customer who appears in priority_holds
-- for MULTIPLE variants? Would mean cross-chain promotion.
cross_chain_check AS (
  SELECT count(*)::int AS leaked_customers
  FROM (
    SELECT ph.customer_id, count(DISTINCT ph.variant_id) AS variant_count
    FROM public.priority_holds ph
    JOIN targets t ON t.variant_id = ph.variant_id
    GROUP BY ph.customer_id
    HAVING count(DISTINCT ph.variant_id) > 1
  ) leaked
)
-- ─── Per-chain assertions ───────────────────────────────────────────────
SELECT
  'C1[' || slug || ']: available=1' AS check,
  quantity_available::text AS actual,
  '1' AS expected,
  quantity_available = 1 AS pass
FROM inv_per_chain
UNION ALL
SELECT
  'C2[' || slug || ']: priority_held=0',
  quantity_priority_held::text, '0',
  quantity_priority_held = 0
FROM inv_per_chain
UNION ALL
SELECT
  'C3[' || slug || ']: soft_held=0',
  quantity_soft_held::text, '0',
  quantity_soft_held = 0
FROM inv_per_chain
UNION ALL
SELECT
  'C4[' || slug || ']: all 9 soft_waits promoted',
  unpromoted::text, '0',
  unpromoted = 0
FROM softwait_per_chain
UNION ALL
SELECT
  'C5[' || slug || ']: 9 priority_holds, all terminal',
  active::text, '0',
  active = 0
FROM priorityhold_per_chain
UNION ALL
SELECT
  'C6[' || slug || ']: 9 priority_holds total',
  total::text, '9',
  total = 9
FROM priorityhold_per_chain
UNION ALL
SELECT
  'C7[' || slug || ']: FIFO preserved (zero violations)',
  COALESCE(violations, 0)::text, '0',
  COALESCE(violations, 0) = 0
FROM (
  SELECT t.slug, fv.violations
  FROM targets t
  LEFT JOIN fifo_violations_per_chain fv ON fv.slug = t.slug
) chain_fifo
UNION ALL
-- ─── Cross-chain isolation ──────────────────────────────────────────────
SELECT
  'C8: cross-chain isolation (zero customers in multiple chains)' AS check,
  (SELECT leaked_customers FROM cross_chain_check)::text AS actual,
  '0' AS expected,
  (SELECT leaked_customers FROM cross_chain_check) = 0 AS pass
ORDER BY 1;
