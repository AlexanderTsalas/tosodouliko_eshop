-- =============================================================================
-- wf-023 — RBAC schema
-- Tables: permissions, roles, role_permissions, user_roles
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  resource text NOT NULL,
  action text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource, action),
  UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_permissions_resource_action
  ON public.permissions(resource, action);

CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roles_name ON public.roles(name);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id
  ON public.role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id
  ON public.role_permissions(permission_id);

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id
  ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id
  ON public.user_roles(role_id);

-- =============================================================================
-- RLS policies
-- =============================================================================

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "permissions_select_authenticated"
  ON public.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "permissions_admin_write"
  ON public.permissions FOR ALL TO authenticated
  USING (public.has_permission('manage:roles'))
  WITH CHECK (public.has_permission('manage:roles'));

CREATE POLICY "roles_select_authenticated"
  ON public.roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles_admin_write"
  ON public.roles FOR ALL TO authenticated
  USING (public.has_permission('manage:roles'))
  WITH CHECK (public.has_permission('manage:roles'));

CREATE POLICY "role_permissions_select_authenticated"
  ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "role_permissions_admin_write"
  ON public.role_permissions FOR ALL TO authenticated
  USING (public.has_permission('manage:roles'))
  WITH CHECK (public.has_permission('manage:roles'));

CREATE POLICY "user_roles_select_own"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_permission('manage:roles'));
CREATE POLICY "user_roles_admin_write"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_permission('manage:roles'))
  WITH CHECK (public.has_permission('manage:roles'));

-- =============================================================================
-- Replace the stub `has_permission` with the real implementation now that
-- RBAC tables exist. SECURITY DEFINER so the function can read these tables
-- regardless of caller's RLS context.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.has_permission(perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND p.name = perm
  );
$$;

COMMENT ON FUNCTION public.has_permission(text)
IS 'Returns true if auth.uid() has the named permission via user_roles → role_permissions → permissions.';

-- Seed core permissions referenced by RLS policies throughout the schema.
INSERT INTO public.permissions (name, resource, action, description) VALUES
  ('manage:roles', 'roles', 'manage', 'Create/update/delete roles & permissions'),
  ('manage:users', 'users', 'manage', 'Manage user profiles'),
  ('manage:categories', 'categories', 'manage', 'Manage categories'),
  ('manage:products', 'products', 'manage', 'Manage products & variants'),
  ('manage:attributes', 'attributes', 'manage', 'Manage attributes'),
  ('manage:media', 'media', 'manage', 'Manage media library'),
  ('manage:discounts', 'discounts', 'manage', 'Manage discount codes'),
  ('manage:orders', 'orders', 'manage', 'View/edit any order'),
  ('manage:returns', 'returns', 'manage', 'Approve/reject return requests'),
  ('manage:shipping', 'shipping', 'manage', 'Manage shipping zones & rates'),
  ('manage:shipments', 'shipments', 'manage', 'Manage shipments & couriers'),
  ('manage:currencies', 'currencies', 'manage', 'Manage currencies & rates'),
  ('manage:translations', 'translations', 'manage', 'Manage translations'),
  ('manage:seo', 'seo', 'manage', 'Manage SEO metadata'),
  ('manage:newsletter', 'newsletter', 'manage', 'Manage newsletter subscribers'),
  ('manage:chat', 'chat', 'manage', 'Manage live chat sessions as agent'),
  ('read:audit-log', 'audit-log', 'read', 'Read audit events'),
  ('read:errors', 'errors', 'read', 'Read error events'),
  ('read:tracking', 'tracking', 'read', 'Read user tracking events')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.roles (name, description) VALUES
  ('admin', 'Full access to all resources'),
  ('staff', 'Customer service & order fulfillment'),
  ('customer', 'Default authenticated user role')
ON CONFLICT (name) DO NOTHING;

-- Grant ALL seeded permissions to the admin role.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;
