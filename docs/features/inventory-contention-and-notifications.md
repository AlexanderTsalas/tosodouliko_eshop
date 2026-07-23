# Inventory Contention & Customer Notifications

## Status

**Design complete, not yet implemented.** This spec consolidates the design discussions for the customer-facing inventory contention flow and the wishlist-driven notification system. Implementation is scoped as a standalone feature, separate from the security hardening sprint.

---

## 1. Problem statement

The current ordering flow can leave the system in a "money taken, can't fulfill" state when two customers race for the last unit of a product. SQL guards on `decrement_inventory` (see [migration 20260430000014](../../supabase/migrations/20260430000014_inventory_sync_schema.sql)) prevent negative stock at the database level, but they do not prevent the *business* problem: a customer can complete Stripe payment for an order whose inventory was just consumed by a different order, leaving the second order permanently stuck in `payment_status='paid', fulfillment_status='pending'`.

Beyond the immediate race, the broader question is how to handle scarce inventory across the customer journey: how do we prevent oversell without locking inventory the moment something enters a cart, how do customers who lose a race find out, and how does the merchant capture sales that would otherwise leak through abandoned checkouts?

This spec defines a complete model that covers all of those.

---

## 2. Design principles

These are the principles every detail below resolves toward, in priority order. When future questions arise, refer back here.

1. **Carts are advisory, reservations are atomic.** Adding to cart is browsing intent; it never blocks other customers or holds inventory. The only state that blocks others is an explicit purchase intent expressed by clicking "Proceed to Checkout."
2. **Honesty over cleverness.** Contention is communicated truthfully. A customer who loses a race is told why; a customer who joins a queue is told they're in a queue.
3. **Items never magically vanish from carts.** When the customer comes back tomorrow, their cart contains what they left, regardless of inventory state. Inventory state is communicated separately from cart state.
4. **First-come-first-served for fairness, with one exception.** The merchant can opt into automated FIFO notification, or can manually choose recipients with full visibility into the wait queue.
5. **Customer control via opt-out paths.** Every "Wait" or "Notify me" decision has an explicit Continue Without alternative. Nothing is forced.
6. **Merchant control via opt-in automation.** Wishlist notification automation is off by default; merchants explicitly enable it during onboarding.
7. **Realtime where it matters, email everywhere else.** Live updates power the real-time contention UI; durable notifications go through email so customers can walk away.

---

## 3. Glossary

| Term | Definition |
|---|---|
| **Effective available** | The number of units a fresh customer can actually buy right now. Equal to `quantity_available` directly — see note below. Computed in code via the `effective_available_for(variant, viewer)` SQL function. |
| **Inventory bucket model** | `quantity_available` is the unencumbered free pool. Every claim (`reserve_inventory`, `hold_soft`, future `promote_to_priority`) atomically decrements `quantity_available` and increments the corresponding hold counter. Releases reverse the move. Consumption only decrements the hold counter (the unit was already out of `quantity_available` at claim time). Therefore `quantity_available` is itself the effective availability — adding back any subtraction would double-count. The aggregated "total physical inventory" view is `quantity_available + quantity_reserved + quantity_soft_held + quantity_priority_held` (until consume, after which units leave the system). |
| **Soft contention** | Phase 2 below — a customer has clicked Proceed to Checkout and is on the checkout page, but has not yet started a Stripe Session. |
| **Hard contention** | Phase 3 below — a customer has clicked Pay (Stripe session active) or has placed a COD order. A real `reserve_inventory` lock is held. |
| **Soft-wait queue** | Per-variant queue of customers who clicked "Add to cart and wait" while another customer was in soft contention. |
| **Priority hold** | A 30-minute exclusive reservation granted to a customer who has been promoted from a wait queue or wishlist queue. |
| **Wishlist** | A customer's registry of products they're interested in, with per-item notification preferences. |

---

## 4. The three-phase contention model

Every variant exists in one of three contention states at any moment. Transitions are triggered by customer actions and bounded by explicit timers.

### Phase 1 — Browsing (no contention)

**Trigger:** default state.

**State:** `effective_available > 0`. Cart presence does not affect inventory math.

**Customer experience:**
- Product page CTA: **"Add to Cart"** (with low-stock indicator if `quantity_available ≤ 3`).
- Adding to cart is silent; no other customer sees any state change.
- Multiple customers can have the same variant in their carts simultaneously without conflict.

**Inventory math:** `quantity_available > 0`, all hold counters at zero.

### Phase 2 — Soft contention (checkout page, pre-Stripe)

**Trigger:** any customer clicks "Proceed to Checkout" from the cart page.

**State on entry:**
- `quantity_soft_held` increments by the customer's intended quantity for each contested variant.
- A `cart_checkout_sessions` row is created with `state='soft'` and a 15-minute wall-clock expiry timer. (Named `cart_checkout_sessions` rather than `checkout_sessions` in code to avoid collision with Stripe's "Checkout Sessions" terminology used by the Phase 0 payment flow.)
- Realtime broadcasts the new state to subscribed clients.

**Other customers' experience:**
- Product page CTA: **still "Add to Cart"** (no flip — the soft-holding customer might back out).
- Low-stock indicator updates: "Only X available right now."
- Clicking "Add to Cart" when `effective_available < their_requested_quantity` opens the **contention modal** (see §6).

**Resolution paths:**
- Customer clicks "Pay" → transition to Phase 3.
- Customer navigates away from checkout, removes contested items from cart, or 15-minute timer expires → soft hold released, transition to Phase 1, soft-wait queue advances (see §7).

### Phase 3 — Hard contention (Stripe session or COD order)

**Trigger:** soft-contention customer clicks Pay (creating a Stripe session) OR places a COD order.

**State on entry:**
- `reserve_inventory` SQL RPC runs atomically. Success transfers the soft hold into `quantity_reserved`. (Failure means another customer raced ahead, in which case this customer sees the contention modal and reverts to Phase 2 or Phase 1 path.)
- For Stripe: Stripe Session created with 30-minute `expires_at`. Reservation tied to it.
- For COD: order created with `payment_status='pending', fulfillment_status='pending'`. Reservation lasts until order completion or cancellation (potentially days).
- Realtime broadcasts the state change.

**Other customers' experience:**
- Product page CTA flips via Realtime: **"Notify me when available."**
- Clicking the CTA creates a wishlist entry with `notify_on_restock=true` (no modal — the action is unambiguous).
- Customers in the soft-wait queue (added during Phase 2) have their wait state collapse: they receive a notification ("Item entered active checkout by another customer"), the item is removed from their cart, and they are offered the wishlist option in a two-button modal (Add to wishlist / Continue without). See §7.

**Resolution paths:**
- Payment succeeds → reservation consumed, inventory permanently decremented, post-checkout flow runs. If stock is now zero, product page CTA reads "Notify me when back in stock" (subtly different copy from the contested version, see §6.5).
- Payment fails / Stripe session expires / COD order is cancelled → reservation released, transition to Phase 1, wishlist priority queue activates (see §8).

### State diagram

```
                              ┌────────────────────────────────┐
                              │                                │
   Phase 1: Browsing  ──────► Phase 2: Soft contention  ──────►│
   (no contention)            (customer on checkout page,      │
                               quantity_soft_held > 0,         │
                               15-min wall-clock timer)        │
        ▲                                                      │
        │                              │                       ▼
        │                              │   Phase 3: Hard contention
        │ release                      │   (Stripe session active OR
        │ (back out /                  │    COD order placed,
        │  timeout)                    │    quantity_reserved > 0)
        │                              │
        │      pay clicked  ───────────┘                       │
        │                                                      │
        └──────────────────────────────────────────────────────┘
                 release (payment fails / Stripe expires /
                          COD cancelled) → wishlist queue activates
```

---

## 5. Quantity-level math

Locks operate on quantities, not on the variant as a binary state. Concrete example:

- Variant X has `quantity_available = 5`.
- Customer A is at checkout with `quantity = 3` of X → `quantity_soft_held = 3`, `effective_available = 2`.
- Customer B browses, wants `quantity = 4` of X.
  - 2 are freely addable, 2 are contested.
  - Product page shows: "Only 2 available right now."
  - Clicking Add with quantity 4 opens the contention modal with quantity-aware copy (§6.3).

Every customer-facing message phrases contention in terms of quantities. Every inventory operation works on `(variant_id, quantity)` pairs.

---

## 6. The contention modal

### 6.1 When it fires

The modal fires **only** during Phase 2 (soft contention), when a customer clicks Add to Cart and their requested quantity exceeds `effective_available`. In Phase 3 the product page CTA is replaced with "Notify me when available" and the modal is not needed.

If the customer already had the item in their cart from before Phase 2 began, and clicks "Proceed to Checkout" while in Phase 2 with insufficient effective availability, the modal also fires at the Proceed click.

### 6.2 Standard three-option layout

```
┌──────────────────────────────────────────────────────────────────┐
│  This product is currently in another customer's checkout.       │
│  Quantity available right now: X (of Y you wanted)               │
│                                                                  │
│  [ Add to cart and wait        ]                                 │
│  [ Notify me when available    ]                                 │
│  [ Continue without            ]                                 │
└──────────────────────────────────────────────────────────────────┘
```

**Option 1 — Add to cart and wait:**
- Item enters customer's cart at requested quantity.
- Customer is registered in the soft-wait queue (FIFO by add-to-wait time).
- Customer's "Proceed to Checkout" button is disabled until queue position resolves.
- Customer can continue browsing; their cart persists.

**Option 2 — Notify me when available:**
- Creates a wishlist entry with `notify_on_restock=true`.
- If guest, triggers inline magic-link signup (§9.3).
- Item is **not** added to cart.
- Customer can continue browsing.

**Option 3 — Continue without:**
- Modal closes.
- No action taken.
- Customer continues browsing.

### 6.3 Partial-quantity variant

When `effective_available > 0 but < requested`, the modal offers partial actions:

```
┌──────────────────────────────────────────────────────────────────┐
│  Only 2 of the 4 you wanted are available right now.             │
│  Another customer is checking out with the remaining 2.          │
│                                                                  │
│  [ Add 2 to cart now, wait for the other 2     ]                 │
│  [ Add all 4 to cart, wait until all available ]                 │
│  [ Add just 2 and continue                     ]                 │
│  [ Notify me when all 4 are available          ]                 │
└──────────────────────────────────────────────────────────────────┘
```

### 6.4 Phase 3 collapse modal

If a customer was in the soft-wait queue and the soft-holding customer transitions to Phase 3, the waiting customer's wait state collapses. They see:

```
┌──────────────────────────────────────────────────────────────────┐
│  Δυστυχώς, το προϊόν εισήλθε σε αγορά από άλλον πελάτη ενώ ήταν  │
│  στο καλάθι σας.                                                 │
│                                                                  │
│  [ Προσθήκη στη λίστα επιθυμιών — ενημερωθώ αν επιστρέψει ]      │
│  [ Συνέχεια χωρίς αυτό                                    ]      │
└──────────────────────────────────────────────────────────────────┘
```

The item is automatically removed from their cart on either choice. Selecting "Add to wishlist" creates a wishlist entry with `notify_on_restock=true` and triggers inline signup if the customer is a guest.

### 6.5 Product page CTA copy variants

Depending on inventory state, the CTA reads differently:

| State | CTA |
|---|---|
| `effective_available > 0` | **"Add to Cart"** (with "Only X left" indicator if low) |
| `effective_available = 0` because of `quantity_soft_held` | **"Add to Cart"** (modal opens on click) |
| `effective_available = 0` because of `quantity_reserved` (Stripe-in-progress OR COD) | **"Notify me when available"** |
| `quantity_available = 0` AND no active reservations | **"Notify me when back in stock"** |

The two "Notify me" variants have different copy because they signal different mental models — one is "someone is buying it right now, may or may not complete," the other is "definitively sold, waiting for restock." Both create the same wishlist entry (`notify_on_restock=true`).

---

## 7. The soft-wait queue (Phase 2)

The soft-wait queue exists only during Phase 2 — its lifetime is bounded by the 15-minute soft contention window of the original holder.

### 7.1 Membership

A customer enters the queue by choosing "Add to cart and wait" in the contention modal. Their `cart_items` row is created normally (the item is in their cart), and a `soft_waits` row is created with FIFO ordering by timestamp.

### 7.2 Visibility

The customer's cart page shows the item with a "Waiting for availability" badge and a disabled "Proceed to Checkout" button. Tooltip explains why.

Queue position is **not** shown to the customer (decision: opacity reduces refresh anxiety; the notification is the signal).

### 7.3 Resolution

When the original soft-holding customer's Phase 2 resolves:

**If they transition to Phase 3 (clicked Pay):**
- All soft-wait queue members are notified: the Phase 3 collapse modal fires (§6.4).
- Items are removed from their carts.
- They are offered the wishlist option as a fallback.

**If they back out or time out (Phase 2 → Phase 1):**
- Released quantity flows into `effective_available`.
- First-in-queue is promoted: their `soft_wait` row is converted to a 5-minute priority hold in their name (see §10.1).
- Realtime push fires: their cart page updates, the disabled "Proceed to Checkout" button becomes enabled with a countdown ("Your reservation: 4:55").
- If they don't act within 5 minutes, promotion passes to the next queue member.
- After all members have had their turn (or have acted), remaining inventory goes to general availability.

### 7.4 Self-removal

A queued customer who removes the contested item from their cart silently drops from the queue. No notification fires.

### 7.5 Long-lived soft contention via COD

When the original holder transitions to Phase 3 via COD (rather than Stripe), the reservation can last days. The soft-wait queue collapses to wishlist entries (§6.4) so customers aren't left with disabled checkout buttons indefinitely.

---

## 8. The wishlist

### 8.1 Concept

The wishlist is a **registry of products a customer is interested in**, with per-item notification preferences. A wishlist entry is not a reservation, not a hold — it is a record of interest that may or may not include subscriptions to availability events.

### 8.2 Per-item notification flags

Each wishlist entry has independent boolean flags:

- `notify_on_restock` — fires **once** when the item becomes available again. Auto-clears after firing. Customer can re-enable from their wishlist if they want continued alerts.
- `notify_on_sale` — fires on every sale event indefinitely. Customer disables manually when they no longer want alerts.

Future extensibility: `notify_on_price_drop`, `notify_on_color_back`, etc. — add columns as needed.

### 8.3 Account requirement

The wishlist requires an account. Guests can browse and add to cart without an account, but expressing durable interest requires identity.

Inline signup: the first wishlist add for a guest opens a lightweight magic-link signup (email entry only, no password mandatory). The customer receives a magic link and the wishlist add completes server-side as soon as the link is clicked.

Mid-flow signup must preserve the customer's session, cart, and the in-progress wishlist add. The customer should never lose their place.

### 8.4 Product page UI (Pattern A)

The wishlist button on the product page follows the **quick-save-then-refine** pattern:

```
[ ♥ Save ]   ← single click adds with all flags false (silent save)

After click:
[ ♥ Saved ▾ ]   ← click the chevron to expand options inline

When expanded:
┌─────────────────────────────────────────────────┐
│ ✓ Saved to wishlist                             │
│ ☐ Notify me on sales for this product           │
│ ☐ Notify me when available  (only shown if      │
│                              currently unavailable)│
│ [ Confirm ]                                     │
└─────────────────────────────────────────────────┘
```

Default state on click is silent save. Engaged customers expand and configure.

### 8.5 Wishlist entries from contention flow

When a wishlist entry is created from the contention modal (option "Notify me when available") or from a Phase 3 product page CTA ("Notify me when available"), the entry is created with `notify_on_restock=true` automatically. The customer doesn't need to know it's "going to their wishlist" — they just asked to be notified. But if they later check their wishlist, the item appears there with a clear "📦 waiting for restock since [date]" badge.

### 8.6 Wishlist UI in customer account

The customer's saved items page shows each entry with badges indicating its notification settings, the date added, and the source:

- "♥ Saved" (no notifications)
- "🏷️ Notify on sale"
- "📦 Notify when available" (one-shot; clears after firing)
- Source: from product page, from contention modal, from sold-out page

Per-entry actions: toggle any flag, remove from wishlist.

---

## 9. The wishlist notification system

### 9.1 Modal-triggered notifications (always automated)

When a contention modal collapse fires (§6.4) or a customer in a soft-wait queue is promoted (§7.3), the notification fires immediately via Realtime + email. These are part of the real-time UX and **cannot be disabled by the merchant.**

### 9.2 Wishlist-triggered notifications (merchant-configurable)

When inventory becomes available again — via Stripe abandonment, COD cancellation, or supplier restock — wishlist subscribers with `notify_on_restock=true` are notified. This notification flow has **two modes**, configurable by the merchant:

**Automated mode** — system fires emails sequentially or in parallel per §9.4. No admin intervention.

**Manual mode** — system creates `pending_wishlist_notifications` rows. Admin reviews in a dedicated UI and decides who gets notified, when, and with what message. See §11.

Default state: **manual mode** (automation is opt-in). The merchant onboarding flow should include a prompt: "How would you like to handle wishlist notifications? [Automated | Manual]"

### 9.3 Priority holds

When a notification fires (in either mode), the system simultaneously creates a 30-minute exclusive **priority hold** on the relevant quantity for the recipient. While the hold is active:

- `quantity_priority_held` includes the recipient's units.
- Product page `effective_available` reflects the hold (other customers see fewer units, or "Notify me" if all are held).
- The recipient can add to cart, proceed to checkout, and complete payment normally; their actions consume the priority hold.

If the 30-minute window passes without the recipient acting, the priority hold is released. In automated mode, the queue advances to the next subscriber. In manual mode, the entry returns to the admin's pending queue.

### 9.4 Sequential vs parallel notification cadence (automated mode)

The default cadence is sequential, but it parallelizes when supply allows. Rule:

- Let `available` = `quantity_available` (the units about to be queue-allocated; per the bucket model, this column is already net of all hold counters).
- Let `queue_demand` = sum of `requested_quantity` for all wishlist subscribers currently in the queue (default `1` per subscriber when not specified).
- **If `available ≥ queue_demand`:** fire all notifications simultaneously. Each subscriber gets a 30-minute priority hold for their full quantity. No contention between subscribers.
- **If `available < queue_demand`:** fire sequentially in FIFO order. Each subscriber gets a priority hold for `min(requested, remaining_available)`. The next subscriber waits until either the active hold expires or the active subscriber acts (releasing or consuming).

This preserves fairness (FIFO order respected) while maximizing throughput when supply is abundant.

### 9.5 Email batching limits

To avoid email-provider rate limits, simultaneous notification firing happens in waves of ~50 emails per minute. Realtime pushes fire all at once (cheap).

### 9.6 Email content principles

Notification emails must be honest and informative. Required elements:

- Product identification (image, name, price)
- Original wishlist date — so customers who wishlisted months ago understand why they're hearing now
- The 30-minute priority hold disclosed clearly
- A statement that the offer is non-guaranteed if they don't act (no false urgency, no manipulation)
- One-click "Order now" CTA linking to the product page or directly to cart with the item pre-added
- One-click unsubscribe link (CAN-SPAM / GDPR compliance)

Example copy (Greek, restock notification):

```
Subject: Καλά νέα — το «[Product Name]» είναι ξανά διαθέσιμο

Γεια σας,

Το προϊόν που είχατε προσθέσει στη λίστα επιθυμιών σας στις [date]
είναι ξανά διαθέσιμο:

[Product image + name + price]

⏱ ΠΡΟΤΕΡΑΙΟΤΗΤΑ ΓΙΑ ΕΣΑΣ ΓΙΑ 30 ΛΕΠΤΑ
Έχετε αποκλειστική προτεραιότητα για 30 λεπτά. Αν δεν προλάβετε,
η ευκαιρία θα περάσει στον επόμενο πελάτη που περιμένει στη λίστα.
Δεν εγγυόμαστε ότι το προϊόν θα είναι διαθέσιμο αν περιμένετε.

[ Παραγγείλετε τώρα → ]

Αν δεν σας ενδιαφέρει πλέον, [αφαιρέστε από τη λίστα σας].
```

---

## 10. Timers

All timing constants are configurable but ship with these defaults:

| Timer | Default | Purpose | Triggered by |
|---|---|---|---|
| Soft contention window | 15 minutes | Maximum time a customer can sit on the checkout page before soft hold releases | Wall-clock from "Proceed to Checkout" click |
| Stripe session expiry | 30 minutes | Maximum time from "Pay" click to payment completion | Stripe `expires_at` on session creation |
| Soft-wait promotion window | 5 minutes | Time a promoted queue member has to act before promotion passes | Wall-clock from promotion notification |
| Priority hold (wishlist) | 30 minutes | Time a wishlist subscriber has to act before hold passes to next | Wall-clock from notification fire |
| Soft-wait → wishlist auto-conversion | 24 hours | When Phase 3 reservation lasts long (COD), waiting customers auto-convert to wishlist | Wall-clock from soft-wait entry |

---

## 11. Admin: manual notification mode

When the merchant has chosen manual mode for wishlist notifications, the system surfaces pending notifications for admin review.

### 11.1 Admin UI

A new page `/admin/wishlist-queue` shows:

- **Per-variant view**: list of variants with pending wishlist notifications waiting for admin action. Each row shows variant name, available units now, number of subscribers in queue.
- **Per-pending-notification view**: drilling into a variant reveals the subscriber queue with: name/email, queue position (FIFO by wishlist creation date), original wishlist date, requested quantity, source (product page / contention modal / sold-out page).

### 11.2 Per-notification actions

For each pending notification, the admin has these actions:

| Action | Effect |
|---|---|
| **Notify** | Fires email + Realtime, engages a 30-minute priority hold. |
| **Skip** | Drops this subscriber from this release cycle. Their wishlist entry stays for future events. |
| **Custom message** | Composes a custom message overriding the template. Useful for personal touch ("Hi Maria — the dress you liked is back in your size!"). |
| **Defer all** | Leaves all pending entries unhandled. Admin will revisit. |
| **Bulk notify** | Approves and fires all pending notifications at once (equivalent to a one-time auto-mode burst for this batch). |
| **Release to general** | Explicitly drops the queue; inventory becomes generally available immediately, fresh customers can buy. |

### 11.3 Inventory availability while admin deliberates

When inventory becomes available in manual mode and admin hasn't acted:

- Items go to **general availability immediately** (wishlist is contact list, not lock).
- A fresh customer landing on the product page can buy normally.
- If a fresh customer buys before admin notifies, the pending notification row becomes stale ("inventory no longer available"). Admin sees it with no action available.

This is by design: the merchant chose manual; the cost is some sales going through general traffic instead of via wishlist.

### 11.4 Audit logging

Every admin action on a pending notification is audit-logged: who acted, when, what action, on which subscriber. This is critical for accountability and dispute resolution.

### 11.5 Mid-cycle mode switches

Admin toggles automation mid-cycle:

- **Auto → Manual** while priority holds are active: holds persist (already-fired notifications can't be revoked). When current holds expire, queue does NOT auto-advance — next entries sit awaiting admin approval.
- **Manual → Auto** while priority holds are active: holds persist. When current holds expire, queue DOES auto-advance per §9.4.

Mode change applies prospectively only.

---

## 12. Guest checkout integration

Guest checkout is enabled via Supabase anonymous authentication. When a customer clicks "Continue as guest" at checkout, `supabase.auth.signInAnonymously()` runs invisibly, creating an `auth.users` row with `is_anonymous=true`.

Implications for this feature:

- **Cart adds and contention modal**: work normally for guests (anonymous auth gives them an `auth.uid()`).
- **Soft-wait queue**: works normally for guests.
- **Wishlist**: requires upgrading to a permanent account. The inline magic-link signup converts the anonymous user to a permanent user via `auth.updateUser({ email })`. The wishlist entry is created in the same flow.
- **Email notifications**: work as long as the customer provided an email during signup (which is required for wishlist).

A guest customer who places a Stripe or COD order without signing up for wishlist cannot receive availability notifications — they get the order confirmation email and that's it. This is acceptable and consistent with the principle that wishlist is durable interest, which requires identity.

---

## 13. Realtime infrastructure

This is the first introduction of Supabase Realtime to the codebase. Several channels are required:

### 13.1 Per-variant channels

Subscribed by product page visitors and cart page visitors. Broadcasts:
- `effective_available` changes
- Phase transitions (1 → 2, 2 → 3, etc.)
- CTA state changes

Channel name pattern: `variant:{variant_id}`.

### 13.2 Per-customer channels

Subscribed by authenticated users (and anonymous-auth guests). Broadcasts:
- Their own checkout state (priority hold engaged, soft-wait promoted, etc.)
- Their wishlist event notifications

Channel name pattern: `customer:{customer_id}`.

### 13.3 Admin channels

Subscribed by admin users with `manage:orders` or similar permission. Broadcasts:
- New pending wishlist notifications (count badge on admin nav)
- Inventory event triggers (item just released, queue activated)

Channel name pattern: `admin:wishlist-queue`.

### 13.4 Auth and security

Realtime subscriptions authenticate via Supabase JWT. RLS on the underlying tables ensures customers can only subscribe to their own channels. The `variant:*` channel broadcasts non-sensitive inventory state and can be subscribed by anon/authenticated users alike.

### 13.5 Operational considerations

- **Hot-row contention**: a popular variant viewed by 200+ concurrent customers will have its `inventory_items` row updated frequently. Counter-cache patterns may be needed at scale.
- **Connection limits**: Supabase Realtime has connection quotas. Monitor and budget.
- **Fallback**: if Realtime is unavailable, the UI should degrade gracefully (manual refresh works, just no auto-updates).

---

## 14. Data model

New tables and columns:

### 14.1 Extensions to existing tables

```sql
ALTER TABLE inventory_items
  ADD COLUMN quantity_soft_held     integer NOT NULL DEFAULT 0,
  ADD COLUMN quantity_priority_held integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT check_quantity_soft_held_nonneg     CHECK (quantity_soft_held >= 0),
  ADD CONSTRAINT check_quantity_priority_held_nonneg CHECK (quantity_priority_held >= 0);
```

`quantity_reserved` already exists (used by `reserve_inventory`).

### 14.2 New tables

**`cart_checkout_sessions`** — tracks Phase 2 soft contention. (Implementation-time rename from this doc's original `checkout_sessions` to disambiguate from Stripe's Checkout Sessions; see implementation plan §2A.1.)
```
id                uuid PK
customer_id       uuid (or guest_token for anonymous)
cart_id           uuid → carts(id)
state             enum ('soft', 'hard', 'completed', 'released')
stripe_session_id text NULL (set when state='hard' via Stripe)
created_at        timestamptz
expires_at        timestamptz (created_at + 15 min for state='soft')
```

**`soft_waits`** — soft-wait queue members during Phase 2.
```
id                uuid PK
checkout_session_id uuid → cart_checkout_sessions(id) (the soft-holding session being waited on)
customer_id       uuid (or guest_token)
cart_item_id      uuid → cart_items(id)
variant_id        uuid → product_variants(id)
quantity          integer
created_at        timestamptz
```

**`wishlist_items`** — durable interest registry.
```
id                uuid PK
customer_id       uuid → customers(id)
variant_id        uuid → product_variants(id)
quantity          integer DEFAULT 1
notify_on_restock boolean DEFAULT false
notify_on_sale    boolean DEFAULT false
source            enum ('product_page', 'contention_modal', 'sold_out_page')
created_at        timestamptz
last_notified_at  timestamptz NULL
last_notification_kind text NULL
UNIQUE (customer_id, variant_id)
```

**`priority_holds`** — active 30-minute priority holds.
```
id            uuid PK
variant_id    uuid → product_variants(id)
customer_id   uuid → customers(id)
quantity      integer
source        enum ('soft_wait_promotion', 'wishlist_notification')
granted_at    timestamptz
expires_at    timestamptz (granted_at + 30 min, or 5 min for soft_wait_promotion)
consumed_at   timestamptz NULL (set when customer adds to cart and proceeds)
```

**`pending_wishlist_notifications`** — manual mode queue.
```
id                  uuid PK
wishlist_item_id    uuid → wishlist_items(id)
variant_id          uuid → product_variants(id)
customer_id         uuid → customers(id)
quantity_to_offer   integer
triggered_by        enum ('stripe_abandon', 'cod_cancel', 'supply_receipt')
triggered_at        timestamptz
status              enum ('pending', 'notified', 'skipped', 'expired')
admin_action_by     uuid NULL → auth.users(id)
admin_action_at     timestamptz NULL
admin_message       text NULL (custom message override)
```

**`inventory_release_events`** — audit trail for inventory state changes.
```
id          uuid PK
variant_id  uuid → product_variants(id)
quantity    integer
event_type  enum ('stripe_abandon', 'cod_cancel', 'supply_receipt', 'priority_hold_expired', 'soft_hold_expired')
occurred_at timestamptz
metadata    jsonb (event-specific details)
```

### 14.3 Settings

Merchant-level setting for wishlist notification mode:

```sql
-- In an existing or new merchant_settings table
notification_mode_wishlist  enum ('automated', 'manual') DEFAULT 'manual'
```

---

## 15. Background jobs

### 15.1 Soft contention reaper

Runs every minute. Finds `cart_checkout_sessions` rows with `state='soft' AND expires_at < now()`. For each:
- Releases the soft hold (decrements `quantity_soft_held`).
- Advances the soft-wait queue per §7.3.
- Marks session `state='released'`.

### 15.2 Priority hold reaper

Runs every minute. Finds `priority_holds` rows with `expires_at < now() AND consumed_at IS NULL`. For each:
- Releases the hold (decrements `quantity_priority_held`).
- For soft_wait_promotion source: promotes next queue member.
- For wishlist_notification source: in automated mode, advances queue per §9.4; in manual mode, returns entry to admin pending queue.

### 15.3 Wishlist notification dispatcher (automated mode only)

Triggered by inventory release events (via Postgres trigger or app-side hook on Stripe webhook / COD cancellation / supply order receipt). For each event:
- Identifies wishlist subscribers for the affected variant in FIFO order.
- Applies the sequential-vs-parallel rule (§9.4).
- Creates priority hold rows and fires notifications.

### 15.4 Soft-wait → wishlist auto-converter

Runs hourly. Finds `soft_waits` rows older than 24 hours where the underlying `checkout_session` is in hard contention (Phase 3 via COD, long-running). For each:
- Removes the soft_wait entry (item still in customer's cart).
- Creates a wishlist entry with `notify_on_restock=true` if one doesn't exist.
- Fires a notification email: "X is still being processed. We've added it to your wishlist."

### 15.5 Pending wishlist notification expiry (manual mode)

Runs daily. Finds `pending_wishlist_notifications` rows older than 7 days in `status='pending'`. Marks them `status='expired'`. The admin sees them as historical records with no actionable state.

### 15.6 Stripe webhook handlers

Existing webhook infrastructure (`src/app/api/webhooks/stripe`) needs to hook into:
- `payment_intent.succeeded` → consume reservation, fire post-checkout flow.
- `payment_intent.payment_failed` → leave reservation alone (Stripe allows retries on the same intent).
- `payment_intent.canceled` → release reservation, trigger wishlist queue.
- `checkout.session.expired` → release reservation, trigger wishlist queue.

---

## 16. Edge cases

### 16.1 Multi-tab same customer

Customer A has X in cart, opens the product page in a second tab. Without correction, Tab 2 sees `effective_available = 0` (because A's own soft hold counts) and renders contention UI.

**Resolution:** the `effective_available` query must subtract the *current viewer's* own holds. This requires a per-viewer query rather than a global counter, slightly more expensive but necessary for correctness. The implementation should expose a function `effective_available_for(variant_id, viewer_id)` that nets out the viewer's own contributions.

### 16.2 Customer with priority hold removes item from cart

Customer was promoted from a wait queue or wishlist notification, has an active 30-minute priority hold, and explicitly removes the item from their cart. The hold should be released immediately, not wait for the 30-minute expiry. The next queue member is promoted.

### 16.3 Customer with priority hold deletes their wishlist entry

Same as 16.2 — release the hold immediately and advance the queue.

### 16.4 Discount recalculation when "Continue without" is chosen

Customer has X (€50) + Y (€30) in cart with a discount code that requires €70 minimum. At checkout, X is contested. Customer picks "Continue without X" — now the order is €30 and the discount no longer applies.

**Resolution:** "Continue without" doesn't immediately proceed to Stripe. It returns the customer to the cart page with X removed, a banner explaining the updated total, and a fresh "Proceed to Checkout" button. The customer must explicitly re-confirm at the new amount.

### 16.5 Stale modal handling

A customer leaves the contention modal open for 20 minutes without choosing an option. State has changed underneath (the original holder paid, abandoned, etc.). The modal must Realtime-update its state — if the inventory is now generally available, the modal updates to "Available now — Add to cart?" If it's been definitively sold, the modal updates to "Sold — Add to wishlist for restock?"

### 16.6 Customer signs out mid-wait

A customer in a soft-wait queue or with a priority hold signs out of their account. Their auth context is gone but the hold/queue entry references their `customer_id`. On sign-out, all active holds and queue entries belonging to that customer are explicitly released — sign-out is treated as cancel-everything.

### 16.7 Admin cancels an order with a hard reservation

An order in `payment_status='paid'` or `fulfillment_status='pending'` (COD) is cancelled by admin. The reservation must be released (decrements `quantity_reserved`), and the wishlist queue must be triggered.

### 16.8 Supplier restock event

When a supply order is received and inventory is incremented, the wishlist queue must be triggered for the affected variants. This is the same release-event flow as Stripe abandonment, just sourced from supply-order receipt rather than a customer abandonment.

### 16.9 Customer in priority hold who exceeds the 30-minute window mid-Stripe

The customer received their notification, clicked through, added to cart, started Stripe, and is taking too long. The priority hold expires while they're in Stripe. **Resolution:** when the customer adds to cart and proceeds, the priority hold is **converted** into a normal soft contention / hard reservation. The 30-minute clock is replaced by the standard checkout timers from that point. The customer is no longer dependent on the priority hold.

### 16.10 Multiple subscribers on the same wishlist entry source

Customer A wishlisted X via the product page on Day 1. Customer B wishlisted X via the contention modal on Day 5. When X becomes available, A is first in queue (FIFO by wishlist creation date), regardless of source.

---

## 17. Out of scope (decisions made but rejected)

These were considered during design and explicitly rejected. Documented here so future contributors don't re-litigate.

### 17.1 Cart-level locking on Add to Cart

**Rejected.** Cart presence does not lock inventory. Rationale: 60-80% of carts are abandoned in typical e-commerce; locking at Add to Cart would poison inventory for legitimate buyers proportional to abandonment rate. Lock at Proceed to Checkout instead.

### 17.2 15-minute exclusivity window at Add to Cart

**Rejected.** Considered as a hybrid (Add to Cart locks for 15 min, then becomes contestable). Adds significant UI/state complexity (Realtime cart updates, "wait 15 min" UX) without structurally protecting the first adder — they can still lose at checkout if they're slow. Reserve at Proceed to Checkout achieves the protection more cleanly.

### 17.3 Newsletter-as-back-in-stock architecture

**Rejected.** Wrong abstraction. Newsletter is a broadcast/recurring system; back-in-stock is one-recipient/one-shot/event-driven. Separate data and triggers; share only the `sendEmail` infrastructure.

### 17.4 Wishlist + back-in-stock as two separate features

**Rejected (in favor of unified wishlist with per-item flags).** Initial proposal kept them separate, but customer mental model is "I want this product, here's how I want to be informed." One wishlist with per-item notification flags collapses the concept while preserving functional separation.

### 17.5 Showing queue position to waiting customers

**Rejected.** "You're #3 in line" creates refresh anxiety. Opaque "We'll notify you" is calmer. Information value is low (customer can't act on the number anyway).

### 17.6 Auto-on default for wishlist automation

**Rejected (favor of opt-in manual mode).** Notification automation is transactional and unpredictable — a merchant who first launches the feature and discovers it fired 50 emails overnight without warning will be unhappy. Opt-in forces deliberate consent during onboarding.

---

## 18. Implementation considerations

### 18.1 Scope

This is a real feature, not a security fix. It should be:
- Scoped as a standalone PR or feature branch (not folded into the security hardening sprint).
- Designed with its own implementation plan covering migrations, Realtime setup, frontend state management, background jobs, and admin UI.
- Estimated rough order of 1-2 weeks of focused work for an experienced contributor.

### 18.2 Estimated LoC

Aggregate estimate by component:

| Component | Estimated LoC |
|---|---|
| Migrations (tables, columns, RPCs) | ~250 |
| Inventory math helpers + RPCs (`hold_soft`, `release_soft`, `promote_to_priority`, etc.) | ~200 |
| Realtime channel setup + subscriptions | ~150 |
| Frontend: product page state machine + CTA flipping | ~150 |
| Frontend: contention modal (with quantity-aware variants) | ~200 |
| Frontend: cart page wait states + Realtime updates | ~150 |
| Frontend: wishlist UI (Pattern A + account page) | ~250 |
| Wishlist notification dispatcher + cadence rules | ~200 |
| Admin manual-mode queue UI + actions | ~300 |
| Background jobs (4 reapers + 1 dispatcher) | ~200 |
| Email templates (3 variants: restock notification, soft-wait collapse, custom-admin-message) | ~100 |
| Tests | ~400 |
| **Total** | **~2,550** |

### 18.3 Dependencies

- Supabase Realtime enabled on the project (first-time setup).
- Supabase anonymous auth enabled (already decided for guest checkout).
- Postgres `pg_cron` or equivalent scheduled-job infrastructure for the reapers.
- Existing `sendEmail` infrastructure (already in place).

### 18.4 Migration order

Suggested implementation order to minimize half-broken states:

1. Migrations (tables, columns, RPCs) + base inventory math helpers.
2. Reserve-at-place-to-pay refactor (the underlying race protection). Stripe path moves from "decrement at webhook" to "reserve at Proceed, consume at webhook." This is the foundation; without it, the rest is decoration.
3. Contention modal at place-to-pay (without soft-wait queue or wishlist yet). Customers losing the race see "Continue without X" only.
4. Soft contention + soft-wait queue + Realtime CTA flipping.
5. Wishlist (table + product page UI + account page).
6. Wishlist notification dispatcher (automated mode first, simpler).
7. Manual mode + admin queue UI.
8. Background jobs (reapers + dispatchers).
9. Polish, edge case handling, tests.

Each step ships independently. The feature is usable in degraded form from step 3 onward.

### 18.5 Operational risks

- **Realtime adoption**: first time. Team needs to learn the failure modes (disconnections, reconnections, race conditions in subscribe-then-fetch patterns). Build operational tooling.
- **Background job correctness**: the reapers must be idempotent. A duplicate run on an already-released hold must be a no-op.
- **Counter accuracy**: the `quantity_soft_held` and `quantity_priority_held` counters must always equal the sum of their underlying rows. Inconsistency means oversell. Reconciliation job optional but worth building for v1.
- **Email deliverability**: notifications during the 30-minute priority window must arrive promptly. If your SMTP provider is slow, the priority window may pass before the customer sees the email. Monitor delivery times.

---

## 19. Open items for future iteration

These are intentionally deferred but worth tracking:

- **Wishlist with optional per-item "notify on sale" UI in account page** — the data model supports it (`notify_on_sale` column exists). UI for per-item toggling can be added incrementally.
- **Price-drop notifications** — same infrastructure pattern. Add a `notify_on_price_drop` column when needed.
- **Bulk wishlist export for offline merchant outreach** — useful for merchants who want to email wishlist subscribers about events, restocks, related products. Manual mode adjacent.
- **Cross-sell during wait** — when a customer is in soft-wait or sees a contention modal, suggest similar products. Captures bounce traffic. Conversion lift, not a security/correctness concern.
- **Analytics dashboard** — how many sales captured via wishlist notifications, average queue length per popular variant, abandonment rate of soft contention windows. Useful for tuning timers.
- **Multi-locale email templates** — currently Greek-only. The notification copy will need translation infrastructure when expanding markets.

---

## Appendix A — Decisions log

For traceability, the major decisions made during design discussion, with timestamps when known:

1. Lock at Proceed to Checkout, not Add to Cart (Interpretation B from initial framing).
2. Three-phase model (browsing / soft contention / hard contention) with distinct UI and timers per phase.
3. Quantity-aware contention math, not binary per-variant.
4. Contention modal with three options (wait / notify / continue) and quantity-aware variants for partial availability.
5. Soft-wait queue is FIFO by add-to-wait time, opaque to customer (no position display).
6. Soft-wait queue collapses to wishlist when soft-holder transitions to Phase 3.
7. Wishlist as single unified concept with per-item notification flags (not separate "wishlist" + "back-in-stock subscription").
8. `notify_on_restock` is one-shot (auto-clear after firing); `notify_on_sale` is recurring.
9. Product page UI: Pattern A (quick save with chevron-expand for options).
10. Sequential notification with parallel optimization when supply ≥ demand.
11. 30-minute priority hold per notified subscriber.
12. Email copy honest about queue position and non-guaranteed nature.
13. Merchant can toggle wishlist notification mode (automated vs manual); default is manual (opt-in to automation).
14. Manual mode supports custom message override per recipient.
15. Items in manual mode go to general availability immediately if admin doesn't act (wishlist is contact list, not lock).
16. Guest checkout via anonymous Supabase auth; wishlist requires account upgrade with inline magic-link signup.
17. Realtime is the first-time infrastructure introduction; plan accordingly.
18. Timers: 15 min soft contention, 30 min Stripe session, 5 min soft-wait promotion, 30 min wishlist priority hold, 24 hr soft-wait auto-conversion to wishlist.
