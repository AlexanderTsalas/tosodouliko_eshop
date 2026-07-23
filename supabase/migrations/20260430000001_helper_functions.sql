-- =============================================================================
-- Helper functions used by RLS policies across the schema.
--
-- `has_permission(perm)` returns true when the current authenticated user has
-- the named permission via their assigned roles. SECURITY DEFINER so the
-- function reads RBAC tables under restrictive RLS policies.
--
-- This file creates a stub that returns `false`. The real implementation is
-- installed by the rbac migration once the user_roles / role_permissions /
-- permissions tables exist. Splitting it this way means later migrations can
-- reference `public.has_permission(text)` in their RLS policies without
-- forward-reference errors.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.has_permission(perm text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT false;
$$;

COMMENT ON FUNCTION public.has_permission(text)
IS 'Stub — replaced by rbac migration once RBAC tables exist.';
