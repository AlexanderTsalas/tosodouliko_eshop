-- =============================================================================
-- Phase 0 of courier-integration-design.md — Carrier model as data
--
-- carrier_provider_configs.carrier was a free-text column with a CHECK
-- constraint hardcoding the built-in slug list. Replace with a foreign key to
-- delivery_carriers(slug) so the integrity is enforced against the data
-- source-of-truth and dropping/adding carriers doesn't require a schema
-- migration to the check expression.
--
-- Note: carrier_provider_configs is for API-integrated carriers ONLY (built-ins
-- with a provider class in code). Custom carriers (is_custom=true) never have
-- a provider config. We don't enforce that at the schema level — the admin
-- form rejects API setup for custom carriers, and the registry's switch
-- statement gracefully returns null for unknown slugs.
-- =============================================================================

-- Drop the old CHECK that hardcoded the built-in slug list.
ALTER TABLE public.carrier_provider_configs
  DROP CONSTRAINT IF EXISTS carrier_provider_configs_carrier_check;

-- Add the FK. ON DELETE RESTRICT — admin shouldn't be able to delete a built-in
-- carrier that has live credentials; they have to delete the provider config
-- first. Custom carriers can't have provider configs so this only affects
-- built-ins (which can't be deleted anyway — see delivery_carriers admin UI
-- rules).
ALTER TABLE public.carrier_provider_configs
  ADD CONSTRAINT carrier_provider_configs_carrier_fkey
  FOREIGN KEY (carrier) REFERENCES public.delivery_carriers(slug) ON DELETE RESTRICT;

COMMENT ON COLUMN public.carrier_provider_configs.carrier IS
  'Foreign key into delivery_carriers(slug). Built-in carriers only — custom carriers (is_custom=true) never have provider configs because there''s no provider class for them.';
