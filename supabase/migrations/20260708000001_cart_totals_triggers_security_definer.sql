-- =============================================================================
-- Fix: deleting an auth user with a non-empty cart fails with
--      "Database error deleting user" (Postgres 42501 permission denied).
--
-- Root cause
-- ----------
-- Deleting a user runs (in GoTrue) as the `supabase_auth_admin` role:
--     DELETE FROM auth.users WHERE id = ...
-- FK cascades fire in this order:
--     auth.users  --ON DELETE CASCADE-->  public.carts
--     public.carts --ON DELETE CASCADE-->  public.cart_items
-- Deleting the cart_items rows fires the AFTER DELETE statement trigger
-- `on_cart_items_change_stmt_delete`, whose function recomputes cart totals
-- with `UPDATE public.carts ...`. That function is SECURITY INVOKER, so the
-- UPDATE runs as `supabase_auth_admin` — a role with NO grant on
-- public.carts — and Postgres raises `permission denied for table carts`.
-- The whole delete transaction aborts, surfaced to the app as GoTrue 500 /
-- "Database error deleting user".
--
-- The failure only occurs when the user actually has cart items (rows for the
-- AFTER DELETE trigger to process), which is why some deletions succeed and
-- others don't.
--
-- Fix
-- ---
-- The three cart-totals trigger functions maintain a DERIVED INVARIANT
-- (carts.subtotal / carts.item_count kept in sync with cart_items) that must
-- hold regardless of which role mutated cart_items — a customer, the service
-- role, a dashboard operator, or `supabase_auth_admin` during a cascade.
-- Such invariant-maintaining triggers should therefore run with the owner's
-- privileges, i.e. SECURITY DEFINER, not the invoker's. The bodies are
-- unchanged (they only recompute totals from the touched carts; no dynamic
-- SQL, no injectable input), so we flip the security context in place via
-- ALTER FUNCTION and pin a stable search_path (defense-in-depth for DEFINER).
--
-- This fixes user deletion from EVERY path (CMS server action, Supabase
-- dashboard, direct auth admin API) at the root, without granting
-- `supabase_auth_admin` any privilege on application tables and without the
-- app having to know the auth.users dependency graph.
-- =============================================================================

ALTER FUNCTION public.update_cart_totals_stmt_insert()
  SECURITY DEFINER
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.update_cart_totals_stmt_update()
  SECURITY DEFINER
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.update_cart_totals_stmt_delete()
  SECURITY DEFINER
  SET search_path = pg_catalog, public;
