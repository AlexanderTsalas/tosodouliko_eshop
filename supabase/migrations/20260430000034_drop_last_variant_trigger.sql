-- =============================================================================
-- Drop the prevent_last_variant_deletion trigger.
--
-- The trigger fired on every product_variants DELETE, including the CASCADE
-- deletes triggered by deleting the parent product. That blocked product
-- deletion entirely once you tried to delete the last surviving variant
-- mid-cascade.
--
-- The "every product has at least one variant" rule is now enforced solely
-- at the application layer (in src/actions/variants/deleteVariant.ts), which
-- is sufficient because:
--   - The product create form requires variants up-front (atomic).
--   - The variants editor's delete button calls deleteVariant which checks
--     the count and surfaces a friendly error.
--   - The deleteProduct action handles the cascade correctly without the
--     trigger interfering.
-- =============================================================================

DROP TRIGGER IF EXISTS on_variant_delete_check_last ON public.product_variants;
DROP FUNCTION IF EXISTS public.prevent_last_variant_deletion();
