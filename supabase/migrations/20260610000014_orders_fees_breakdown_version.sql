-- =============================================================================
-- Add fees_breakdown_version column to orders for forward-compat reads.
--
-- Background:
--   orders.fees_breakdown is a jsonb array of fee entries. The current
--   shape is:
--     { category_slug, label, display_order, charged, api_quote,
--       source, rule_id }
--
--   If a future change adds a field (e.g. margin_at_charge) or changes
--   semantics (e.g. amounts in cents vs major units), old rows won't
--   have it and code reading them must branch or default. Without a
--   version marker, the only signal is the absence of a field — which
--   is ambiguous (missing because old, vs missing because optional).
--
-- This column:
--   - Defaults to 1 for every new order (and backfills existing rows
--     to 1 — they were written under the v1 contract).
--   - Reader code can branch: `if (order.fees_breakdown_version >= 2) ...`
--   - Purely additive changes don't bump the version. Breaking changes
--     (semantic shifts, removed fields, unit changes) do.
--
-- Doesn't introduce a CHECK constraint on shape — jsonb validation is
-- still the writer's responsibility. The version field is just a
-- migration hint for readers.
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fees_breakdown_version smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.orders.fees_breakdown_version IS
'Schema version of the fees_breakdown jsonb. v1 = original shape (category_slug, label, display_order, charged, api_quote, source, rule_id). Bump on breaking changes (semantic/unit shifts); purely additive changes don''t require a bump.';

NOTIFY pgrst, 'reload schema';
