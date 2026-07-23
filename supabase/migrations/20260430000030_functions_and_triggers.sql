-- =============================================================================
-- Database functions & triggers
--
-- Covers spec workflows:
--   Functions: wf-038 cleanup_expired_sessions (already in session schema),
--              wf-039 create_default_wishlist,
--              wf-040 ensure_single_default_address,
--              wf-041 handle_new_user,
--              wf-042 log_audit_event,
--              wf-043 sync_inventory_from_variant,
--              wf-044 update_cart_totals
--   Triggers:  wf-141 on_address_default_change,
--              wf-142 on_auth_user_created,
--              wf-143 on_cart_item_change,
--              wf-144 on_user_profile_created,
--              wf-145 on_variant_inventory_change
-- =============================================================================

-- ---------------------------------------------------------------------------
-- log_audit_event(actor_id, action, resource_type, resource_id, metadata)
-- Inserts an audit row; SECURITY DEFINER so callers don't need direct INSERT
-- privilege on audit_events.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_actor_id uuid,
  p_actor_type text,
  p_action text,
  p_resource_type text,
  p_resource_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL,
  p_ip_address inet DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO public.audit_events (
    actor_id, actor_type, action, resource_type, resource_id, metadata, ip_address
  )
  VALUES (
    p_actor_id, p_actor_type, p_action, p_resource_type, p_resource_id, p_metadata, p_ip_address
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_new_user — fires on auth.users INSERT to create user_profile + cart shells
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, first_name, last_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'first_name',
    NEW.raw_user_meta_data ->> 'last_name'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Assign default 'customer' role.
  INSERT INTO public.user_roles (user_id, role_id)
  SELECT NEW.id, r.id
  FROM public.roles r
  WHERE r.name = 'customer'
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- create_default_wishlist — fires on user_profiles INSERT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_default_wishlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.wishlists (user_id, name, is_default)
  VALUES (NEW.id, 'Λίστα επιθυμιών', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_user_profile_created ON public.user_profiles;
CREATE TRIGGER on_user_profile_created
  AFTER INSERT ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_wishlist();

-- ---------------------------------------------------------------------------
-- ensure_single_default_address — when an address is set is_default_billing/
-- is_default_shipping, clear the flag from the user's other addresses.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_single_default_address()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_default_billing = true THEN
    UPDATE public.addresses
       SET is_default_billing = false
     WHERE user_id = NEW.user_id
       AND id <> NEW.id
       AND is_default_billing = true;
  END IF;

  IF NEW.is_default_shipping = true THEN
    UPDATE public.addresses
       SET is_default_shipping = false
     WHERE user_id = NEW.user_id
       AND id <> NEW.id
       AND is_default_shipping = true;
  END IF;

  IF NEW.is_default = true THEN
    UPDATE public.addresses
       SET is_default = false
     WHERE user_id = NEW.user_id
       AND id <> NEW.id
       AND is_default = true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_address_default_change ON public.addresses;
CREATE TRIGGER on_address_default_change
  AFTER INSERT OR UPDATE OF is_default, is_default_billing, is_default_shipping
  ON public.addresses
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_single_default_address();

-- ---------------------------------------------------------------------------
-- update_cart_totals — recompute carts.subtotal & item_count when cart_items change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_cart_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_cart_id uuid;
BEGIN
  affected_cart_id := COALESCE(NEW.cart_id, OLD.cart_id);

  UPDATE public.carts
     SET subtotal = COALESCE((
           SELECT SUM(unit_price * quantity)
             FROM public.cart_items
            WHERE cart_id = affected_cart_id
         ), 0),
         item_count = COALESCE((
           SELECT SUM(quantity)
             FROM public.cart_items
            WHERE cart_id = affected_cart_id
         ), 0),
         updated_at = now()
   WHERE id = affected_cart_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS on_cart_item_change ON public.cart_items;
CREATE TRIGGER on_cart_item_change
  AFTER INSERT OR UPDATE OR DELETE ON public.cart_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_cart_totals();

-- ---------------------------------------------------------------------------
-- sync_inventory_from_variant — auto-create inventory_items row when a new
-- variant is inserted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_inventory_from_variant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.inventory_items (variant_id, quantity_available, quantity_reserved)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT (variant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_variant_inventory_change ON public.product_variants;
CREATE TRIGGER on_variant_inventory_change
  AFTER INSERT ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_inventory_from_variant();
