-- =============================================================================
-- Offers engine — Phase 1: backfill from the legacy discount_codes table.
--
-- Converts every legacy row into the new shape:
--   discount_codes row → offers + offer_scopes + offer_rules + offer_codes
--   discount_usage row → order_offer_applications (best-effort; rule_id
--                        comes from the migrated offer's first rule)
--
-- Legacy types map as follows:
--   'percent'       → offer_rules.kind='percent_discount', discount_value=value/100
--   'fixed'         → offer_rules.kind='flat_discount',    discount_value=value
--   'free_shipping' → offer_rules.kind='waive_shipping',   no discount_value
--
-- Every backfilled offer is created with scope_kind='all' (legacy
-- discounts were store-wide). Admins can later add narrower scopes.
--
-- Idempotency: this migration is safe to run once. To re-run during
-- development, manually DELETE the offers it created first.
--
-- The legacy discount_codes and discount_usage tables STAY IN PLACE
-- after this migration — the legacy applyDiscount action still queries
-- them. Phase 4 (when applyDiscount is rewritten) ships a separate
-- migration to drop them.
-- =============================================================================

-- Step 1: backfill offers + their child rows.
WITH legacy AS (
  SELECT
    id,
    code,
    type,
    value,
    usage_limit,
    usage_count,
    expires_at,
    is_active,
    created_at
  FROM public.discount_codes
),
inserted_offers AS (
  INSERT INTO public.offers (
    name,
    description,
    active,
    starts_at,
    ends_at,
    user_type,
    requires_code,
    stacking_mode,
    max_uses_total,
    current_uses,
    enforce_limits,
    created_at,
    updated_at
  )
  SELECT
    'Migrated: ' || legacy.code AS name,
    'Auto-migrated from legacy discount_codes table. Original code: '
      || legacy.code AS description,
    legacy.is_active AS active,
    NULL::timestamptz AS starts_at,     -- legacy had no start gate
    legacy.expires_at AS ends_at,
    'any'::text AS user_type,
    true AS requires_code,              -- legacy required a code to apply
    'exclusive_within_kind'::text AS stacking_mode,
    legacy.usage_limit AS max_uses_total,
    legacy.usage_count AS current_uses,
    -- Legacy table refused past usage_limit, so preserve HARD semantics
    -- only when a limit was actually set.
    (legacy.usage_limit IS NOT NULL) AS enforce_limits,
    legacy.created_at AS created_at,
    legacy.created_at AS updated_at
  FROM legacy
  RETURNING id, name
),
-- Re-derive the legacy_id ↔ new_offer_id pairing. We need this because
-- INSERT INTO ... SELECT can't return both columns simultaneously, and
-- the name field is the only stable link.
mapping AS (
  SELECT
    io.id AS new_offer_id,
    SUBSTRING(io.name FROM 'Migrated: (.*)$') AS legacy_code,
    legacy.id AS legacy_id,
    legacy.type AS legacy_type,
    legacy.value AS legacy_value
  FROM inserted_offers io
  JOIN legacy ON legacy.code = SUBSTRING(io.name FROM 'Migrated: (.*)$')
),
-- Step 2a: every offer gets a store-wide scope (legacy was store-wide).
inserted_scopes AS (
  INSERT INTO public.offer_scopes (offer_id, scope_kind, resource_id)
  SELECT new_offer_id, 'all', NULL FROM mapping
  RETURNING offer_id
),
-- Step 2b: one rule per offer, kind based on the legacy type column.
inserted_rules AS (
  INSERT INTO public.offer_rules (
    offer_id,
    active,
    kind,
    discount_value,
    waive_customer_charge
  )
  SELECT
    m.new_offer_id,
    true,
    CASE m.legacy_type
      WHEN 'percent'        THEN 'percent_discount'
      WHEN 'fixed'          THEN 'flat_discount'
      WHEN 'free_shipping'  THEN 'waive_shipping'
    END,
    CASE m.legacy_type
      -- Legacy percent column stored "20" for 20%, new column stores 0.20
      WHEN 'percent'        THEN m.legacy_value / 100.0
      WHEN 'fixed'          THEN m.legacy_value
      WHEN 'free_shipping'  THEN NULL
    END,
    CASE m.legacy_type
      WHEN 'free_shipping'  THEN true
      ELSE NULL
    END
  FROM mapping m
  RETURNING id, offer_id
),
-- Step 2c: re-create the code itself pointing at the new offer.
inserted_codes AS (
  INSERT INTO public.offer_codes (code, offer_id, active, created_at)
  SELECT
    m.legacy_code,
    m.new_offer_id,
    true,
    now()  -- code creation time was lost in the legacy schema; use now
  FROM mapping m
  RETURNING id, offer_id
)
-- Step 3: discount_usage history → order_offer_applications.
-- We need: order_id (legacy had it), offer_id (mapping), rule_id (one
-- per offer from inserted_rules), code_id (from inserted_codes), and
-- amount_off (legacy amount_applied).
-- Currency is hardcoded EUR for migrated rows; if the store ever
-- supported multi-currency historically, this needs adjustment.
INSERT INTO public.order_offer_applications (
  order_id,
  offer_id,
  rule_id,
  code_id,
  amount_off,
  currency,
  applied_at,
  line_allocations
)
SELECT
  du.order_id,
  m.new_offer_id,
  ir.id,
  ic.id,
  du.amount_applied,
  'EUR',
  du.created_at,
  '[]'::jsonb   -- legacy didn't track per-line allocation; v1 OK
FROM public.discount_usage du
JOIN public.discount_codes legacy_dc ON legacy_dc.id = du.discount_id
JOIN mapping m ON m.legacy_id = legacy_dc.id
JOIN inserted_rules ir ON ir.offer_id = m.new_offer_id
JOIN inserted_codes ic ON ic.offer_id = m.new_offer_id
WHERE du.order_id IS NOT NULL;  -- legacy had nullable order_id; skip orphans

-- ---------------------------------------------------------------------------
-- Sanity assertions — fail loudly if the row counts don't line up.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  legacy_count   integer;
  migrated_count integer;
BEGIN
  SELECT count(*) INTO legacy_count FROM public.discount_codes;
  SELECT count(*) INTO migrated_count FROM public.offers
    WHERE name LIKE 'Migrated: %';
  IF legacy_count != migrated_count THEN
    RAISE EXCEPTION
      'Backfill row-count mismatch: legacy discount_codes=%, migrated offers=%',
      legacy_count, migrated_count;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
