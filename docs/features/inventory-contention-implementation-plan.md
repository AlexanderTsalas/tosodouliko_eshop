# Inventory Contention & Notifications — Implementation Plan

Companion to [inventory-contention-and-notifications.md](./inventory-contention-and-notifications.md). The spec describes *what* we're building; this document describes *how to build it given the actual state of the codebase*.

## Status

**Phases 0–3 shipped. Phases 4 and 8 are the recommended next moves; see "Suggested next steps" at the bottom.**

| Phase | Status | Notes |
|---|---|---|
| 0 — Stripe Checkout Sessions migration | ✅ Shipped | Payment Intents replaced by Checkout Sessions. Mock provider parity. Webhook events: `checkout.session.completed` / `.expired` / `.async_payment_failed`. |
| 1 — Inventory race fix | ✅ Shipped | `reserveAllOrFail` + place-to-pay reservation. `consume_reservation` on Stripe success; `release_reservation` on expiry/failure. **Plus follow-up `20260523000002_inventory_contention_rpcs_fix.sql`** that aligned `hold_soft` / `release_soft` / `effective_available_for` with the existing "unencumbered pool" semantic (the original spec glossary assumed a "gross pool" model; the implementation is correct against the actual `reserve_inventory` semantics). |
| 2 — Soft contention modeling | ✅ Shipped | `cart_checkout_sessions` table. `startCheckoutSession` action wired into cart's "Ολοκλήρωση παραγγελίας". `placeOrder` accepts `checkout_session_id` and uses `promote_soft_to_reserved`. |
| 3 — Contention modal + CTA flipping | ✅ Shipped | 2-option modal (Notify me / Continue without). `addToCartWithContentionCheck` pre-check. Product page CTA flips to "Notify me when available" at `effective_available=0`. Wishlist v2 columns (`notify_on_restock`, `source`, etc.). `subscribeToRestock` action. Plus admin observability surface — "Σε ενεργή αγορά" column on `/admin/inventory` with a warning + confirmation modal when admin edits inventory during active holds (the CMS phantom-inventory bug). |
| 4 — Soft-wait queue + Realtime CTA | ✅ Shipped | 4A: `soft_waits` + `priority_holds` tables, promote/release/consume RPCs, queue-advance + collapse RPCs, priority-hold reaper, wiring into all soft-release paths. `joinSoftWaitQueue` / `leaveSoftWaitQueue` actions. `startCheckoutSession` consumes priority holds; `placeOrder` collapses the queue on soft→hard. 4B: ContentionModal gets the third "Προσθήκη στο καλάθι και αναμονή" option; CartDrawer renders pending/promoted badges, disables Proceed during pending, shows priority-hold countdown. 4C: Supabase Realtime CDC on soft_waits / priority_holds / cart_items; `useCartRealtime` hook drives live cart repaint; collapse modal fires on foreign cart_item delete with self-delete suppression. 4D: inventory_items added to publication; `useVariantInventoryRealtime` + `getEffectiveAvailableAction`; product-page CTA flips live between Add-to-Cart and Notify-me. |
| 5 — Wishlist UI Pattern A | ✅ Shipped | New server actions: `updateWishlistFlags` (per-item flag patches with ownership guard) and `removeWishlistItem` (explicit deletion). `toggleWishlist` extended to return the new row id so the Pattern A chevron-expand panel can immediately configure flags after a silent save. `WishlistButton` rewritten as Pattern A — click adds silently (`♡ Προσθήκη` → `♥ Αποθηκευμένο ▾`); chevron opens an inline panel with checkboxes for `notify_on_sale` and (when out of stock) `notify_on_restock`; Επιβεβαίωση persists via `updateWishlistFlags`. Click-outside collapses; ProductDetailInteractive passes `isUnavailable` derived from the live `effective_available`. New `getWishlistWithProducts` helper enriches wishlist items with product info, variant labels, price, and current availability; `/wishlist` account page now renders a `WishlistItemRow` per item with badges (📦 restock, 🏷️ sales), source attribution, last-notified timestamp, inline per-flag toggles, and Αφαίρεση. |
| 6 — Wishlist notification dispatcher | ✅ Shipped (full path) | `notification_settings` (mode default `automated`) + `pending_wishlist_notifications`. Shared `fireWishlistNotification` helper handles per-subscriber atomic hold + email (with optional admin-message override). `dispatchWishlistNotifications` implements §9.4 sequential/parallel cadence, throttles via `sendBatch` (50/min), one-shots `notify_on_restock=false`. **Triggers**: Stripe abandon (`handleSessionExpired/Failed`), COD-cancel + restore-after-cancel (`transitionOrderStatus`), admin top-up with positive-delta guard (`setInventoryLevel`). **Sequential-cadence advancement**: new `tickleWishlistDispatcher` library + `/api/cron/wishlist-advance` endpoint (CRON_SECRET-gated) scans every minute for variants with subscribers + free inventory + no active wishlist priority hold — picks up where SQL-side `release_expired_priority_holds` leaves off when a 30-min hold lapses unconsumed. Scheduling: optional `20260530000001_wishlist_cron_via_pg_net.sql` uses pg_cron+pg_net to call the endpoint every minute; survives gracefully on projects without either extension (use Vercel Cron / cron-job.org instead). **Remaining tail**: Realtime per-customer broadcasts (Phase 6.5 polish) so an open wishlist page sees the toast ahead of the email; supply-receipt trigger when supply-order workflow lands. |
| 7 — Manual wishlist queue mode | ✅ Shipped | Migration adds `manage:wishlist_queue` permission (auto-granted to admin) and rewrites `pending_wishlist_notifications` + `notification_settings` RLS onto it. New `src/lib/wishlist/fireWishlistNotification` helper extracts the per-subscriber priority-hold + email + audit pattern so admin actions and the existing dispatcher share one code path; also supports the Phase 7 `admin_message` override that replaces the template body. New `src/actions/wishlist-queue/` module: `notifyPending`, `skipPending`, `bulkNotify` (sequential 1.2s pacing, caps at available inventory), `releaseToGeneral`, `updateNotificationMode` — all `requirePermission`-guarded and audit-logged. New `/admin/wishlist-queue` page groups pending rows by variant with subscriber counts + available-now; per-variant bulk actions; per-row Ειδοποίηση / Custom message (textarea dialog) / Skip. `WishlistQueueModeToggle` flips `notification_settings.wishlist_notification_mode` live. Sidebar link gated on `manage:wishlist_queue`. |
| 8 — Background reapers | ✅ Shipped (partial) | Soft-session reaper (`reap_stale_soft_sessions`, every minute via pg_cron). Opportunistic cleanup inline in `hold_soft` / `effective_available_for` (catches both wall-clock-expired AND stale-heartbeat sessions for contested calls). `reconcile_orphan_soft_held` every 5 min for drift from CMS edits / crashed writes. **Plus heartbeat-based liveness**: `last_heartbeat_at` column on `cart_checkout_sessions`, `POST /api/checkout/heartbeat` every 10s from `CheckoutSessionGuard`, `release_stale_heartbeat_sessions` cron every minute (releases sessions silent >30s). The earlier pagehide-beacon experiment was abandoned — no browser signal cleanly distinguishes refresh from close (Chrome's Navigation API `navigate` event doesn't fire on cross-document F5 by spec design). Heartbeat is now the sole liveness source, matching the Stripe / Shopify / Ticketmaster industry pattern. Priority-hold reaper + notification-pending reaper remain pending until Phases 4–6 land. |
| 9 — Guest checkout + anon auth | ✅ Shipped (full) | **9A**: migration relaxes `user_profiles.email NOT NULL`; rewrites `handle_new_user` for anon; adds `auth.users.email`-change trigger that cascades to user_profiles + customers. `useEnsureSession` hook lazily creates anon sessions on first auth-requiring action. `GuestCheckoutPrompt` fallback at `/checkout`. **9C**: `mergeAnonCart` server action — captures anon cart_items, upserts into the permanent user's active cart (sums quantities on variant collision), marks anon cart converted, deletes anon customer row. LoginForm + SignupForm capture the anon uid before auth swap and call merge after success. Defense: server action verifies caller is permanent AND supplied uid is genuinely anonymous before moving anything. **9D**: anon visitors using "Notify me" (ContentionModal + NotifyMeButton) are routed through `EmailUpgradePrompt` first; on submit, `requestAnonEmailUpgrade` sets `customers.email` immediately (so dispatchers can fire) AND queues `auth.updateUser({ email })` for the magic-link confirmation. Subscription completes via the `onUpgraded` callback. **9E**: `SaveInfoPrompt` auto-renders on the checkout success page for anon users — same `EmailUpgradePrompt` shared component with the `save_info` copy variant. **Manual setup step**: enable anonymous sign-ins in the Supabase dashboard. |
| 10 — Polish + edge cases | ✅ Shipped (core) | **§16.1** multi-tab self-contention: `effective_available_for(variant, viewer)` now adds back the viewer's own soft/priority/reserved holds when an auth uid is supplied; `getEffectiveAvailableForVariants` auto-resolves the current request's viewer. **§16.2** cart removal releases active priority holds for that variant. **§16.3** wishlist removal releases active priority holds for that variant. **§16.5** ContentionModal subscribes to inventory_items via `useVariantInventoryRealtime` while open; surfaces a "διαθεσιμότητα άλλαξε" banner when contested items resolve underneath. **§16.6** sign-out is cancel-everything: sweeps active priority holds, pending soft_waits, and active soft sessions for the signing-out customer. **§16.7** already covered by Phase 6 follow-up (transitionOrderStatus release/restore). **§16.9** already covered by Phase 4A consume_priority_to_soft. **§16.10** already covered by dispatcher FIFO ordering. **Admin debug tooling**: `/admin/inventory-debug` with variant lookup (UUID or SKU), per-variant snapshot (counters + active soft sessions + active priority holds + soft-wait queue + notify-subscriber count), force-release server actions audit-logged. Sidebar link. **Remaining**: §16.4 discount-recalc on Continue Without (defer — no discount engine wired into checkout yet); §16.8 supply-receipt trigger (defer — supply-order receipt workflow not yet wired). |

The plan below remains the canonical step-by-step for each phase; sections describing already-shipped phases are retained as a record of what was built.

---

## 0. How this plan was built

A codebase audit ran against the spec to identify (a) what exists and is reusable, (b) what needs to be built from scratch, (c) what in the spec conflicts with existing code and must be reconciled. Six material findings emerged:

1. The codebase uses Stripe **Payment Intents**, not Stripe Checkout Sessions. The spec assumed Sessions (with native `expires_at` and `checkout.session.expired`). Implementation path needs explicit choice.
2. A basic `wishlists` + `wishlist_items` schema **already exists**, but missing all the spec's notification-flag columns.
3. **Zero background-job infrastructure** exists. No `pg_cron`, no Vercel Cron, no scheduled functions. Five reapers + a notification dispatcher all need new infrastructure.
4. `placeOrder` for Stripe **does not reserve inventory at place-to-pay** — decrement happens only at the webhook, leaving the race window the spec is designed to close. Refactoring this is the foundation of the entire feature.
5. **Anonymous Supabase auth is not enabled**, and the `carts.guest_token` column exists in schema but is dead code. The customer trigger does not yet handle anonymous-to-permanent upgrades.
6. **Email infrastructure is synchronous fire-and-forget**, no template system, no batching. Wishlist notifications need both templated copy and rate-limited bulk sends.

Each is addressed in the phases below.

---

## 1. Pre-flight decisions

These must be answered before Phase 1 coding starts.

### 1.1 Stripe path: Payment Intents vs Checkout Sessions

**Context:** the spec assumes Stripe Checkout Sessions (which have a native 30-min `expires_at` and emit `checkout.session.expired` webhooks). The codebase uses Payment Intents (which expire only after ~24 hours of `requires_payment_method` state and have no short-window equivalent).

**Options:**

- **(A) Migrate to Checkout Sessions.** Aligns with spec exactly. Native expiry handling. Cost: refactor `createPaymentIntent` and the existing Stripe flow (~150 LoC plus webhook event changes). Risk: existing Stripe path is working in production; refactor adds regression surface.

- **(B) Stay with Payment Intents, add app-side 30-min reaper.** Less change to working code. The reaper releases reservations on Stripe-session timeout app-side; we can also call `stripe.paymentIntents.cancel()` when the timer fires to keep Stripe state consistent.

**Decision: (A) — migrate to Checkout Sessions.** Per user discussion: the hard contention model conceptually depends on the customer leaving the site to enter Stripe's hosted checkout. The redirect-to-Stripe boundary is what makes "hard contention starts here" semantically clean and ties it to an external state. Plus Stripe's native `expires_at` + `checkout.session.expired` webhook eliminate a class of bespoke timer infrastructure we'd otherwise have to build for the 30-min hard-contention window.

This adds a **Phase 0 — Stripe Checkout Sessions migration** prerequisite before Phase 1. See §2A below.

### 1.2 Background job infrastructure

**Options:**

- **pg_cron** (Postgres extension): runs SQL on a schedule. Native to Supabase paid tiers. Most spec reapers are pure SQL operations, so this is the natural fit.
- **Vercel Cron**: HTTP-triggered scheduled tasks. Limited to ~12 jobs total, max ~10 sec execution. Useful for triggers that need TypeScript logic.
- **Supabase Edge Functions** with cron: full TypeScript, longer windows. Adds Edge Functions to the stack (new infrastructure surface).
- **Hybrid**: pg_cron for pure-SQL reapers, Vercel Cron for the notification dispatcher (which needs `sendEmail` and template rendering — TS-only).

**Recommendation: hybrid.** pg_cron for soft-contention reaper, priority-hold reaper, and soft-wait → wishlist converter (all pure SQL). Vercel Cron for the wishlist notification dispatcher (needs TS) and pending-notification expiry job.

**Decision needed: confirm Supabase tier supports `pg_cron`.** If not, all jobs go through Vercel Cron.

### 1.3 Wishlist schema upgrade

**Context:** the existing `wishlists` table is a parent (named lists, public/private). `wishlist_items` is a basic favourites table.

**Options:**

- **(A) Keep parent `wishlists` table, extend `wishlist_items`.** Customers can have named lists ("Birthday gifts"). Notification flags go on `wishlist_items`.
- **(B) Drop parent, flatten to one wishlist per customer.** Simpler model, matches spec wording directly. Loses the named-lists feature even though it already exists.

**Recommendation: (A).** Named lists are a legitimate feature; dropping them is destructive. Notification flags belong on the individual item anyway, so the parent table is orthogonal.

### 1.4 Email template system

**Options:**

- **Inline TypeScript template functions**: one function per email type, returning `{ subject, text, html }`. Lightweight, no new deps.
- **`react-email` or `mjml`**: full template rendering with React-style components.

**Recommendation: inline functions.** The spec has 3-4 distinct emails total. A template library is overkill. If we ever scale to 20+ templates, revisit.

### 1.5 Permission for wishlist queue management

**Recommendation:** new permission `manage:wishlist_queue`. Granted to `admin` role by default. Used for `/admin/wishlist-queue` access and `pending_wishlist_notifications` RLS.

---

## 2A. Phase 0 — Stripe Checkout Sessions migration

**Goal:** replace the existing Stripe Payment Intents flow with Stripe Checkout Sessions. This is the prerequisite for Phase 1 because the inventory contention model depends on Stripe's native `expires_at` + `checkout.session.expired` webhook for the 30-min hard-contention window.

**Independently shippable:** yes. Customers see a slightly different checkout flow (redirect to a Stripe-hosted page instead of inline Stripe Elements form). Inventory behavior unchanged from current state.

**Risk level:** Medium. Changes the working payment path; full QA pass required.

### 2A.1 Naming collision resolution

The spec and §3 below use `checkout_sessions` as our internal Phase 2 (soft contention) tracking table. Stripe also has "Checkout Sessions" as a first-class concept. To avoid confusion in code, **rename our internal table to `cart_checkout_sessions`** throughout. All subsequent references in this plan to the spec's "checkout_sessions" should be read as "cart_checkout_sessions."

### 2A.2 Migrations

`supabase/migrations/20260521120000_payment_checkout_sessions.sql`:
- Extend `payment_intents` (rather than replacing) so historical Payment Intent rows remain queryable. Add columns:
  - `stripe_checkout_session_id text UNIQUE NULL`
  - `checkout_session_url text NULL`
  - `checkout_session_expires_at timestamptz NULL`
- Extend the `status` enum / CHECK to include `'session_pending'`, `'session_expired'`.
- Optional: rename the table to `payment_sessions` at the end of the migration once new code is fully live (deferred — keep the old name for migration safety).

### 2A.3 Provider refactor

[src/lib/payment/providers/stripe.ts](../../src/lib/payment/providers/stripe.ts):
- Method `createIntent` → `createCheckoutSession`. Calls `stripe.checkout.sessions.create()` with:
  - `mode: 'payment'`
  - `line_items` built from order rows (name, amount, quantity)
  - `success_url: ${SITE_URL}/checkout/success/{ORDER_ID}?session_id={CHECKOUT_SESSION_ID}`
  - `cancel_url: ${SITE_URL}/cart`
  - `expires_at: now + 30 min`
  - `metadata: { order_id }`
- Returns `{ session_id, url, expires_at }`.

[src/lib/payment/providers/mock.ts](../../src/lib/payment/providers/mock.ts):
- Mirrors the new interface — returns a fake `url` pointing at a mock checkout page (e.g., `/mock-stripe/{session_id}`).

The shared `PaymentProvider` TypeScript interface is updated accordingly. Old method names retained as deprecated aliases for the transition period if helpful.

### 2A.4 Server action update

`src/actions/payment/createCheckoutSession.ts` (renamed from `createPaymentIntent.ts`, or new file with old kept as deprecated alias):
- Same shape, but returns `{ url, session_id }` for the client to redirect to.
- Persists the session metadata into `payment_intents` (via the new columns from 2A.2).

### 2A.5 Frontend

Existing Stripe Elements payment form on `/checkout` is replaced with a single "Continue to payment" button:
- Click → calls `createCheckoutSession` → receives `url` → `window.location.href = url`.
- After payment, Stripe redirects back to `/checkout/success/{order_id}` (or `/cart` on cancel).
- The success page reads `?session_id={CHECKOUT_SESSION_ID}` to confirm and show the order.

This removes the in-page Stripe iframe entirely. Substantial simplification.

### 2A.6 Webhook handler

[src/app/api/webhooks/stripe/route.ts](../../src/app/api/webhooks/stripe/route.ts):
- Add cases:
  - `checkout.session.completed` → success path (replaces current `payment_intent.succeeded` for new sessions). Calls a refactored `handleSessionCompleted` shared handler.
  - `checkout.session.expired` → triggers reservation release + wishlist queue activation (Phase 6+ once those land; for Phase 0 just release inventory if a reservation was held).
  - `checkout.session.async_payment_failed` → failure path.
- Existing `payment_intent.*` handlers stay during transition for any in-flight intents; can be retired after migration completes and a grace period passes.

### 2A.7 Mock webhook update

[src/app/api/webhooks/mock-payment/route.ts](../../src/app/api/webhooks/mock-payment/route.ts):
- Adapts to accept `session_id` instead of `intent_id`. Routes to the same shared `handleSessionCompleted` / `handleSessionExpired` handlers.

### 2A.8 Tests

- E2E: complete checkout end-to-end with Stripe test card.
- E2E: abandoned checkout — start session, don't complete, wait for (or trigger) `checkout.session.expired`, verify state and webhook handler.
- E2E: failed payment — Stripe test card that declines, verify `checkout.session.async_payment_failed` path.
- Regression sweep: every payment-method × delivery-method × source combination still works.

### 2A.9 LoC estimate

~300.

### 2A.10 Validation checklist before Phase 1 starts

- [ ] All payment-method × delivery-method × source combinations verified working in staging.
- [ ] `checkout.session.expired` confirmed firing in test (use Stripe CLI to trigger or wait out a short-expiry session).
- [ ] Mock provider parity verified for development/CI.
- [ ] Rollback procedure documented (revert provider methods + frontend; old Payment Intent path stays in code during transition).

---

## 2. Phase 1 — Foundation: atomic inventory primitives

**Goal:** prevent the existing race condition by reserving at place-to-pay for Stripe orders. This phase alone ships a meaningful customer-facing fix — overcharged customers go from "happens occasionally with no auto-handling" to "structurally impossible."

**Independently shippable:** yes. Customers benefit immediately.

### 2.1 Migrations

`supabase/migrations/20260522000001_inventory_contention_columns.sql`:
- `ALTER TABLE inventory_items ADD COLUMN quantity_soft_held integer NOT NULL DEFAULT 0`
- `ALTER TABLE inventory_items ADD COLUMN quantity_priority_held integer NOT NULL DEFAULT 0`
- CHECK constraints: both `>= 0`
- Drop the constraint `quantity_available - quantity_reserved` could be supplemented with a generated column `effective_available` if useful

`supabase/migrations/20260522000002_inventory_contention_rpcs.sql`:
- `hold_soft(p_variant_id uuid, p_qty integer)` — atomic UPDATE incrementing `quantity_soft_held` with guard `effective_available >= p_qty`, raises `INSUFFICIENT_INVENTORY`.
- `release_soft(p_variant_id uuid, p_qty integer)` — atomic UPDATE decrementing `quantity_soft_held`, guard `quantity_soft_held >= p_qty`.
- `promote_soft_to_reserved(p_variant_id uuid, p_qty integer)` — single transaction: decrement soft, increment reserved. Used at "click Pay" transition. The whole point of having this as one RPC is so the transition is atomic across both columns.
- `promote_to_priority(p_variant_id uuid, p_qty integer)` — atomic UPDATE: `quantity_priority_held += p_qty`, decrementing the source counter (either `quantity_available` for fresh wishlist promotion, or `quantity_reserved` for soft-wait promotion — needs two RPC variants or a source parameter).
- `consume_priority(p_variant_id uuid, p_qty integer)` — moves units from `quantity_priority_held` back to whatever target (typically into `quantity_soft_held` when customer adds to cart, or directly to reserved if going straight to checkout).
- `release_priority(p_variant_id uuid, p_qty integer)` — decrement on expiry.

**Follow-up correction**: `supabase/migrations/20260523000002_inventory_contention_rpcs_fix.sql`. After Phase 2 testing surfaced an oversell bug (a unit could complete the full hold→promote→consume lifecycle without `quantity_available` ever being decremented), this migration realigned the new RPCs with the existing "unencumbered pool" model:
- `hold_soft` updated: `quantity_available -= p_qty`, `quantity_soft_held += p_qty` (matching `reserve_inventory`'s pattern).
- `release_soft` updated: inverse of `hold_soft`.
- `effective_available_for` updated: returns `quantity_available` directly (no more subtraction of hold counters — they've already been deducted at claim time).
- `promote_soft_to_reserved` re-stated unchanged (it was correct).

This was a course correction, not new functionality. The original Phase 1 migrations are kept in place; the fix supersedes the function bodies.

`supabase/migrations/20260522000003_effective_available_function.sql`:
- `effective_available_for(p_variant_id uuid, p_viewer_id uuid)` returns integer.
- Returns `quantity_available` directly. Under the canonical bucket model, the `available` column is already net of all hold counters (every claim atomically decrements it), so no additional subtraction is needed.
- The `p_viewer_id` parameter is accepted but currently ignored. Phase 4 of the impl plan will add back the viewer's own hold contributions to address the multi-tab self-contention edge case (spec §16.1).

**Important semantic note:** the original spec glossary described `effective_available = quantity_available − quantity_soft_held − quantity_reserved − quantity_priority_held`. That formula assumed a "gross stock" model where the `available` column was the total physical pool. The implementation uses the "unencumbered pool" model instead (matching the existing `reserve_inventory` semantic that pre-dates Phase 1). The fix migration `20260523000002_inventory_contention_rpcs_fix.sql` aligned the new RPCs with this existing semantic. See [§ Notes — semantic clarification](#notes-semantic-clarification) below.

### 2.2 Stripe path refactor

[src/actions/checkout/placeOrder.ts](../../src/actions/checkout/placeOrder.ts):
- Replace the comment-acknowledged race window at lines 65-68 with actual reservation logic.
- After line items computed, before order insert: loop reserve_inventory for every line item (already done for non-Stripe; remove the if-Stripe-skip).
- If any reservation fails: release all reservations already made (compensating rollback), return failure to customer. Currently the partial-reservation leak is documented; this phase fixes it.
- Order is inserted with `payment_status='pending'`, items already reserved. Webhook will consume on `payment_intent.succeeded`.

[src/lib/payment/handleIntentSucceeded.ts](../../src/lib/payment/handleIntentSucceeded.ts):
- Currently calls `fulfillOrder` which calls `decrement_inventory`.
- New behavior: call `consume_reservation` (moves units out of `quantity_reserved`, decrements `quantity_available`) instead of `decrement_inventory`. The reservation is now the source of truth.

[src/lib/payment/handleIntentFailed.ts](../../src/lib/payment/handleIntentFailed.ts):
- Currently does little inventory-wise.
- New behavior: leave the reservation alone. Stripe will retry the same intent. Reservation expiry handled by reaper (next phase).

`src/app/api/webhooks/stripe/route.ts`:
- Add cases for `payment_intent.canceled` → call new `handleIntentCanceled` that releases the reservation and triggers wishlist queue activation.
- Confirm webhook signature verification is solid (already exists; just sanity check).

### 2.3 Partial-reservation rollback helper

`src/lib/inventory/reserveAllOrFail.ts` (new):
- Takes an array of `{ variant_id, quantity }` pairs.
- Reserves each one. On any failure, releases all previously-reserved items.
- Returns success or detailed failure.
- Replaces the loop in `placeOrder` and `createOrder`.

### 2.4 Tests

- Unit test: `reserveAllOrFail` with concurrent calls (simulate race) — both can't succeed.
- Integration test: two `placeOrder` calls racing for last unit — exactly one succeeds, the other returns OUT_OF_STOCK error before Stripe is contacted.
- Integration test: `payment_intent.succeeded` webhook properly consumes the reservation.
- Integration test: `payment_intent.canceled` webhook properly releases.

### 2.5 LoC estimate

~400. Most of it migrations + the `reserveAllOrFail` helper + webhook event additions.

---

## 3. Phase 2 — Soft contention modeling

**Goal:** add the Phase 2 / Phase 3 distinction. Customers clicking "Proceed to Checkout" enter Phase 2 (soft contention) for up to 15 minutes; clicking "Pay" transitions to Phase 3 (hard reservation, existing path).

**Depends on:** Phase 1.

**Independently shippable:** partially — the soft-contention window improves UX but isn't observable to users without the contention modal (Phase 3 of this plan).

### 3.1 Migrations

`supabase/migrations/20260523000001_checkout_sessions.sql`:
- Table per spec §14.2: `checkout_sessions` with `state enum ('soft', 'hard', 'completed', 'released')`, `expires_at`.
- RLS: customers can read their own; admin can read all via `manage:orders`.
- Index on `expires_at WHERE state='soft'` for the reaper.

### 3.2 New action

`src/actions/checkout/startCheckoutSession.ts`:
- Called when customer clicks "Proceed to Checkout" from cart page.
- Creates a `checkout_sessions` row with `state='soft', expires_at = now() + 15 min`.
- Calls `hold_soft` for each variant in the cart.
- On hold failure (someone else races): contention modal is triggered client-side (see Phase 3 of plan).
- Returns session id; client navigates to `/checkout`.

### 3.3 placeOrder refactor (again)

The current `placeOrder` becomes the Pay click handler — it's invoked from the checkout page when the customer commits to payment.
- Takes a `checkout_session_id` parameter.
- Validates session is owned by caller, state is `soft`, not expired.
- Calls `promote_soft_to_reserved` to atomically convert the holds.
- Proceeds with order creation + Stripe Payment Intent.
- Updates session state to `hard` with `stripe_payment_intent_id`.

### 3.4 Soft contention reaper

To be implemented in Phase 8 (background jobs). For now, stale soft sessions are harmless because they're invisible (no UI surfaces them until Phase 3 of plan). But the reaper is needed before Phase 4 ships, since soft-waiters depend on stale sessions being cleaned up.

### 3.5 Tests

- Integration: Proceed to Checkout creates a session, holds inventory, doesn't yet reserve.
- Integration: Pay click promotes soft to hard, Stripe intent created.
- Integration: Walking back to cart releases the soft session.

### 3.6 LoC estimate

~250.

---

## 4. Phase 3 — Contention modal (no soft-wait queue yet)

**Goal:** customers who lose a race at "Proceed to Checkout" see the contention modal with the three options. Without the soft-wait queue yet, "Add to cart and wait" is dimmed/hidden — customers can only pick Notify me or Continue without.

**Depends on:** Phase 2.

**Independently shippable:** yes. Customers see honest contention feedback even with the simpler 2-option modal.

### 4.1 Frontend components

`src/components/features/contention/ContentionModal.tsx` (new):
- Built on `src/components/ui/dialog.tsx` (Radix Dialog).
- Props: `variantId`, `requestedQuantity`, `availableNow`, `phase` ('soft' | 'hard').
- Renders the 2-option layout (Continue without / Notify me) initially; the Wait option lands in Phase 4 of plan.
- Quantity-aware copy variants per spec §6.3.

`src/components/features/contention/AddToCartWithContentionCheck.tsx` (new):
- Wraps the existing `<AddToCartButton>` logic.
- Server action call: tries to add to cart. On contention error, opens ContentionModal instead of toast.

`src/components/features/checkout/ProceedToCheckoutButton.tsx` (new):
- Replaces the current direct-navigation Proceed button.
- Calls `startCheckoutSession`. On contention error, opens the modal.

### 4.2 New server actions

`src/actions/cart/addToCartWithContentionCheck.ts`:
- Wraps existing `addToCart`.
- Pre-checks `effective_available_for(variant_id, viewer_id)`.
- Returns either success or `{ contention: true, available_now, requested_quantity }` so the client can route to the modal.

`src/actions/wishlist/subscribeToRestock.ts`:
- Idempotent: creates or updates a `wishlist_items` row with `notify_on_restock=true, source='contention_modal'`.
- For guests: requires the inline magic-link signup flow (Phase 9 of plan). For Phase 3-shipping purposes, guests see a "Sign in to subscribe" prompt instead.

### 4.3 Product page CTA flipping

[src/components/features/product-detail/ProductDetailInteractive.tsx](../../src/components/features/product-detail/ProductDetailInteractive.tsx):
- Add `effectiveAvailable` prop from the parent server component.
- Render different button: "Add to Cart" (default), "Notify me when available" (when `effectiveAvailable === 0` due to reservation), "Notify me when back in stock" (when `quantity_available === 0` and no reservations).
- Realtime subscription lands in Phase 4 of plan; for now, this is initial SSR state with no live updates.

### 4.4 Tests

- E2E: stock=1, customer A in soft contention. Customer B clicks Add to Cart → modal shows with correct quantity. B picks "Continue without" → cart unchanged. B picks "Notify me" → wishlist entry created (or sign-in prompt for guests).
- E2E: stock=0 due to hard reservation. Product page shows "Notify me when available" CTA, click → wishlist entry created.

### 4.5 LoC estimate

~500 (mostly frontend components and quantity-aware copy variants).

---

## 5. Phase 4 — Soft-wait queue + Realtime CTA flipping

**Goal:** "Add to cart and wait" option becomes functional. Product page CTA updates in real time. Cart page shows waiting badges and disabled Proceed for queued customers.

**Depends on:** Phase 3.

**Independently shippable:** yes. Power feature; nice-to-have without it, but the spec's full UX requires it.

### 5.1 Migrations

`supabase/migrations/20260524000001_soft_waits.sql`:
- Table per spec §14.2: `soft_waits`.
- FK to `checkout_sessions`, `cart_items`, `product_variants`.
- RLS: customers can read their own; admin can read all.

### 5.2 New server actions

`src/actions/cart/joinSoftWaitQueue.ts`:
- Called from contention modal's "Add to cart and wait" option.
- Inserts the variant into customer's cart at requested quantity.
- Creates a `soft_waits` row tied to the active `checkout_sessions` row (the one A is in).
- Does NOT call `hold_soft` — B's wait doesn't take inventory, only A's soft hold does.

`src/actions/cart/leaveSoftWait.ts`:
- Called when customer removes the contested item from cart while waiting.
- Deletes the `soft_waits` row.

### 5.3 Promotion logic

`src/lib/inventory/promoteFromSoftWait.ts` (new):
- Called when A's `checkout_session` transitions out of `state='soft'` (back-out, timeout, or progression to hard).
- For back-out / timeout: promote first-in-queue B by:
  - Atomically `promote_to_priority` for B's quantity (creates a 5-min priority hold).
  - Notify B via Realtime + email.
  - On B's expiry: promote next in queue.
- For progression to hard (A clicked Pay): collapse all waiters per spec §7.3 — fire collapse modal via Realtime, remove items from waiters' carts, offer wishlist.

### 5.4 Realtime channels

`src/lib/realtime/channels.ts` (new):
- Wraps Supabase Realtime channel subscriptions in typed helpers.
- Channels:
  - `variant:{variant_id}` — public read, broadcasts `effective_available` changes and phase transitions.
  - `customer:{customer_id}` — auth-gated, broadcasts customer-specific events (wait promotion, wishlist notification arrived, etc.).
- Server-side broadcasters in the relevant actions: `placeOrder`, `startCheckoutSession`, the reapers, the wishlist dispatcher.

### 5.5 Frontend Realtime subscriptions

[src/components/features/product-detail/ProductDetailInteractive.tsx](../../src/components/features/product-detail/ProductDetailInteractive.tsx):
- Subscribe to `variant:{variant_id}` on mount.
- Update displayed `effectiveAvailable` and CTA state on broadcasts.

`src/components/features/cart/CartDrawer.tsx` (and `/cart` page):
- Subscribe to `customer:{customer_id}` for the current viewer.
- Update Proceed-to-Checkout button state and per-line "waiting" badges.
- Listen for promotion events → enable Proceed button + show countdown.
- Listen for collapse events → show modal, remove item from cart, offer wishlist.

`src/components/features/contention/ContentionModal.tsx`:
- Now includes the "Add to cart and wait" option.
- Subscribe to relevant channel while modal is open so state changes are reflected live (per spec §6, §16.5).

### 5.6 Tests

- E2E: A in soft contention. B and C both pick "Add to cart and wait." A backs out. B is promoted with 5-min hold. A's session goes through Phase 3 path instead → B and C both see collapse modal.

### 5.7 LoC estimate

~550 (the Realtime infrastructure is non-trivial first-time setup).

---

## 6. Phase 5 — Wishlist schema upgrade + Pattern A UI

**Goal:** existing wishlist gains notification flags and the chevron-expand UI per spec §8.

**Depends on:** Phase 3 (for the wishlist add from contention modal).

**Independently shippable:** yes.

### 6.1 Migrations

`supabase/migrations/20260525000001_wishlist_items_notifications.sql`:
- `ALTER TABLE wishlist_items ADD COLUMN quantity integer NOT NULL DEFAULT 1`
- `ALTER TABLE wishlist_items ADD COLUMN notify_on_restock boolean NOT NULL DEFAULT false`
- `ALTER TABLE wishlist_items ADD COLUMN notify_on_sale boolean NOT NULL DEFAULT false`
- `ALTER TABLE wishlist_items ADD COLUMN source text` with CHECK in `('product_page', 'contention_modal', 'sold_out_page')`
- `ALTER TABLE wishlist_items ADD COLUMN last_notified_at timestamptz`
- `ALTER TABLE wishlist_items ADD COLUMN last_notification_kind text`
- Backfill existing rows: `source='product_page'`, flags `false`.
- Indexes: `(variant_id, notify_on_restock) WHERE notify_on_restock = true` for the dispatcher; `(customer_id, variant_id)` for de-dup checks.
- Note: existing schema uses `user_id`, not `customer_id`. Either add `customer_id` column and dual-key, or rely on the `customers.auth_user_id` join. Recommend the latter — less migration churn.

### 6.2 Updated actions

[src/actions/wishlist/toggleWishlist.ts](../../src/actions/wishlist/toggleWishlist.ts):
- Extend to handle per-flag updates (set `notify_on_restock`, `notify_on_sale`).
- Preserve existing toggle-on-product-page-button behavior as the default (silent save).

`src/actions/wishlist/updateNotificationFlags.ts` (new):
- Customer-side action to flip individual flags from the account page.

### 6.3 Frontend — Pattern A UI

[src/components/features/wishlist/WishlistButton.tsx](../../src/components/features/wishlist/WishlistButton.tsx):
- After silent add, button transforms to "♥ Saved ▾" with a chevron.
- Chevron click expands an inline panel with checkboxes for `notify_on_sale` and `notify_on_restock` (latter only when stock is unavailable).
- Confirm button persists changes.
- Pattern matches spec §8.4 exactly.

`src/app/wishlist/page.tsx`:
- Add per-item badges showing notification flag state.
- Add per-item toggles to enable/disable notifications without removing.
- Display source ("Saved from product page", "Waiting for restock since [date]").

### 6.4 Tests

- E2E: customer saves item from product page → silent save (no notification flags).
- E2E: customer expands chevron, enables notify_on_restock → flag persists, visible in account.
- Integration: contention modal "Notify me when available" creates wishlist entry with `notify_on_restock=true, source='contention_modal'`.

### 6.5 LoC estimate

~350.

---

## 7. Phase 6 — Wishlist notification dispatcher (automated mode only)

**Goal:** when inventory becomes available, wishlist subscribers are notified per the sequential/parallel cadence rule (spec §9.4). Manual mode lands in Phase 7 of plan; this phase ships the automated path.

**Depends on:** Phase 5.

**Independently shippable:** yes, but disable automation by default per spec §11 — admin must explicitly turn on.

### 7.1 Migrations

`supabase/migrations/20260526000001_priority_holds.sql`:
- Table per spec §14.2.
- Index on `expires_at WHERE consumed_at IS NULL` for the reaper.

`supabase/migrations/20260526000002_inventory_release_events.sql`:
- Table per spec §14.2.
- Triggered insertions from: Stripe webhooks (`payment_intent.canceled`, hypothetical `checkout.session.expired`), COD cancellation paths in `transitionOrderStatus`, supply-order receipt actions.

`supabase/migrations/20260526000003_notification_settings.sql`:
- New `notification_settings` table — single-row store for merchant settings.
- Column: `wishlist_notification_mode enum ('automated', 'manual') DEFAULT 'manual'`.
- Pattern matches `email_provider_configs` (one active row, admin-only RLS).

### 7.2 Dispatcher

`src/lib/wishlist/dispatchNotifications.ts` (new):
- Called by event triggers (Stripe webhook, transitionOrderStatus on cancel, supply order receipt).
- Looks up `notification_settings.wishlist_notification_mode`.
- If `automated`: applies sequential/parallel cadence rule (spec §9.4), creates `priority_holds` rows, fires emails + Realtime notifications.
- If `manual`: creates `pending_wishlist_notifications` rows (Phase 7 of plan), does not fire emails.

### 7.3 Email template

`src/lib/email/templates/restockNotification.ts` (new):
- Pure function returning `{ subject, text, html }`.
- Inputs: customer, product, hold_minutes, original_wishlist_date.
- Greek copy per spec §9.6.
- Called by the dispatcher; wraps `sendEmail`.

### 7.4 Email batching

`src/lib/email/batchSender.ts` (new):
- Takes an array of `sendEmail` calls.
- Throttles to ~50/min using a delay-and-retry pattern.
- Used by the dispatcher when multiple notifications fire simultaneously.

### 7.5 Realtime per-customer broadcasts

When a notification fires:
- Email goes out (delayed by batch).
- Realtime broadcast on `customer:{customer_id}` fires immediately — if the customer has the page open, they see the toast/banner ahead of the email.

### 7.6 Tests

- Integration: 5 wishlist subscribers, 10 units restocked → all 5 fire simultaneously (parallel mode), each with own priority hold.
- Integration: 5 wishlist subscribers, 1 unit restocked → first fires, others wait until hold expiry, then next fires.
- Integration: priority hold expires, queue advances.
- Integration: priority hold consumed (customer adds to cart), removed from `priority_holds`.

### 7.7 LoC estimate

~450.

---

## 8. Phase 7 — Manual mode + admin queue UI

**Goal:** merchants who prefer manual control over wishlist notifications have a queue UI.

**Depends on:** Phase 6.

**Independently shippable:** yes.

### 8.1 Migrations

`supabase/migrations/20260527000001_pending_wishlist_notifications.sql`:
- Table per spec §14.2.
- Permission seed: `manage:wishlist_queue` granted to admin role.
- RLS: admin-only via `has_permission('manage:wishlist_queue')`.

### 8.2 Admin actions

`src/actions/wishlist-queue/` (new directory):
- `notifyPending.ts` — fires email + Realtime, engages priority hold.
- `skipPending.ts` — drops from this cycle, wishlist entry persists.
- `customMessageNotify.ts` — fires with admin-composed message instead of template.
- `bulkNotify.ts` — approves all pending in one operation.
- `releaseToGeneral.ts` — drops the queue, inventory becomes generally available.
- All audit-logged per spec §11.4.

### 8.3 Admin UI

`src/app/admin/wishlist-queue/page.tsx` (new):
- Lists variants with pending notifications grouped by variant.
- Per-variant: subscriber count, units available now, expandable to per-subscriber view.
- Per-subscriber actions: notify, skip, custom message.
- Bulk actions: notify all, defer all, release to general.

`src/components/admin/wishlist-queue/CustomMessageDialog.tsx`:
- Textarea for admin-composed message, with preview.

### 8.4 Sidebar entry

[src/components/features/backoffice-shell/AdminSidebar.tsx](../../src/components/features/backoffice-shell/AdminSidebar.tsx):
- Add link to `/admin/wishlist-queue` gated on `manage:wishlist_queue`.
- Optional: badge showing pending count, updated via Realtime on `admin:wishlist-queue` channel.

### 8.5 Tests

- Integration: merchant toggles to manual mode, inventory release fires, pending row created (no email).
- Integration: admin clicks Notify, email fires + priority hold engages.
- Integration: admin custom message — email contains custom body.
- Integration: admin Bulk Notify — all pending fire at once (equivalent to one-time auto burst).

### 8.6 LoC estimate

~400.

---

## 9. Phase 8 — Background jobs (reapers + dispatchers)

**Goal:** all five jobs from spec §15 running on schedule. Without these, soft holds and priority holds accumulate forever and the system slowly fills with stale state.

**Depends on:** Phases 2-7 (jobs operate on tables created in those phases).

**Independently shippable:** all-or-nothing — these MUST be running once Phase 2 lands or soft contentions never time out.

### 9.1 Soft contention reaper (pg_cron)

`supabase/migrations/20260528000001_reap_soft_contention.sql`:
```sql
CREATE FUNCTION reap_soft_contention() RETURNS void AS $$ ... $$;
SELECT cron.schedule('reap-soft-contention', '* * * * *', 'SELECT reap_soft_contention()');
```
- Finds `checkout_sessions WHERE state='soft' AND expires_at < now()`.
- For each: releases holds via `release_soft`, marks session `state='released'`, fires soft-wait promotion logic (NOTIFY broadcast for the app-side dispatcher to pick up).

### 9.2 Priority hold reaper (pg_cron)

`supabase/migrations/20260528000002_reap_priority_holds.sql`:
- Finds `priority_holds WHERE expires_at < now() AND consumed_at IS NULL`.
- For each: calls `release_priority`, advances the queue (next wishlist subscriber for wishlist source, or next soft-wait member for promotion source).

### 9.3 Soft-wait → wishlist auto-converter (pg_cron)

`supabase/migrations/20260528000003_convert_soft_waits.sql`:
- Hourly job.
- Finds `soft_waits` older than 24h where underlying session is in hard state (long COD reservation).
- Converts each to wishlist entry; sends notification email.

### 9.4 Wishlist notification dispatcher trigger (Postgres trigger + Vercel Cron sweeper)

The pure dispatcher logic is TS (template rendering, email send). Approach:
- Postgres trigger on `inventory_release_events` insert calls `pg_notify` with the event.
- Vercel Cron endpoint runs every minute, fetches recent unprocessed events, calls the TS dispatcher.
- Marks events as processed.

Alternative: do everything in TS by hooking the dispatcher into each release-causing action (Stripe webhook, transition action, supply receipt). Simpler, no NOTIFY plumbing. Recommended.

### 9.5 Pending notification expiry (pg_cron)

`supabase/migrations/20260528000004_expire_pending_notifications.sql`:
- Daily.
- Marks `pending_wishlist_notifications` older than 7 days in `status='pending'` as `status='expired'`.

### 9.6 Reconciliation job (optional, recommended)

`supabase/migrations/20260528000005_inventory_reconciliation.sql`:
- Hourly sanity check.
- Verifies that `quantity_soft_held` = sum of active soft-holding session quantities, etc.
- Logs discrepancies to a new `inventory_reconciliation_log` table.
- Doesn't auto-fix — alerts admin.

### 9.7 Tests

- Unit: each reaper function with mocked clock advancing past expiry.
- Integration: end-to-end soft contention → reaper fires → release → wait queue advance → email sent.

### 9.8 LoC estimate

~350.

---

## 10. Phase 9 — Guest checkout + anonymous auth

**Goal:** customers can check out without an account; can wishlist with inline magic-link signup.

**Depends on:** Phases 1-7 (anonymous auth is enabled at the start, but the wishlist + checkout flows already work; this phase makes them work for guests too).

**Independently shippable:** yes, but coupling with checkout means probably ship after Phase 1.

### 10.1 Supabase configuration

Manual step (no code): enable anonymous sign-ins in Supabase dashboard.

### 10.2 Customer trigger update

`supabase/migrations/20260529000001_anonymous_customer_handling.sql`:
- Updates the `sync_customer_from_profile` trigger (or adds a new one) to handle anonymous users:
  - On `auth.users.is_anonymous=true` insert, create a `customers` row with `auth_user_id` set, all PII fields null.
  - On anonymous user upgrade (email added via `auth.updateUser`), update the customers row.

### 10.3 Frontend integration

`src/components/features/checkout/GuestCheckoutPrompt.tsx` (new):
- Shows on `/checkout` if `!authData.user`.
- Two paths: "Sign in or Create account" / "Continue as guest" (latter triggers `signInAnonymously()` invisibly).
- After click, page reloads with auth context.

`src/components/features/wishlist/InlineSignup.tsx` (new):
- Triggered when an anonymous (or unauthenticated) user tries to subscribe to a wishlist.
- Email input + "Send magic link" button.
- Magic link sent via `supabase.auth.signInWithOtp` with `shouldCreateUser=true`.
- Customer clicks link from email → returns to site → wishlist subscription completes.
- Existing flow preserves cart + intent (no navigation away).

### 10.4 Cart preservation across anonymous → authenticated transition

When an anonymous user signs up (or signs in), their cart should merge:
- `src/actions/cart/mergeOnAuth.ts` (new): called by an auth-state-change hook.
- Merges anonymous user's `carts` row into authenticated user's existing active cart (if any).

### 10.5 Tests

- E2E: guest user lands on checkout, clicks Continue as guest, completes COD order.
- E2E: guest user wishlists from product page → magic link flow → returns and wishlist subscription is recorded.
- E2E: guest user with items in cart signs in → cart merges with their existing cart.

### 10.6 LoC estimate

~400.

---

## 11. Phase 10 — Polish, edge cases, operational tooling

**Goal:** all 10 edge cases in spec §16 covered. Operational debugging tools for the admin. Reconciliation visibility.

**Depends on:** all prior phases.

**Independently shippable:** yes.

### 11.1 Edge case handlers

| Spec edge case | Implementation |
|---|---|
| §16.1 Multi-tab self-contention | Use `effective_available_for(variant_id, viewer_id)` in product page query (already in Phase 1). |
| §16.2 Customer removes item with priority hold | `leaveCart` action also releases active priority holds. |
| §16.3 Customer deletes wishlist entry mid-hold | `removeFromWishlist` releases hold + advances queue. |
| §16.4 Discount recalc on Continue Without | Return-to-cart flow with re-confirm step, banner explaining new total. |
| §16.5 Stale modal | ContentionModal subscribes to Realtime channel while open; updates live. |
| §16.6 Customer signs out mid-wait | `signOut` action sweeps all active holds belonging to that customer. |
| §16.7 Admin cancels order with hard reservation | `transitionOrderStatus` cancellation branch releases reservation + triggers wishlist queue. |
| §16.8 Supplier restock | Existing supply-order receipt action fires `inventory_release_events` row (already wired in Phase 6). |
| §16.9 Priority hold expires mid-Stripe | When customer adds to cart and starts checkout, priority hold converts to soft hold (via promote_to_priority's inverse). |
| §16.10 Multi-source wishlist queue | FIFO by `created_at` regardless of `source` (already handled in dispatcher logic). |

### 11.2 Admin debugging UI

`src/app/admin/inventory-debug/page.tsx` (new):
- Per-variant inspector showing: current state of all counters, active soft sessions, active priority holds, wait queue, wishlist subscribers.
- Admin can force-release any hold if state looks corrupted.
- Audit-logged.

### 11.3 Tests

- E2E coverage for each edge case above.
- Load test: 50 concurrent customers trying to buy the last unit. Exactly one succeeds, others see contention modal, queue forms, queue resolves correctly.

### 11.4 LoC estimate

~400.

---

## 12. Aggregate scope

| Phase | LoC | Cumulative |
|---|---|---|
| 1 — Foundation | 400 | 400 |
| 2 — Soft contention | 250 | 650 |
| 3 — Contention modal | 500 | 1,150 |
| 4 — Soft-wait queue + Realtime | 550 | 1,700 |
| 5 — Wishlist v2 schema + Pattern A | 350 | 2,050 |
| 6 — Wishlist dispatcher (automated) | 450 | 2,500 |
| 7 — Manual mode + admin UI | 400 | 2,900 |
| 8 — Background jobs | 350 | 3,250 |
| 9 — Guest checkout + anon auth | 400 | 3,650 |
| 10 — Polish + edge cases | 400 | 4,050 |
| **Total** | **~4,050** | |

Plus tests (~600 LoC). Final estimate: **~4,650 LoC across 25-30 migration files and ~50 new/modified TS files**.

Compared to the spec's original ~2,550 estimate: the additional ~2,000 LoC accounts for the audit findings — anonymous auth + customer trigger update, Stripe webhook event additions, partial-reservation rollback helper, batching infrastructure, debug tooling, and the larger-than-anticipated frontend surface for Realtime CTA flipping.

---

## 13. Suggested rollout sequence

Phases are ordered so each ships value independently:

| Sequence | Phase | Value shipped | Risk level |
|---|---|---|---|
| 1 | Phase 0 | Stripe migration to Checkout Sessions. Foundation for hard-contention 30-min window via native Stripe events. Customer checkout UX changes (redirect to Stripe-hosted page). | Medium (changes working payment path) |
| 2 | Phase 1 | Race condition fixed — overcharged customers go from "happens occasionally" to "structurally impossible." | Low (clean refactor of existing code) |
| 2 | Phase 9 (partial) | Guest checkout enabled (anonymous auth + customer trigger). Phase 9's wishlist parts wait for Phase 5. | Low (additive) |
| 3 | Phase 2 | Soft contention modeling underneath. No customer-visible change yet, but the data shape is now correct. | Low |
| 4 | Phase 8 (partial) | Soft contention reaper running (mandatory after Phase 2). Other reapers wait. | Medium (first pg_cron use) |
| 5 | Phase 3 | Contention modal visible to customers. Losers see honest feedback. | Medium (frontend complexity) |
| 6 | Phase 5 | Wishlist v2 schema + Pattern A UI. Contention modal's "Notify me" path now works fully. | Low |
| 7 | Phase 4 | Soft-wait queue + Realtime CTA flipping. The full UX vision. | High (first Realtime use, many moving parts) |
| 8 | Phase 6 | Wishlist notifications fire automatically when inventory returns. | Medium (email batching new) |
| 9 | Phase 7 | Manual mode + admin queue UI. Merchant control. | Low |
| 10 | Phase 8 (remainder) | All reapers running. | Low |
| 11 | Phase 10 | Edge cases + debug tooling. | Low |

**Hard prerequisite**: Phase 1 must ship before any other phase. Without the reservation-at-place refactor, the rest is decoration on top of a broken foundation.

**Cluster the high-risk pieces** (Phase 4 Realtime, Phase 8 pg_cron) in dedicated work blocks rather than spreading them across multiple deploys. Each is a new infrastructure surface with its own debugging curve.

---

## 14. Risks and mitigations

### 14.1 Realtime adoption risk

First time using Supabase Realtime. Failure modes are subtle:
- Disconnections during long sessions
- Race between subscribe-then-fetch (state read after subscribe might miss events fired between)
- Channel auth quirks with anonymous users

**Mitigations:**
- Build a typed wrapper (`src/lib/realtime/channels.ts`) that encapsulates connection lifecycle, retry, and the subscribe-then-fetch idiom (subscribe first, then fetch initial state, then process buffered events).
- Test reconnection scenarios deliberately during Phase 4 development.
- Have a graceful degradation: if Realtime is unavailable, the UI shows initial state correctly; manual refresh works. No hard dependency on live updates for correctness.

### 14.2 pg_cron unavailable

If Supabase tier doesn't support pg_cron, the SQL reapers need to be reimplemented as Vercel Cron HTTP endpoints calling SQL via the admin client.

**Mitigation:** abstract the reaper logic into pure SQL functions that can be called either by pg_cron or by an HTTP handler. The decision is just which dispatcher invokes them.

### 14.3 Stripe migration ambiguity

If the recommendation in §1.1 is rejected (i.e., user chooses to migrate to Checkout Sessions), Phases 1, 2, and 8 all change shape:
- The `expires_at` lives on Stripe's session, not on our `checkout_sessions` table.
- The reaper is triggered by `checkout.session.expired` webhook instead of pg_cron.
- The Phase 1 refactor of `createPaymentIntent` becomes a larger refactor of the entire Stripe path.

**Mitigation:** decide §1.1 before Phase 1 starts. The downstream phases are stable either way; only Phase 1 changes substantially.

### 14.4 Email deliverability during 30-min priority window

If notifications take 5+ minutes to deliver, the priority window can pass before the customer sees the email. Customer feels betrayed by the promise.

**Mitigations:**
- Realtime push fires in parallel — customers with the site open get it instantly.
- Email delivery monitoring during Phase 6 development to catch slow providers.
- Consider extending the priority window if monitoring shows median delivery > 2 minutes.

### 14.5 Hot-row contention on inventory_items

A popular variant viewed by 200+ concurrent customers will have its row updated frequently. Counter-cache patterns may become needed.

**Mitigations:**
- Monitor row update frequency on inventory_items during Phase 4 / 6 rollout.
- If contention shows up: introduce a `inventory_counters_cache` table updated by a Postgres trigger, and have the read path query that.
- Not built up-front — only if monitoring shows the need.

### 14.6 Reservation correctness under concurrent failure

Phase 1's `reserveAllOrFail` does compensating rollback. If the rollback itself fails (network blip mid-rollback), state can drift.

**Mitigations:**
- All inventory ops are idempotent at the SQL level (atomic UPDATE with guard).
- Add an `inventory_reconciliation_log` table (Phase 8.6) so admin sees discrepancies.
- Don't auto-fix; alert.

### 14.7 Customer experience regression during Phase 1 rollout

The Phase 1 refactor changes the Stripe path significantly. Bugs there would block all checkouts.

**Mitigations:**
- Feature flag the new path; ship parallel and switch over.
- Manual QA of every payment-method × delivery-method combination before flip.
- Have a clear rollback procedure documented.

---

## 15. Validation checklist per phase

Each phase ships only when:

1. **Migrations apply cleanly** on a fresh Supabase project.
2. **Typecheck passes** (`npm run typecheck`).
3. **Tests for that phase pass** (whatever new tests were added).
4. **Manual QA scenarios for that phase pass** (checklist per phase).
5. **No regression in existing test suite**.
6. **Audit log entries fire for each new sensitive action** (not silently dropped).
7. **Realtime channels (where applicable) verified working in browser DevTools**.

---

## 16. Open implementation decisions deferred to detailed design

The following are flagged for detailed-design conversations when the relevant phase starts:

- Specific copy for all error states (Greek-only or i18n-ready scaffolding?)
- Specific Realtime channel auth flow for anonymous users (RLS policies on broadcast targets)
- Specific behavior on Stripe `payment_intent.processing` event (transitional state during 3DS) — keep reservation, no action
- Specific UI treatment of the "Save your info" upgrade prompt after first guest checkout
- Specific behavior when a customer in priority hold has the item drop from in-stock to out-of-stock again before their hold expires (e.g., supplier returned a defective batch). Logically: their hold remains, they can still buy, the inventory math reflects the discrepancy.
- Specific admin UX for force-releasing a stuck hold from the debug UI

---

## 17. What gets implemented first

With all pre-flight decisions in §1 resolved, the implementation starts with **Phase 0 (Stripe migration)** before any inventory work. Phase 1 follows once Phase 0 is verified in staging.

### Phase 0 first-unit (10 steps)

1. Migration: `20260521120000_payment_checkout_sessions.sql` (Phase 0.2). Extends `payment_intents` with Checkout Session columns.
2. Refactor `src/lib/payment/providers/stripe.ts` — `createIntent` → `createCheckoutSession` (Phase 0.3).
3. Refactor `src/lib/payment/providers/mock.ts` to match the new interface (Phase 0.3).
4. Rename `src/actions/payment/createPaymentIntent.ts` → `createCheckoutSession.ts` (Phase 0.4).
5. Replace Stripe Elements form on `/checkout` with redirect-to-session button (Phase 0.5).
6. Update `src/app/api/webhooks/stripe/route.ts` — handle `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed` (Phase 0.6).
7. Update mock webhook `src/app/api/webhooks/mock-payment/route.ts` to accept session_id (Phase 0.7).
8. E2E test: full checkout flow with Stripe test card (Phase 0.8).
9. E2E test: abandoned checkout, verify `checkout.session.expired` webhook (Phase 0.8).
10. Manual QA sweep: every payment-method × delivery-method × source combination.

After Phase 0 is verified in staging, **Phase 1 first-unit (10 steps)** kicks off:

1. Migration: `20260522000001_inventory_contention_columns.sql` (Phase 1.1) — adds `quantity_soft_held`, `quantity_priority_held`.
2. Migration: `20260522000002_inventory_contention_rpcs.sql` (Phase 1.1) — `hold_soft`, `release_soft`, `promote_soft_to_reserved`.
3. Migration: `20260522000003_effective_available_function.sql` (Phase 1.1).
4. Write `src/lib/inventory/reserveAllOrFail.ts` (Phase 1.3).
5. Refactor `placeOrder` Stripe path to use `reserveAllOrFail` BEFORE creating the Checkout Session (Phase 1.2).
6. Update Stripe `checkout.session.completed` webhook handler to call `consume_reservation` (Phase 1.2).
7. Update Stripe `checkout.session.expired` webhook handler to call `release_reservation` (Phase 1.2).
8. Write integration test for the race scenario (Phase 1.4).
9. Manual QA: confirm normal Stripe checkout still works end-to-end after the reserve-at-place refactor.
10. Compare metrics against staging baseline to verify the fix.

After this 20-step path ships, Phase 0 + Phase 1 are complete and the race condition is structurally closed. Subsequent phases follow §13's rollout sequence.

---

## Notes — semantic clarification

The spec doc (`inventory-contention-and-notifications.md`) originally wrote `effective_available = quantity_available − quantity_soft_held − quantity_reserved − quantity_priority_held` in §3's glossary. That formula assumes a **gross stock model** where `quantity_available` is the total physical pool and the hold counters are overlays.

The actual codebase predates the contention design and uses an **unencumbered pool model**: the existing `reserve_inventory` RPC atomically decrements `quantity_available` and increments `quantity_reserved` (single-statement UPDATE). Under this model, `quantity_available` is already the sellable pool — adding subtraction would double-count.

Phase 1's first cut of `hold_soft` / `release_soft` / `effective_available_for` followed the spec's gross-model formula. Testing exposed an oversell bug: a unit could complete the entire hold→promote→consume lifecycle without `quantity_available` ever changing, leaving the row showing phantom stock.

The fix migration `20260523000002_inventory_contention_rpcs_fix.sql` realigned the new RPCs with the unencumbered model:
- `hold_soft`: now `quantity_available -= p_qty, quantity_soft_held += p_qty`. Matches `reserve_inventory`'s pattern.
- `release_soft`: inverse.
- `promote_soft_to_reserved`: bucket-swap (no change to `quantity_available`).
- `effective_available_for`: just returns `quantity_available`.

The spec doc has been updated in §3 to reflect this. The codebase is canonical; the spec defers to the codebase.

## Suggested next steps

With Phases 0–3 shipped, the recommended order for remaining work:

1. **Phase 8 — Background reapers** *(~60 LoC, high practical value)*. Auto-release stale soft sessions after their 15-min wall-clock expires. Eliminates the "stuck `quantity_soft_held` from abandoned testing/sessions" issue completely. Run via `pg_cron` (free-tier compatible on Supabase). Includes two minor cleanup items: `handleSessionExpired` and `handleSessionFailed` should transition the underlying `cart_checkout_sessions` row to `state='released'` (they release the inventory but currently leave the session row in `'hard'`).

2. **Phase 4 — Soft-wait queue + Realtime**. The most substantial remaining piece. Makes the third modal option ("Add to cart and wait") functional and adds Realtime so the product page CTA flips without page refresh. Higher risk than Phase 8 (first Realtime use) and benefits from the reaper being in place first.

3. **Phase 5 — Wishlist Pattern A UI**. Smaller follow-up making the product-page Save button surface notification toggles inline.

4. **Phase 6/7 — Notification dispatcher + manual mode**. Customer-facing payoff of the wishlist subscriptions accumulated since Phase 3 shipped.

5. **Phase 9, 10** — guest checkout and edge case polish.

The reaper (Phase 8) is the priority because it closes the loop on the drift-from-stale-state concern surfaced during Phase 3 testing. Without it, soft sessions that customers abandoned (close tab, walk away) sit in the DB with their `quantity_soft_held` contribution forever until manually cleaned.
