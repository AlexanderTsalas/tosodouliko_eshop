-- =============================================================================
-- Re-key wishlists + wishlist_items off `customer_id` instead of `user_id`.
--
-- Background: every other contention/notification table (orders, soft_waits,
-- priority_holds, pending_wishlist_notifications, collapse_notifications)
-- references customers.id. The wishlist tables were the lone holdout
-- referencing auth.users.id directly, which caused:
--
--   * Cross-feature code had to translate auth.users.id <-> customers.id at
--     every boundary (collapse modal, restock dispatcher, admin queue page).
--   * dispatchNotifications silently broke on a stale SELECT for
--     wishlist_items.customer_id (the author wrote what the convention
--     implied; the schema disagreed).
--
-- Auth-only enforcement moves from the FK layer to the RLS layer: the policy
-- `customer_id IN (SELECT id FROM customers WHERE auth_user_id = auth.uid())`
-- gives the same effective "must be logged in" guarantee, just routed
-- through the canonical identity. Service-role bypass is the only loosened
-- invariant; that's an admin-code concern, not a user-facing one.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 0: drop the old trigger that fires on user_profiles INSERT. The
-- replacement fires on customers INSERT (later in this file), which is the
-- right semantic anchor — "every auth-linked customer gets a default
-- wishlist" — and naturally serializes after sync_customer_from_profile.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_user_profile_created ON public.user_profiles;

-- -----------------------------------------------------------------------------
-- Step 1: wishlists — add customer_id, backfill, swap policies/indexes, drop
-- user_id.
-- -----------------------------------------------------------------------------
ALTER TABLE public.wishlists
  ADD COLUMN IF NOT EXISTS customer_id uuid
    REFERENCES public.customers(id) ON DELETE CASCADE;

-- Backfill via the auth_user_id link. Customers were promoted to the primary
-- identity in 20260518000001; every authenticated wishlist owner has a row.
UPDATE public.wishlists w
SET customer_id = c.id
FROM public.customers c
WHERE c.auth_user_id = w.user_id
  AND w.customer_id IS NULL;

-- Defensive cleanup: any wishlist row whose user has no customers row is
-- already inaccessible (customers table is mandatory for auth users since
-- 20260518000001). Drop them so we can NOT NULL the new column.
DELETE FROM public.wishlists WHERE customer_id IS NULL;

ALTER TABLE public.wishlists ALTER COLUMN customer_id SET NOT NULL;

-- Indexes flip from user_id to customer_id.
DROP INDEX IF EXISTS public.idx_wishlists_user_id;
DROP INDEX IF EXISTS public.uq_wishlists_user_default;
CREATE INDEX IF NOT EXISTS idx_wishlists_customer_id
  ON public.wishlists(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wishlists_customer_default
  ON public.wishlists(customer_id) WHERE is_default = true;

-- RLS policies: drop user_id-scoped, recreate customer_id-scoped. The
-- "auth-only" invariant still holds — the subquery in USING/WITH CHECK
-- requires the row's customer to be linked to auth.uid().
DROP POLICY IF EXISTS "wishlists_select_own_or_public" ON public.wishlists;
DROP POLICY IF EXISTS "wishlists_modify_own" ON public.wishlists;

CREATE POLICY "wishlists_select_own_or_public"
  ON public.wishlists FOR SELECT TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM public.customers WHERE auth_user_id = auth.uid()
    )
    OR is_public = true
  );

CREATE POLICY "wishlists_modify_own"
  ON public.wishlists FOR ALL TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM public.customers WHERE auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    customer_id IN (
      SELECT id FROM public.customers WHERE auth_user_id = auth.uid()
    )
  );

ALTER TABLE public.wishlists DROP COLUMN user_id;

-- -----------------------------------------------------------------------------
-- Step 2: wishlist_items — same swap. UNIQUE constraint also moves over.
-- -----------------------------------------------------------------------------
ALTER TABLE public.wishlist_items
  ADD COLUMN IF NOT EXISTS customer_id uuid
    REFERENCES public.customers(id) ON DELETE CASCADE;

UPDATE public.wishlist_items wi
SET customer_id = c.id
FROM public.customers c
WHERE c.auth_user_id = wi.user_id
  AND wi.customer_id IS NULL;

DELETE FROM public.wishlist_items WHERE customer_id IS NULL;

ALTER TABLE public.wishlist_items ALTER COLUMN customer_id SET NOT NULL;

-- Drop the auto-named UNIQUE on (user_id, product_id, variant_id) and
-- recreate on (customer_id, product_id, variant_id).
ALTER TABLE public.wishlist_items
  DROP CONSTRAINT IF EXISTS wishlist_items_user_id_product_id_variant_id_key;

ALTER TABLE public.wishlist_items
  ADD CONSTRAINT wishlist_items_customer_id_product_id_variant_id_key
  UNIQUE (customer_id, product_id, variant_id);

DROP POLICY IF EXISTS "wishlist_items_modify_own" ON public.wishlist_items;
CREATE POLICY "wishlist_items_modify_own"
  ON public.wishlist_items FOR ALL TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM public.customers WHERE auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    customer_id IN (
      SELECT id FROM public.customers WHERE auth_user_id = auth.uid()
    )
  );

ALTER TABLE public.wishlist_items DROP COLUMN user_id;

-- -----------------------------------------------------------------------------
-- Step 3: replace create_default_wishlist trigger. Fires on customers INSERT
-- when the new row is auth-linked. Anchors the trigger to the canonical
-- identity table and removes the trigger-firing-order fragility that the
-- old user_profiles-INSERT trigger had (it fired before sync_customer_from_profile,
-- which after the rekey would have meant inserting a wishlist before its
-- customer row existed).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_default_wishlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Wishlists are an auth-only feature. Offline-only customer rows (no
  -- auth_user_id) don't get one; if the admin later links them to an auth
  -- user, the UPDATE-side trigger below handles it.
  IF NEW.auth_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.wishlists (customer_id, name, is_default)
  VALUES (NEW.id, 'Λίστα επιθυμιών', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_customer_created ON public.customers;
CREATE TRIGGER on_customer_created
  AFTER INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.create_default_wishlist();

-- Offline customer becomes auth-linked later: same wishlist creation logic.
CREATE OR REPLACE FUNCTION public.create_default_wishlist_on_auth_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.auth_user_id IS NOT NULL AND OLD.auth_user_id IS NULL THEN
    INSERT INTO public.wishlists (customer_id, name, is_default)
    VALUES (NEW.id, 'Λίστα επιθυμιών', true)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_customer_auth_linked ON public.customers;
CREATE TRIGGER on_customer_auth_linked
  AFTER UPDATE OF auth_user_id ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.create_default_wishlist_on_auth_link();

COMMENT ON FUNCTION public.create_default_wishlist IS
  'Trigger function: creates a default wishlist for every auth-linked customer row at INSERT time. Companion function create_default_wishlist_on_auth_link handles the case where an offline customer is later linked to an auth account.';
