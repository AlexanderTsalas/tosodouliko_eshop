# QA Checklist

Tracking what's been validated end-to-end across everything shipped in this codebase. Mark each item as you test:

- `[x]` confirmed working in this environment
- `[~]` partially confirmed (worked in one scenario but other branches untested)
- `[ ]` not yet tested
- `[!]` known issue / blocked

Update freely as you go through each area.

---

## 1. Inventory contention — soft holds + sessions

### 1A. Heartbeat-based liveness

- [ ] **Refresh does not release the session.** Open `/checkout?session=...`, press F5 a few times. Audit log should NOT show new `client_unload` entries. The session row stays `state='soft'` with `last_heartbeat_at` updating every ~10s.
- [ ] **Tab close releases within ~60s.** Start checkout (User A), close the tab. Wait 30–60s, check `cart_checkout_sessions` — row should flip to `state='released'`. Inventory returns to `quantity_available`.
- [ ] **Contended close releases instantly.** User A starts checkout. After heartbeat goes stale (>30s since close), User B clicks Ολοκλήρωση — should get through immediately via opportunistic cleanup, not see contention modal.
- [ ] **Browser crash is recoverable.** Kill the process. Within ~90s the session should be released by `release_stale_heartbeat_sessions` cron.
- [ ] **Heartbeat works in dev tools.** With `/checkout` open, Network tab should show a `POST /api/checkout/heartbeat` every 10s returning 200.

### 1B. Wall-clock eviction

- [ ] **2-minute warning banner.** Set `SOFT_SESSION_TTL_MIN = 2` locally or force `expires_at = now() + 90s` in DB. Open `/checkout?session=...`. Amber banner should appear immediately ("λήγει σε X:XX").
- [ ] **T-0 redirect.** Continue from previous test — at 0:00, page should `router.replace('/cart?session_expired=1')`.
- [ ] **Cart shows expiry modal.** After the redirect, modal opens explaining "Η συνεδρία ολοκλήρωσης παραγγελίας έληξε." Dismissing strips the `?session_expired=1` query param.

### 1C. Reapers + cron jobs

- [ ] **Soft-session reaper.** Force a session's `expires_at` to past. Wait for next minute tick. Row should flip to `state='released'`, inventory returns.
- [ ] **Orphan reconciliation.** `UPDATE inventory_items SET quantity_soft_held = 3 WHERE variant_id = ...` with no backing session. Within 5 min, value should return to 0 and `quantity_available` should be 3 higher. Postgres log should show `RAISE NOTICE 'reconcile_orphan_soft_held: variant X reclaimed N orphan unit(s)'`.
- [ ] **Heartbeat staleness reaper.** Force `last_heartbeat_at` to old time. Within ~60s, session released.
- [ ] **Opportunistic cleanup.** Force-expire session A. User B contends → User A's session released inline during User B's `hold_soft`, no waiting for cron.

### 1D. Edge cases (spec §16)

- [ ] **§16.1 Multi-tab self-contention.** Add 1 unit (last in stock) to cart in tab 1. Open product page in tab 2 — CTA stays "Add to Cart", shows "1 left". Currently passes via viewer-aware `effective_available_for`.
- [ ] **§16.2 Cart removal releases priority hold.** Get promoted from wait queue (priority hold active). Remove item from cart — verify in DB: `priority_holds.consumed_at` set, next FIFO waiter promoted within ~1s.
- [ ] **§16.3 Wishlist removal releases priority hold.** Same scenario via wishlist deletion path.
- [ ] **§16.5 Stale modal.** Open contention modal for an item. In another tab, admin force-releases the holding session. Modal should display "Η διαθεσιμότητα άλλαξε. Κλείστε αυτό το παράθυρο και δοκιμάστε ξανά." without refresh.
- [ ] **§16.6 Sign-out sweeps.** Active soft session + priority hold + queue position → sign out. All should be released; audit event `auth.signout_sweep` written with counts.
- [ ] **§16.7 Admin cancel of reserved order.** Cancel a reserved COD order → `release_reservation` runs → wishlist dispatcher fires for any subscribers.
- [ ] **§16.9 Priority hold consume mid-checkout.** Get promoted, click Ολοκλήρωση — `consume_priority_to_soft` flips bucket atomically. Customer completes checkout normally.

---

## 2. Soft-wait queue (Phase 4)

### 2A. Queue join + promotion

- [ ] **Add to cart and wait.** User A in checkout for last unit. User B opens product page, clicks "Add to Cart" → contention modal → "Προσθήκη στο καλάθι και αναμονή" → success state.
- [ ] **Cart shows waiting badge.** User B's `/cart` shows item with amber "Σε αναμονή — άλλος πελάτης ολοκληρώνει αυτή τη στιγμή" badge. Quantity input disabled. Proceed button disabled.
- [ ] **Promotion on release.** User A backs out. Cron + opportunistic cleanup releases. User B's `soft_waits` row gets `promoted_at = now()`. A `priority_holds` row appears for User B.
- [ ] **Live promotion countdown.** Without refreshing, User B's cart should flip to emerald "Διαθέσιμο τώρα — ολοκληρώστε σε M:SS" with live countdown.
- [ ] **Proceed enabled post-promotion.** Button no longer disabled. Clicking goes through `consume_priority_to_soft` → normal checkout.

### 2B. Collapse path

- [ ] **Soft-holder pays → queue collapses.** User A in checkout, User B in wait queue. User A clicks Submit → `collapse_soft_wait_queue_for_session` runs → User B's `cart_items` + `soft_waits` deleted.
- [ ] **Collapse modal fires on User B.** Without refresh, modal opens with "Ένα προϊόν εισήλθε σε αγορά από άλλον πελάτη". Item disappears from cart.
- [ ] **Self-delete suppression.** User clicks Αφαίρεση on their own item → cart_item deleted via removeFromCart → DELETE event arrives via Realtime → since self-deletes-ref tracks it, NO collapse modal fires.

### 2C. Priority hold lifecycle

- [ ] **Hold expires unconsumed.** Force a soft-wait priority hold to expire. Within minute cron, `release_expired_priority_holds` releases inventory. If another waiter exists in same session, `advance_soft_wait_queue_after_priority_expiry` promotes them.
- [ ] **Voluntary leave.** Promoted customer changes their mind → click Αφαίρεση. Priority hold released, queue advances to next person inline.

---

## 3. Wishlist UI (Phase 5)

### 3A. Pattern A product page

- [ ] **Single-click silent save.** Permanent account, in stock product, click ♡ — flips to ♥ Αποθηκευμένο ▾, brief "✓ Αποθηκεύτηκε" flash. No DB flags set.
- [ ] **Chevron expands panel.** Click ♥ Αποθηκευμένο ▾ → inline panel shows Προσφορές + Απόθεμα checkboxes (both unchecked by default).
- [ ] **Restock checkbox always shows.** Whether variant is in stock or not, restock toggle is visible (with hint text when in stock).
- [ ] **Confirm persists flags.** Check both → click Επιβεβαίωση → DB shows `notify_on_sale=true, notify_on_restock=true`.
- [ ] **Remove from panel.** Click Αφαίρεση → wishlist_items row deleted; if priority hold was active, also released.
- [ ] **Click-outside collapses.** Click anywhere outside the panel → panel closes without saving.

### 3B. Account wishlist page

- [ ] **`/wishlist` requires auth.** Visit while logged out → redirect to signin.
- [ ] **List renders.** Each saved item shows product name, variant label, price, date added, source attribution.
- [ ] **Per-flag toggles work.** Check/uncheck a flag inline → optimistic update + persists via `updateWishlistFlags`.
- [ ] **Restock badge shown when active.** With `notify_on_restock=true`, badge "📦 Ειδοποίηση όταν επιστρέψει" visible. Sale flag has its own blue badge.
- [ ] **Last-notification line.** After a notification fires, "Τελευταία ειδοποίηση: ..." line appears.
- [ ] **Remove from list.** Αφαίρεση deletes the row; if priority hold was active, also released.

### 3C. Anonymous user blocked from wishlist

- [ ] **Anon clicks ♡ on product page.** Browser navigates to `/auth/signup?next=/products/...`. No silent save attempt.
- [ ] **Anon clicks "Notify me" on sold-out variant.** Same redirect to signup.
- [ ] **Anon clicks "Notify me" in contention modal.** Same redirect.
- [ ] **After signup completes.** Customer lands back on originating product URL. Can now click ♡ — saves normally as permanent account.
- [ ] **Server defense in depth.** Manually call `subscribeToRestock` via DevTools while signed in as anon → returns `NEEDS_ACCOUNT` error.

---

## 4. Wishlist notification dispatcher (Phase 6 + 6.5)

### 4A. Dispatcher core

- [ ] **Parallel cadence.** Two subscribers, restock 5 units → both fire simultaneously, each gets own priority hold.
- [ ] **Sequential cadence.** Two subscribers, restock 1 unit → first fires, second waits.
- [ ] **Manual mode enqueues.** Toggle mode to manual via `/admin/wishlist-queue`. Trigger release → `pending_wishlist_notifications` row appears, no email sent.
- [ ] **One-shot clear.** After a successful notification, the customer's `wishlist_items.notify_on_restock` flips to `false`, `last_notified_at` set.
- [ ] **Email fires with Greek copy.** Subject "Καλά νέα — το «...» είναι ξανά διαθέσιμο". Body contains product, date wishlisted, 30-min priority hold disclosure.

### 4B. Triggers

- [ ] **Stripe abandon.** Customer A's `checkout.session.expired` webhook → `releaseOrderReservations` per line → dispatcher fires per variant.
- [ ] **COD cancel.** Admin transitions reserved order to cancelled → `release_reservation` runs → dispatcher fires.
- [ ] **Admin top-up.** Set inventory level from 0 → 5 via CMS → dispatcher fires with `triggered_by: 'admin_topup'` and delta of 5.
- [ ] **Sequential advancement.** First subscriber's priority hold expires unconsumed → cron `/api/cron/wishlist-advance` ticks → second subscriber notified.

### 4C. Realtime broadcast

- [ ] **Live banner on /wishlist.** Customer A has `/wishlist` open. Restock fires → banner appears within ~1s with countdown to expiry.
- [ ] **Banner countdown ticks every second.**
- [ ] **Auto-dismiss after T-0.** When countdown hits 0:00, banner fades 1.5s later.
- [ ] **Channel authorization.** With "Allow public access" disabled in Supabase Realtime dashboard, customer B subscribing to `customer:{A's customer_id}` (private channel) receives no events.
- [ ] **Email follows.** Customer A also receives the email a few seconds after the live banner.

---

## 5. Manual wishlist queue admin (Phase 7)

- [ ] **Permission gate.** Without `manage:wishlist_queue`, sidebar link hidden. Direct `/admin/wishlist-queue` redirects to signin.
- [ ] **MFA gate.** With permission but no MFA factor → redirect to `/admin/mfa-enroll`.
- [ ] **Mode toggle.** Click "Χειροκίνητα" → DB `notification_settings.wishlist_notification_mode = 'manual'`. Next dispatch enqueues, doesn't email.
- [ ] **Per-row Ειδοποίηση.** Click → `notifyPending` fires → priority hold created, email sent, pending row marked `status='notified'`.
- [ ] **Custom message.** Click Custom message → textarea dialog → submit → email body replaced with admin's text (subject + structural elements stay templated). Audit event `wishlist.notification.custom_fired`.
- [ ] **Skip row.** Pending row marked `status='skipped'`. Customer's wishlist row remains eligible for next release.
- [ ] **Bulk Ειδοποίηση όλων (FIFO).** With more subscribers than units available, fires until inventory runs out, marks rest skipped.
- [ ] **Απόρριψη όλων.** Drops the entire variant's pending queue without notifying anyone. Confirm prompt before.

---

## 6. Guest checkout + anon auth (Phase 9)

### 6A. Prerequisites

- [x] **Anonymous sign-ins enabled in Supabase dashboard** (confirmed during testing).

### 6B. Cold guest path

- [ ] **Add to cart from incognito.** First click on Προσθήκη — `useEnsureSession` creates anon `auth.users` row with `is_anonymous=true`. Add succeeds.
- [ ] **Cart persists across navigation.** Items stay in cart through product pages until cookies are cleared.
- [ ] **Complete a guest COD order.** Order placed with `customer_id=anon-customer`, `customer_email_at_order=NULL`.
- [ ] **Success page renders.** `/checkout/success/[id]` shows order summary + "Αποθηκεύστε τα στοιχεία σας" card with signup/signin CTAs.

### 6C. Cart merge on sign-in/sign-up

- [ ] **Sign-in merges cart.** Anon adds 2 items. Sign in to existing account that already has 1 item. After sign-in, cart has 3 items (1 existing + 2 merged). Quantities sum when same variant. Audit `auth.anon_cart_merged` logged.
- [ ] **Sign-up merges cart.** Same as above via signUp flow (after email confirmation if needed).
- [ ] **Ownership defense.** Try calling `mergeAnonCart` with a permanent user's uid → server rejects with `NOT_ANONYMOUS`.

### 6D. Edge cases

- [ ] **Direct /checkout fallback.** Open `/checkout` in incognito without items → `GuestCheckoutPrompt` renders with "Συνέχεια ως επισκέπτης" → click → session created → page refreshes.
- [ ] **Concurrent click dedup.** Double-click "Προσθήκη στο καλάθι" rapidly → only one anon user created (audit_events count = 1, not 2).
- [ ] **Existing signed-in flow unchanged.** Permanent customer adds to cart → `useEnsureSession` is no-op, normal flow proceeds.

---

## 7. Auth surface defenses

### 7A. Sign-in (existing limits + new defenses)

- [ ] **Per-(IP, email) brute force.** 6 attempts with same email/IP in 60s → 6th returns `RATE_LIMITED`.
- [ ] **Per-IP credential stuffing.** 6 different emails from same IP in 5 min → 6th returns `RATE_LIMITED` with audit event `auth.signin.credential_stuffing_blocked`.
- [ ] **Honeypot.** Manually POST signIn with `company=ACME` → returns generic `AUTH_FAILED`. Real users never see the field.
- [ ] **Successful login.** Email + password works normally → session set.

### 7B. Sign-up

- [ ] **Per-IP signup cap.** 6 signups from one IP in an hour → 6th returns `RATE_LIMITED` with audit `auth.signup.rate_limited`.
- [ ] **Email enumeration cap.** 11 distinct emails from one IP in an hour → 11th returns `RATE_LIMITED` with audit `auth.signup.enumeration_blocked`.
- [ ] **Honeypot.** Manually POST signUp with `company=ACME` → returns generic `INVALID_INPUT`.
- [ ] **Successful signup.** Email + password + name → confirmation email sent → click link → land on `/auth/callback?next=...` → redirected to originating URL.
- [ ] **`?next=` propagation.** Sign up via `/auth/signup?next=/products/foo` → confirmation email link returns to `/products/foo` after verification.

### 7C. MFA enforcement

- [ ] **Admin page enforces MFA.** Login as admin, navigate to `/admin/wishlist-queue` → if no MFA factor, redirect to `/admin/mfa-enroll`. If factor exists but AAL1, redirect to `/admin/mfa-verify`.
- [ ] **Admin server actions enforce MFA.** With permission but AAL1 session, manually invoke any of: `notifyPending`, `skipPending`, `bulkNotify`, `releaseToGeneral`, `updateNotificationMode`, `forceReleaseSoftSession`, `forceReleasePriorityHold`, `refundOrder` — should redirect to MFA flow.

### 7D. Sign-out

- [ ] **Sweep on sign-out.** Active soft session + priority hold + queue position → signOut → all released, audit `auth.signout_sweep` written with `priority_holds_released` and `soft_sessions_released` counts.

---

## 8. Customer-facing defense rate limits

- [ ] **applyDiscount: 10/hour cap.** 11 calls in an hour → 11th returns `RATE_LIMITED`.
- [ ] **applyDiscount: distinct-codes cap.** 6 different codes from one user → 6th returns `RATE_LIMITED` with audit `discount.brute_force_blocked`.
- [ ] **createCheckoutSession: 10/hour cap.** 11 calls → 11th returns `RATE_LIMITED`. Real customer rarely hits >2.
- [ ] **requestReturn: 3/hour cap.** 4 calls → 4th returns `RATE_LIMITED`. Audit event `returns.requested` on every successful submission.
- [ ] **subscribeNewsletter: 5/hour cap per IP.** 6 from same IP → blocked.
- [ ] **subscribeNewsletter: distinct-email cap.** 11 distinct emails from one IP → 11th returns `RATE_LIMITED` with audit `newsletter.subscribe.enumeration_blocked`.
- [ ] **Re-subscribe doesn't re-send welcome.** Subscribe with existing-subscribed email → no welcome email sent.

---

## 9. Admin operations + cost protection

- [ ] **refundOrder: 20/hour cap per admin.** 21st attempt returns `RATE_LIMITED`.
- [ ] **refundOrder: MFA required.** AAL1 admin → redirected to `/admin/mfa-verify`.
- [ ] **testCarrierProvider: 10/min cap per admin.** Spam-click test button → 11th call within a minute returns `RATE_LIMITED`.
- [ ] **sendTestEmail: 10/min cap per admin.** Same.
- [ ] **Force-release tools work.** `/admin/inventory-debug?variant=<sku>` → click Force release on a soft session → row released, audit `inventory_debug.soft_session_force_released` written.
- [ ] **Bulk notify caps at available inventory.** 5 pending, 2 available → first 2 fire, remaining 3 auto-marked `status='skipped'`.

---

## 10. Defense-in-depth

- [ ] **Cart ownership filter.** Sign in as customer A. Find a cart_item_id belonging to customer B (via DevTools / admin DB query). Call `updateCartItem({cartItemId: B's, quantity: 99})` via DevTools → returns `NOT_FOUND` (action-level rejection, not just RLS).
- [ ] **Wishlist ownership filter.** Same scenario via `updateWishlistFlags` or `removeWishlistItem` with another user's item id → `NOT_FOUND`.
- [ ] **Email send-dedup.** Trigger the same wishlist restock email twice in 30 seconds → second send shows `[email:dedup-suppressed]` console log; recipient inbox shows exactly one email.

---

## 11. Background cron jobs

- [ ] **`reap_stale_soft_sessions` runs every minute.** Check `SELECT * FROM cron.job` for the schedule. Force a stale session and observe release within the next tick.
- [ ] **`release_expired_priority_holds` runs every minute.** Force-expire a priority hold; cron releases.
- [ ] **`release_stale_heartbeat_sessions` runs every minute.** Stop a customer's heartbeat; release within ~60s.
- [ ] **`reconcile_orphan_soft_held` runs every 5 minutes.** Inject orphan; reclaim within 5 min.
- [ ] **`/api/cron/wishlist-advance` runs every minute.** Either via pg_cron+pg_net (migration `20260530000001`) or external scheduler. Verify with `SELECT * FROM audit_events WHERE action LIKE 'wishlist.%' ORDER BY created_at DESC LIMIT 20`.

---

## 12. Setup checks (one-time)

- [ ] **Supabase dashboard: Anonymous sign-ins enabled.** Authentication → Providers.
- [ ] **Supabase dashboard: Realtime "Allow public access" disabled.** Realtime → Settings. Required for H2 channel authorization.
- [ ] **Supabase dashboard: pg_cron + pg_net extensions enabled** (or alternative scheduler configured for `/api/cron/wishlist-advance`).
- [ ] **Env vars:** `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_*`, `CRON_SECRET` (≥32 chars in production).
- [ ] **All migrations applied:** `supabase db push --include-all` after pull. Verify with `SELECT name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 10`.
- [ ] **MFA enrolled for at least one admin user** (otherwise admin pages are inaccessible).

---

## Notes

Update the marks as you verify each scenario. Items marked `[!]` should have a brief note explaining the issue and any tracking ticket.

When new features ship, add new sections rather than editing existing ones (preserves history).

Pair this checklist with [docs/security/auth-jwt-audit-2026-05-24.md](security/auth-jwt-audit-2026-05-24.md) for the security audit findings and [docs/features/inventory-contention-implementation-plan.md](features/inventory-contention-implementation-plan.md) for the feature implementation status.
