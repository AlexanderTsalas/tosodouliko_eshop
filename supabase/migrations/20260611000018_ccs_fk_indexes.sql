-- =============================================================================
-- Follow-up Phase 4 — cart_checkout_sessions FK indexes.
--
-- Background:
--   `cart_checkout_sessions.order_id` and `payment_intent_id` are FK
--   columns referencing parents with ON DELETE SET NULL. Without an
--   index, the cascade NULL-set scans cart_checkout_sessions
--   sequentially on every parent delete.
--
--   The two delete-paths that exercise this:
--     - `delete_order_safe(p_order_id)` (Phase 3 of the original
--       remediation) — DELETEs the orders row at the end; that triggers
--       the SET NULL on any session referencing that order.
--     - Admin/manual deletes of payment_intents (Stripe-side
--       reconciliation, debugging).
--
--   Partial indexes (WHERE column IS NOT NULL) skip the large NULL
--   portion of the table where sessions never get promoted to a real
--   order/payment_intent — most cart sessions die abandoned, so the
--   NULL portion is the bulk of the table.
--
-- Cost: minimal — these are partial indexes over a relatively small
-- non-null subset.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_ccs_order_id
  ON public.cart_checkout_sessions(order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ccs_payment_intent_id
  ON public.cart_checkout_sessions(payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
