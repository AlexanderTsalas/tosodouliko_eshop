-- =============================================================================
-- ONE-OFF CLEANUP — wipes test order data + all non-admin users/customers so
-- the database is ready for a fresh round of end-to-end testing.
--
-- ⚠ DESTRUCTIVE. Read before running. ⚠
--
-- Preserves the single admin auth user identified by v_admin_email (set at
-- the top of the DO block). Aborts if that email isn't found in auth.users —
-- safer to fail than wipe everyone.
--
-- Deletion order (FK dependency chain matters):
--
--   1. payment_intents       — CASCADE to payment_transactions.
--   2. cart_checkout_sessions — CASCADE to soft_waits.
--   3. priority_holds        — explicit (no cascade path from orders).
--   4. soft_waits            — defensive (step 2 cascade should empty).
--   5. orders                — ALL rows (user confirmed all orders are test).
--                              CASCADE to order_items, shipments,
--                              shipment_events, return_requests, return_items.
--                              orders.customer_id is ON DELETE RESTRICT, so
--                              must happen BEFORE customer deletion.
--   6. inventory_items reset — quantity_reserved + quantity_soft_held to 0.
--   7. customers             — EXCEPT the admin's customer row (matched via
--                              auth_user_id). CASCADE to addresses, wishlist,
--                              etc.
--   8. carts                 — guest carts (user_id IS NULL) + any cart
--                              belonging to non-admin users. Admin's cart,
--                              if any, survives. CASCADE to cart_items.
--   9. auth.users            — EXCEPT the admin. CASCADE to user_profiles,
--                              user_roles, and other auth-linked state.
--  10. audit_events          — rows whose resource_type belongs to the
--                              order/customer surface. Other audit history
--                              (rbac, products, carriers, fees, etc.) stays.
--
-- NOT touched:
--   - delivery_carriers, carrier_provider_configs, couriers_*_cache
--   - products, product_variants, categories, attribute_*
--   - fee_categories, fee_rules
--   - roles, permissions
--   - admin's auth.users row + customers row (if any) + cart (if any)
--   - audit_events for non-order resource_types (preserves admin's carrier-
--     setup / role-management history)
--
-- Recovery: only Supabase point-in-time restore. Take a snapshot first if
-- you have anything you can't recreate.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  -- Change this if the admin account uses a different email.
  v_admin_email   constant text := 'dimitrisfgp@gmail.com';
  v_admin_user_id uuid;
  v_count         integer;
BEGIN
  -- Resolve the admin auth user. Abort if missing — better to fail loud
  -- than to wipe every user including the one running the cleanup.
  SELECT id INTO v_admin_user_id
    FROM auth.users
   WHERE email = v_admin_email
   LIMIT 1;
  IF v_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'Admin user not found in auth.users for email %. Aborting cleanup so the admin is not deleted.', v_admin_email
      USING ERRCODE = 'P0002';
  END IF;
  RAISE NOTICE '[cleanup] preserving admin auth user: % (%)', v_admin_email, v_admin_user_id;

  -- Step 1 — payments (CASCADE to payment_transactions).
  WITH d AS (DELETE FROM public.payment_intents RETURNING 1)
  SELECT count(*) INTO v_count FROM d;
  RAISE NOTICE '[cleanup] payment_intents deleted: % (cascaded to payment_transactions)', v_count;

  -- Step 2 — cart_checkout_sessions (CASCADE to soft_waits).
  WITH d AS (DELETE FROM public.cart_checkout_sessions RETURNING 1)
  SELECT count(*) INTO v_count FROM d;
  RAISE NOTICE '[cleanup] cart_checkout_sessions deleted: %', v_count;

  -- Step 3 — priority_holds.
  WITH d AS (DELETE FROM public.priority_holds RETURNING 1)
  SELECT count(*) INTO v_count FROM d;
  RAISE NOTICE '[cleanup] priority_holds deleted: %', v_count;

  -- Step 4 — soft_waits defensive cleanup.
  WITH d AS (DELETE FROM public.soft_waits RETURNING 1)
  SELECT count(*) INTO v_count FROM d;
  RAISE NOTICE '[cleanup] soft_waits deleted (defensive): %', v_count;

  -- Step 5 — orders (ALL).
  WITH d AS (DELETE FROM public.orders RETURNING 1)
  SELECT count(*) INTO v_count FROM d;
  RAISE NOTICE '[cleanup] orders deleted: % (cascaded to order_items, shipments, shipment_events, return_requests, return_items)', v_count;

  -- Step 6 — inventory counters reset (preserves row identity).
  UPDATE public.inventory_items
     SET quantity_reserved  = 0,
         quantity_soft_held = 0,
         updated_at         = now()
   WHERE quantity_reserved <> 0 OR quantity_soft_held <> 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '[cleanup] inventory_items counters reset on % rows', v_count;

  -- Step 7 — customers EXCEPT admin's. IS DISTINCT FROM also matches
  -- auth_user_id IS NULL (guest customers), which we want to delete.
  WITH d AS (
    DELETE FROM public.customers
     WHERE auth_user_id IS DISTINCT FROM v_admin_user_id
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM d;
  RAISE NOTICE '[cleanup] customers deleted: % (admin preserved)', v_count;

  -- Step 8 — non-admin carts (guest carts + any non-admin user cart).
  WITH d AS (
    DELETE FROM public.carts
     WHERE user_id IS DISTINCT FROM v_admin_user_id
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM d;
  RAISE NOTICE '[cleanup] carts deleted: % (cascaded to cart_items; admin cart preserved)', v_count;

  -- Step 9 — non-admin auth.users. Cascades to user_profiles, user_roles,
  -- and any other auth-linked tables. SET NULL columns (created_by, etc.)
  -- on preserved rows lose attribution but keep their data.
  WITH d AS (
    DELETE FROM auth.users
     WHERE id <> v_admin_user_id
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM d;
  RAISE NOTICE '[cleanup] auth.users deleted: % (admin preserved; cascaded to user_profiles, user_roles, etc.)', v_count;

  -- Step 10 — order/customer-related audit_events. Other audit history
  -- (admin's carrier setup, role grants, fee config, etc.) stays.
  WITH d AS (
    DELETE FROM public.audit_events
     WHERE resource_type IN (
       'order',
       'payment_intent',
       'shipment',
       'return_request',
       'cart_checkout_session',
       'customer',
       'soft_wait',
       'pending_wishlist_notification'
     )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM d;
  RAISE NOTICE '[cleanup] audit_events deleted (order-related resource_types): %', v_count;
END $$;

COMMIT;
