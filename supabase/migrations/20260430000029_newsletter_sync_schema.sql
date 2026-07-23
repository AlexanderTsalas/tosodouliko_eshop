-- =============================================================================
-- wf-019 — Newsletter sync schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'subscribed',
  provider_id text,
  consent_at timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('subscribed', 'unsubscribed', 'pending'))
);

CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_email
  ON public.newsletter_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_status
  ON public.newsletter_subscribers(status);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_user_id
  ON public.newsletter_subscribers(user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Anonymous sign-up allowed.
CREATE POLICY "newsletter_subscribers_insert_anyone"
  ON public.newsletter_subscribers FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "newsletter_subscribers_select_admin"
  ON public.newsletter_subscribers FOR SELECT TO authenticated
  USING (public.has_permission('manage:newsletter'));

CREATE POLICY "newsletter_subscribers_update_admin"
  ON public.newsletter_subscribers FOR UPDATE TO authenticated
  USING (public.has_permission('manage:newsletter'))
  WITH CHECK (public.has_permission('manage:newsletter'));
