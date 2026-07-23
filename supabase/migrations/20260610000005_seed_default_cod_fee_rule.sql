-- =============================================================================
-- Seed a baseline COD handling fee rule.
--
-- The fees_foundation migration (20260520000001) created the
-- `cod_handling` category but no rules. Without rules the resolver
-- returns 0 for that line item — which is why selecting "Αντικαταβολή"
-- on the order create form (including for BoxNow, which DOES support
-- COD via payment-link-at-locker) added no surcharge.
--
-- Default rule: €1.80 flat surcharge on any COD order, scope=global,
-- applies to ALL carriers (acs, elta, box_now, speedex, geniki,
-- other) — admins can override per-carrier via more-specific rules
-- (scope=carrier-specific) without losing the baseline.
--
-- Idempotency: skipped when a rule already exists for the cod_handling
-- category at global scope. Admins who've already configured their own
-- rule keep that; only fresh deployments seed the default.
-- =============================================================================

DO $$
DECLARE
  v_cod_cat_id uuid;
  v_has_global_rule boolean;
BEGIN
  -- Resolve the cod_handling category id.
  SELECT id INTO v_cod_cat_id
  FROM public.fee_categories
  WHERE slug = 'cod_handling';

  IF v_cod_cat_id IS NULL THEN
    RAISE NOTICE 'cod_handling fee_category missing — skipping COD rule seed.';
    RETURN;
  END IF;

  -- Don't overwrite admin-configured rules.
  SELECT EXISTS (
    SELECT 1 FROM public.fee_rules
    WHERE fee_category_id = v_cod_cat_id
      AND scope_type = 'global'
      AND active = true
  ) INTO v_has_global_rule;

  IF v_has_global_rule THEN
    RAISE NOTICE 'Global cod_handling rule already exists — skipping seed.';
    RETURN;
  END IF;

  -- Baseline: €1.80 flat, every COD payment, every carrier. The
  -- cod_handling category itself already filters orders by
  -- applies_when.payment_method='cod', so we don't need to restrict
  -- via applies_to_payment_methods on the rule (the category-level
  -- filter handles it).
  INSERT INTO public.fee_rules (
    fee_category_id,
    scope_type,
    scope_id,
    rate_type,
    amount,
    applies_to_payment_methods,
    applies_to_delivery_methods,
    applies_to_carriers,
    priority,
    combination,
    active
  ) VALUES (
    v_cod_cat_id,
    'global',
    NULL,
    'flat',
    1.80,
    NULL,                            -- inherits category-level filter
    NULL,                            -- all delivery methods
    NULL,                            -- all carriers, including box_now
    100,
    'override',
    true
  );
END $$;

NOTIFY pgrst, 'reload schema';
