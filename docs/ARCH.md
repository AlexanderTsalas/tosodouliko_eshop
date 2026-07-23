# Arch Context: `kids_eshop`

_Generated 2026-05-24 22:19 UTC · 1238 nodes · 2439 edges · 789 diagnostics_

> ⚠ **169 errors · 205 warnings** — review Diagnostics section

---

## Tech Stack

- **Next.js** ^14.2.18
- Supabase (PostgreSQL + Auth + Storage)
- Stripe
- Email: Resend, Nodemailer

---

## Architecture Layers

| Layer | Count | Client | Diagnostics |
|-------|-------|--------|-------------|
| 📄 Pages | 82 | — | 🔴 57 errors, 73 total |
| 🧩 Components | 214 | 96 client | 🟡 7 warnings/info |
| 🪝 Hooks | 4 | 4 client | ✅ clean |
| ⚡ Actions | 138 | — | 🔴 1 errors, 137 total |
| 🔌 API Routes | 9 | — | 🔴 4 errors, 9 total |
| 🛠 Services | 86 | — | ✅ clean |
| 🔐 Auth | 174 | — | 🔴 1 errors, 53 total |
| 🗄 Database | 342 | — | 🔴 2 errors, 72 total |
| ☁ Infrastructure | 189 | — | 🔴 104 errors, 149 total |

---

## Route Inventory

- `PAGE` **account/addresses** ⚠[SEO-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:customers, reads:addresses
- `PAGE` **account** ⚠[SEO-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:user_profiles, calls:signOut
- `PAGE` **account/sessions** ⚠[SEO-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:user_sessions
- `PAGE` **admin/attributes** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:attributes, reads:attribute_values
- `PAGE` **admin/audit-log** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:audit_events
- `PAGE` **admin/categories/new** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:categories, reads:attributes, reads:attribute_values, reads:vat_rates
- `PAGE` **admin/categories** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:categories
- `PAGE` **admin/categories/[id]/edit** ⚠[SEC-001,CV-014,MI-012,MI-013] → calls:createClient, reads:categories, reads:attributes, reads:attribute_values, reads:vat_rates
- `PAGE` **admin/currencies** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:currencies
- `PAGE` **admin/customers/new** ⚠[SEC-001,MI-012,SG-004]
- `PAGE` **admin/customers** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:roles, reads:user_roles, reads:customers, reads:orders
- `PAGE` **admin/customers/[id]** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:customers, reads:orders, reads:addresses, calls:formatCurrency
- `PAGE` **admin/discounts/new** ⚠[SEC-001,MI-012,SG-004]
- `PAGE` **admin/discounts** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:discount_codes
- `PAGE` **admin/discounts/[id]/edit** ⚠[SEC-001,CV-014,MI-012,MI-013] → calls:createClient, reads:discount_codes
- `PAGE` **admin/errors** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:error_events
- `PAGE` **admin/inventory** ⚠[SEC-001,CV-014,BP-010,MI-012,MI-013,SG-004] → calls:createClient, calls:parseSelection, reads:categories, reads:suppliers, reads:product_categories, reads:products, reads:supplier_products, reads:inventory_items, calls:stockStatus, reads:supply_orders
- `PAGE` **admin/inventory-debug** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:requirePermission, calls:createAdminClient, reads:product_variants, reads:inventory_items, reads:cart_checkout_sessions, reads:priority_holds, reads:soft_waits, reads:wishlist_items, reads:cart_items
- `PAGE` **admin/media** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:media_assets
- `PAGE` **admin/mfa-enroll** ⚠[SEC-001,MI-012,SG-004] → calls:createClient, calls:checkPermission
- `PAGE` **admin/mfa-verify** ⚠[SEC-001,MI-012,SG-004] → calls:createClient
- `PAGE` **admin/newsletter** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:newsletter_subscribers
- `PAGE` **admin/orders/new** ⚠[SEC-001,MI-012,SG-004]
- `PAGE` **admin/orders** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:orders, calls:formatCurrency
- `PAGE` **admin/orders/[id]** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:orders, reads:order_items, reads:payment_intents, reads:shipments, calls:formatCurrency
- `PAGE` **admin** ⚠[SEC-001,MI-012,SG-004]
- `PAGE` **admin/permissions** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:permissions
- `PAGE` **admin/products/bulk-edit** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:parseSelection, calls:resolveProductIds, calls:createClient, reads:vat_rates, reads:suppliers, reads:categories, reads:attributes, reads:attribute_values
- `PAGE` **admin/products/new** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:attributes, reads:attribute_values, reads:categories, reads:vat_rates
- `PAGE` **admin/products** ⚠[SEC-001,CV-014,BP-010,MI-012,MI-013,SG-004] → calls:createClient, calls:parseAdminProductFilters, calls:parseSelection, reads:categories, reads:suppliers, reads:vat_rates, reads:attributes, reads:attribute_values, calls:resolveProductRestriction, reads:products, reads:product_variants, calls:stockStatus, calls:flattenForPreserve, calls:countActiveFilters, calls:formatCurrency
- `PAGE` **admin/products/[id]/edit** ⚠[SEC-001,CV-014,MI-012,MI-013] → calls:createClient, reads:products, reads:product_variants, reads:vat_rates, reads:product_categories, reads:suppliers, reads:attributes, reads:attribute_values, calls:getProductSpecifications, calls:normaliseJoinedCategories, calls:resolveEffectiveVatRate, reads:product_images, reads:categories, reads:seo_metadata
- `PAGE` **admin/products/[id]/variants/[variantId]** ⚠[SEC-001,CV-014,MI-012,MI-013] → calls:createClient, reads:product_variants, reads:products, reads:attributes, reads:attribute_values, reads:vat_rates, reads:product_categories, calls:normaliseJoinedCategories, reads:inventory_items, reads:suppliers, calls:getSuppliersForVariant, reads:product_images, reads:seo_metadata, calls:resolveEffectiveVatRate
- `PAGE` **admin/reports/margins** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:products, reads:vat_rates, reads:product_categories, calls:pushJoinedCategory, calls:resolveEffectiveVatRate, calls:computeMargin
- `PAGE` **admin/returns** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:return_requests
- `PAGE` **admin/roles/new** ⚠[SEC-001,MI-012,SG-004]
- `PAGE` **admin/roles** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:roles, reads:role_permissions
- `PAGE` **admin/roles/[id]/edit** ⚠[SEC-001,CV-014,MI-012,MI-013] → calls:createAdminClient, reads:roles, reads:permissions, reads:role_permissions
- `PAGE` **admin/seo/edit** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:seo_metadata
- `PAGE` **admin/seo/new** ⚠[SEC-001,MI-012,SG-004]
- `PAGE` **admin/seo** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:seo_metadata
- `PAGE` **admin/settings/couriers** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:carrier_provider_configs
- `PAGE` **admin/settings/email** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:email_provider_configs
- `PAGE` **admin/settings/fees** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:fee_categories, reads:fee_rules
- `PAGE` **admin/shipping** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:shipping_zones, reads:shipping_rates
- `PAGE` **admin/shipping/rates/new** ⚠[SEC-001,CV-014,MI-012,MI-013] → calls:createClient, reads:shipping_zones
- `PAGE` **admin/shipping/rates/[id]/edit** ⚠[SEC-001,CV-014,MI-012,MI-013] → calls:createClient, reads:shipping_rates, reads:shipping_zones
- `PAGE` **admin/shipping/zones/new** ⚠[SEC-001,MI-012]
- `PAGE` **admin/shipping/zones/[id]/edit** ⚠[SEC-001,CV-014,MI-012,MI-013] → calls:createClient, reads:shipping_zones
- `PAGE` **admin/suppliers/new** ⚠[SEC-001,MI-012,SG-004]
- `PAGE` **admin/suppliers** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:suppliers
- `PAGE` **admin/suppliers/[id]** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:suppliers, reads:supply_orders
- `PAGE` **admin/supply-orders** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:supply_orders, calls:resolveLowStockBuckets, reads:suppliers
- `PAGE` **admin/supply-orders/[id]** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:supply_orders
- `PAGE` **admin/tracking** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:tracking_events
- `PAGE` **admin/translations** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:translations
- `PAGE` **admin/users/new** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:roles
- `PAGE` **admin/users** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:user_roles, reads:user_profiles
- `PAGE` **admin/users/[id]** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:user_profiles, reads:roles, reads:user_roles
- `PAGE` **admin/vat-rates** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:vat_rates
- `PAGE` **admin/wishlist-queue** ⚠[SEC-001,CV-014,MI-012,MI-013,SG-004] → calls:requirePermission, calls:createAdminClient, reads:notification_settings, reads:pending_wishlist_notifications, reads:product_variants, reads:customers, reads:inventory_items
- `API_ROUTE` **POST /api/checkout/heartbeat** ⚠[PV-004,SEC-008] → calls:createClient, calls:createAdminClient, reads:customers, writes:cart_checkout_sessions
- `API_ROUTE` **POST /api/checkout/release** ⚠[DC-004] → calls:createClient, calls:createAdminClient, reads:customers, reads:cart_checkout_sessions, calls:logAuditEvent
- `API_ROUTE` **GET /api/cron/wishlist-advance** ⚠[DC-004] → calls:tickleWishlistDispatcher
- `API_ROUTE` **POST /api/cron/wishlist-advance** ⚠[SEC-011,DC-004]
- `API_ROUTE` **POST /api/track** ⚠[DC-004] → calls:trackEvent
- `WEBHOOK_HANDLER` **POST** ⚠[SEC-010] → calls:activeProviderKind, calls:createAdminClient, reads:payment_intents, calls:handleSessionCompleted, calls:handleSessionExpired, calls:handleSessionFailed, calls:logAuditEvent
- `WEBHOOK_HANDLER` **POST** ⚠[SEC-010] → calls:handleSessionCompleted, calls:handleSessionExpired, calls:handleSessionFailed, calls:logAuditEvent
- `API_ROUTE` **GET /auth/callback** ⚠[DC-004] → calls:createClient
- `PAGE` **auth/signin** ⚠[SEO-006,MI-012,SG-004]
- `PAGE` **auth/signup** ⚠[SEO-006,MI-012,SG-004]
- `PAGE` **cart** ⚠[SEO-001,SG-004] → calls:getCart
- `PAGE` **checkout/mock/[session_id]** ⚠[SEO-006,CV-014,MI-012,MI-013,SG-004] → calls:createAdminClient, reads:payment_intents, reads:orders, calls:formatCurrency
- `PAGE` **checkout** ⚠[SEO-006,MI-013,SG-004] → calls:createClient, calls:getCart, reads:customers, calls:createAdminClient, reads:cart_checkout_sessions, reads:addresses, calls:formatCurrency
- `PAGE` **checkout/payment/[id]** ⚠[SEO-006,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:customers, reads:orders, calls:createAdminClient, reads:payment_intents, calls:createCheckoutSession
- `PAGE` **checkout/success/[id]** ⚠[SEO-006,CV-014,MI-012,MI-013,SG-004] → calls:createClient, reads:customers, reads:orders, reads:order_items, calls:formatCurrency
- `LAYOUT` **/ (layout)**
- `PAGE` **orders** ⚠[SEO-001,MI-012,SG-004] → calls:createClient
- `PAGE` **orders/[id]** ⚠[SEO-001,MI-022,CV-014,MI-012,MI-013,SG-004,SEO-002] → calls:createClient, reads:orders, reads:order_items, calls:formatCurrency
- `PAGE` **/** ⚠[SEO-001]
- `PAGE` **products** ⚠[SEO-001,SG-004] → calls:searchVariants, calls:getCatalogFacets
- `PAGE` **products/[slug]** ⚠[SEO-001,MI-022,MI-012,SG-004,SEO-002] → calls:getProductBySlug, calls:getActiveCurrency, calls:getCurrencyRates, calls:convertWithRates, calls:formatCurrency, calls:getProductSpecifications, calls:getEffectiveAvailableForVariants
- `PAGE` **wishlist** ⚠[SEO-001,MI-013,SG-004] → calls:createClient, reads:customers, calls:getWishlistWithProducts
- `MIDDLEWARE` **middleware** ⚠[SEC-016] → calls:updateSession

---

## Data Pipelines

**`has_permission`** (function)
  - _(no graph edges detected — check direct SQL)_
**`user_profiles`**
  - reads: createShipment, requestReturn, account, admin/users, admin/users/[id]
  - writes: createUser
**`permissions`**
  - reads: deletePermission, admin/permissions, admin/roles/[id]/edit
  - writes: createPermission, deletePermission
**`roles`**
  - reads: deleteRole, revokeRole, deleteUser, admin/customers, admin/roles, admin/roles/[id]/edit, admin/users/new, admin/users/[id]
  - writes: createRole, deleteRole, updateRole
**`role_permissions`**
  - reads: admin/roles, admin/roles/[id]/edit
  - writes: setRolePermissions
**`user_roles`**
  - reads: revokeRole, deleteUser, admin/customers, admin/users, admin/users/[id], getUserRoles
  - writes: assignRole, revokeRole, createUser
**`audit_events`**
  - reads: admin/audit-log
  - writes: logAuditEvent
**`addresses`**
  - reads: deleteAddress, saveAddress, placeOrder, account/addresses, admin/customers/[id], checkout
  - writes: deleteAddress, saveAddress
**`attributes`**
  - reads: deleteAttribute, addProductSpec, admin/attributes, admin/categories/new, admin/categories/[id]/edit, admin/products/bulk-edit, admin/products/new, admin/products, admin/products/[id]/edit, admin/products/[id]/variants/[variantId], sitemap, resolveProductRestriction, getCatalogFacets, getProductBySlug, searchVariants
  - writes: createAttribute, deleteAttribute, updateAttribute
**`attribute_values`**
  - reads: createAttributeValue, deleteAttributeValue, admin/attributes, admin/categories/new, admin/categories/[id]/edit, admin/products/bulk-edit, admin/products/new, admin/products, admin/products/[id]/edit, admin/products/[id]/variants/[variantId]
  - writes: createAttributeValue, deleteAttributeValue, updateAttributeValue
**`categories`**
  - reads: createCategory, deleteCategory, updateCategory, admin/categories/new, admin/categories, admin/categories/[id]/edit, admin/inventory, admin/products/bulk-edit, admin/products/new, admin/products, admin/products/[id]/edit, CategoryNav, searchProducts, searchVariants
  - writes: createCategory, deleteCategory, updateCategory
**`currencies`**
  - reads: deleteCurrency, upsertCurrency, admin/currencies, convertPrice, getCurrencies, getCurrencyRates
  - writes: deleteCurrency, upsertCurrency
**`translations`**
  - reads: deleteTranslation, upsertTranslation, admin/translations, LanguageSwitcher, getAvailableLocales, getTranslations
  - writes: deleteTranslation, upsertTranslation
**`seo_metadata`** ⚠ BP-003
  - reads: deleteSeoMetadata, upsertSeoMetadata, admin/products/[id]/edit, admin/products/[id]/variants/[variantId], admin/seo/edit, admin/seo, generateSeoMetadata
  - writes: createProduct, deleteSeoMetadata, upsertSeoMetadata
**`error_events`**
  - reads: admin/errors
  - writes: setErrorResolved, captureError
**`products`** ⚠ BP-003
  - reads: addToCart, searchAdminVariants, deleteProduct, updateProduct, applyDefaultSupplierToVariants, addVariant, admin/inventory, admin/products, admin/products/[id]/edit, admin/products/[id]/variants/[variantId], admin/reports/margins, sitemap, useSearch, resolveProductRestriction, resolveProductIds, resolveVariantInventoryIds, getProductBySlug, searchProducts, searchVariants, fireWishlistNotification.ts, getWishlistWithProducts
  - writes: bulkDeleteProducts, bulkSetActive, bulkUpdateProducts, createProduct, deleteProduct, updateProduct
**`product_images`**
  - reads: addProductImage, deleteProductImage, reorderProductImages, setImageVariant, setPrimaryImage, admin/products/[id]/edit, admin/products/[id]/variants/[variantId], getProductBySlug, searchVariants, dispatchWishlistNotifications, fireWishlistNotification.ts
  - writes: addProductImage, deleteProductImage, reorderProductImages, setImageVariant, setPrimaryImage
**`product_categories`** ⚠ BP-003
  - reads: placeOrder, createOrder, setProductCategories, admin/inventory, admin/products/[id]/edit, admin/products/[id]/variants/[variantId], admin/reports/margins, resolveProductRestriction, resolveVariantInventoryIds, getProductBySlug, searchProducts, searchVariants
  - writes: bulkUpdateProducts, createProduct, setProductCategories
**`product_variants`** ⚠ BP-003
  - reads: deleteAttribute, deleteAttributeValue, addToCart, addToCartWithContentionCheck, joinSoftWaitQueue, createOrder, searchAdminVariants, addProductSpec, bulkUpdateProducts, applyDefaultSupplierToVariants, searchSupplierVariants, addInventoryVariantsToDrafts, addManyToDraft, addToDraft, confirmReceipt, addVariant, deleteVariant, updateVariant, admin/inventory-debug, admin/products, admin/products/[id]/edit, admin/products/[id]/variants/[variantId], admin/wishlist-queue, sitemap, resolveProductRestriction, getCatalogFacets, getProductBySlug, searchVariants, dispatchWishlistNotifications, fireWishlistNotification.ts, getWishlistWithProducts
  - writes: bulkSetTrackSupply, createProduct, addVariant, deleteVariant, updateVariant
**`inventory_items`**
  - reads: setInventoryLevel, addInventoryVariantsToDrafts, addManyToDraft, addToDraft, admin/inventory, admin/inventory-debug, admin/products/[id]/variants/[variantId], admin/wishlist-queue, resolveVariantInventoryIds, resolveLowStockBuckets, tickleWishlistDispatcher
  - writes: bulkSetQuantity, bulkSetThreshold
**`decrement_inventory`** (function)
  - _(no graph edges detected — check direct SQL)_
**`discount_codes`**
  - reads: createDiscountCode, deleteDiscountCode, updateDiscountCode, admin/discounts, admin/discounts/[id]/edit, validateDiscount
  - writes: applyDiscount, createDiscountCode, deleteDiscountCode, updateDiscountCode
**`discount_usage`**
  - writes: applyDiscount
**`carts`**
  - reads: addToCart, joinSoftWaitQueue, mergeAnonCart, placeOrder, startCheckoutSession, getCart, getCartItemCount
  - writes: addToCart, joinSoftWaitQueue, mergeAnonCart, placeOrder
**`cart_items`**
  - reads: addToCart, joinSoftWaitQueue, mergeAnonCart, removeFromCart, updateCartItem, placeOrder, startCheckoutSession, admin/inventory-debug, getCart
  - writes: addToCart, joinSoftWaitQueue, leaveSoftWaitQueue, mergeAnonCart, removeFromCart, updateCartItem
**`wishlists`**
  - reads: subscribeToRestock, toggleWishlist, getWishlist
  - writes: subscribeToRestock, toggleWishlist
**`wishlist_items`**
  - reads: removeWishlistItem, subscribeToRestock, toggleWishlist, updateWishlistFlags, admin/inventory-debug, dispatchWishlistNotifications, fireWishlistNotification.ts, getWishlist, tickleWishlistDispatcher
  - writes: removeWishlistItem, subscribeToRestock, toggleWishlist, updateWishlistFlags, dispatchWishlistNotifications, fireWishlistNotification
**`orders`**
  - reads: createShipment, deleteCustomer, deleteOrder, refundOrder, transitionOrderStatus, createCheckoutSession, requestReturn, deleteUser, admin/customers, admin/customers/[id], admin/orders, admin/orders/[id], checkout/mock/[session_id], checkout/payment/[id], checkout/success/[id], orders/[id], OrderHistory
  - writes: placeOrder, createOrder, deleteOrder, refundOrder, transitionOrderStatus, handleSessionCompleted, handleSessionFailed
**`order_items`**
  - reads: deleteOrder, refundOrder, transitionOrderStatus, createCheckoutSession, admin/orders/[id], checkout/success/[id], orders/[id], handleSessionCompleted
  - writes: placeOrder, createOrder
**`payment_intents`**
  - reads: refundOrder, admin/orders/[id], POST, checkout/mock/[session_id], checkout/payment/[id], handleSessionCompleted, handleSessionFailed, handleSessionExpired
  - writes: createCheckoutSession, handleSessionCompleted, handleSessionFailed, handleSessionExpired
**`payment_transactions`**
  - _(no graph edges detected — check direct SQL)_
**`shipping_zones`**
  - reads: createShippingZone, deleteShippingZone, updateShippingZone, admin/shipping, admin/shipping/rates/new, admin/shipping/rates/[id]/edit, admin/shipping/zones/[id]/edit, getShippingMethods
  - writes: createShippingZone, deleteShippingZone, updateShippingZone
**`shipping_rates`**
  - reads: createShippingRate, deleteShippingRate, updateShippingRate, admin/shipping, admin/shipping/rates/[id]/edit, getShippingMethods
  - writes: createShippingRate, deleteShippingRate, updateShippingRate
**`shipping_rates_tiers`**
  - _(no graph edges detected — check direct SQL)_
**`shipments`**
  - reads: admin/orders/[id]
  - writes: createShipment
**`shipment_events`**
  - _(no graph edges detected — check direct SQL)_
**`return_requests`**
  - reads: requestReturn, admin/returns, AdminReturnPanel
  - writes: requestReturn, AdminReturnPanel
**`return_items`**
  - reads: requestReturn
  - writes: requestReturn
**`user_sessions`**
  - reads: revokeSession, account/sessions
  - writes: revokeSession
**`cleanup_expired_sessions`** (function)
  - _(no graph edges detected — check direct SQL)_
**`media_assets`**
  - reads: deleteMediaAsset, updateMediaAsset, uploadMedia, admin/media
  - writes: deleteMediaAsset, updateMediaAsset, uploadMedia
**`tracking_events`**
  - reads: admin/tracking, trackEvent
  - writes: trackEvent
**`chat_sessions`**
  - _(no graph edges detected — check direct SQL)_
**`chat_messages`**
  - _(no graph edges detected — check direct SQL)_
**`marketplace_listings`**
  - reads: syncListings
  - writes: syncListings
**`crm_contacts`**
  - writes: syncContactToCRM
**`newsletter_subscribers`** ⚠ SEC-005
  - reads: subscribeNewsletter, admin/newsletter
  - writes: subscribeNewsletter, updateSubscriber
**`log_audit_event`** (function)
  - _(no graph edges detected — check direct SQL)_
**`handle_new_user`** (function)
  - _(no graph edges detected — check direct SQL)_
**`create_default_wishlist`** (function)
  - _(no graph edges detected — check direct SQL)_
**`ensure_single_default_address`** (function)
  - _(no graph edges detected — check direct SQL)_
**`update_cart_totals`** (function)
  - _(no graph edges detected — check direct SQL)_
**`sync_inventory_from_variant`** (function)
  - _(no graph edges detected — check direct SQL)_
**`grant_role_by_email`** (function)
  - _(no graph edges detected — check direct SQL)_
**`grant_admin_by_email`** (function)
  - _(no graph edges detected — check direct SQL)_
**`revoke_role_by_email`** (function)
  - _(no graph edges detected — check direct SQL)_
**`set_inventory_level`** (function)
  - _(no graph edges detected — check direct SQL)_
**`prevent_last_variant_deletion`** (function)
  - _(no graph edges detected — check direct SQL)_
**`vat_rates`** ⚠ SEC-004
  - reads: createVatRate, deleteVatRate, updateVatRate, admin/categories/new, admin/categories/[id]/edit, admin/products/bulk-edit, admin/products/new, admin/products, admin/products/[id]/edit, admin/products/[id]/variants/[variantId], admin/reports/margins, admin/vat-rates
  - writes: createVatRate, deleteVatRate, updateVatRate
**`suppliers`** ⚠ SEC-004
  - reads: createSupplier, deleteSupplier, saveReceiptColumnMap, updateSupplier, admin/inventory, admin/products/bulk-edit, admin/products, admin/products/[id]/edit, admin/products/[id]/variants/[variantId], admin/suppliers, admin/suppliers/[id], admin/supply-orders
  - writes: createSupplier, deleteSupplier, saveReceiptColumnMap, updateSupplier
**`supplier_products`** ⚠ BP-003, SEC-004
  - reads: applyDefaultSupplierToVariants, linkSupplierToVariant, searchSupplierVariants, unlinkSupplierFromVariant, updateSupplierProduct, addInventoryVariantsToDrafts, addManyToDraft, addToDraft, confirmReceipt, addVariant, admin/inventory, resolveProductRestriction, resolveVariantInventoryIds, getSuppliersForVariant, resolveLowStockBuckets
  - writes: bulkUpdateProducts, createProduct, applyDefaultSupplierToVariants, linkSupplierToVariant, unlinkSupplierFromVariant, updateSupplierProduct, confirmReceipt, addVariant
**`supply_orders`** ⚠ SEC-004
  - reads: deleteSupplier, addInventoryVariantsToDrafts, addManyToDraft, addToDraft, cancelOrder, confirmReceipt, manualStatusChange, placeOrder, removeDraftLine, removeInventoryVariantsFromDrafts, admin/inventory, admin/suppliers/[id], admin/supply-orders, admin/supply-orders/[id], resolveLowStockBuckets
  - writes: addInventoryVariantsToDrafts, addManyToDraft, addToDraft, cancelOrder, confirmReceipt, manualStatusChange, placeOrder, removeDraftLine, removeInventoryVariantsFromDrafts
**`supply_order_lines`** ⚠ SEC-004
  - reads: addInventoryVariantsToDrafts, addManyToDraft, addToDraft, confirmReceipt, placeOrder, removeDraftLine, removeInventoryVariantsFromDrafts, updateDraftLine
  - writes: addInventoryVariantsToDrafts, addManyToDraft, addToDraft, confirmReceipt, removeDraftLine, removeInventoryVariantsFromDrafts, updateDraftLine
**`purchase_lots`** ⚠ SEC-004
  - reads: addInventoryVariantsToDrafts, addManyToDraft, getCurrentSupplierCost, getSuppliersForVariant, getWeightedAverageCost, resolveLowStockBuckets
  - writes: confirmReceipt
**`increment_inventory`** (function)
  - _(no graph edges detected — check direct SQL)_
**`product_specifications`** ⚠ SEC-004
  - reads: addProductSpec, removeProductSpec, updateProductSpec, resolveProductRestriction, getProductSpecifications, getCatalogFacets, searchVariants
  - writes: addProductSpec, removeProductSpec, updateProductSpec, bulkUpdateProducts
**`generate_order_number`** (function)
  - _(no graph edges detected — check direct SQL)_
**`reserve_inventory`** (function)
  - _(no graph edges detected — check direct SQL)_
**`release_reservation`** (function)
  - _(no graph edges detected — check direct SQL)_
**`consume_reservation`** (function)
  - _(no graph edges detected — check direct SQL)_
**`restore_inventory`** (function)
  - _(no graph edges detected — check direct SQL)_
**`customers`**
  - reads: deleteAddress, saveAddress, signOut, joinSoftWaitQueue, leaveSoftWaitQueue, removeFromCart, placeOrder, startCheckoutSession, deleteCustomer, matchOrCreateCustomer, createOrder, searchCustomers, createCheckoutSession, deleteUser, removeWishlistItem, account/addresses, admin/customers, admin/customers/[id], admin/wishlist-queue, POST /api/checkout/heartbeat, POST /api/checkout/release, checkout, checkout/payment/[id], checkout/success/[id], wishlist, OrderHistory, dispatchWishlistNotifications, fireWishlistNotification.ts, getWishlistWithProducts
  - writes: mergeAnonCart, deleteCustomer, matchOrCreateCustomer, updateCustomer
**`sync_customer_from_profile`** (function)
  - _(no graph edges detected — check direct SQL)_
**`email_provider_configs`**
  - reads: deleteEmailProvider, sendTestEmail, setActiveProvider, admin/settings/email, loadActiveProvider
  - writes: deleteEmailProvider, sendTestEmail, setActiveProvider, upsertEmailProvider
**`fee_categories`**
  - reads: deleteFeeCategory, admin/settings/fees, resolveFees
  - writes: deleteFeeCategory, saveFeeCategory
**`fee_rules`**
  - reads: deleteFeeRule, admin/settings/fees, resolveFees
  - writes: deleteFeeRule, saveFeeRule
**`carrier_provider_configs`**
  - reads: deleteCarrierProvider, setActiveCarrierProvider, testCarrierProvider, admin/settings/couriers, loadCarrierProvider
  - writes: deleteCarrierProvider, setActiveCarrierProvider, testCarrierProvider, upsertCarrierProvider
**`acs_postcode_cache`**
  - reads: quote.ts
  - writes: quote.ts
**`acs_station_cache`**
  - reads: listAcsStations
  - writes: listAcsStations
**`hold_soft`** (function)
  - _(no graph edges detected — check direct SQL)_
**`release_soft`** (function)
  - _(no graph edges detected — check direct SQL)_
**`promote_soft_to_reserved`** (function)
  - _(no graph edges detected — check direct SQL)_
**`effective_available_for`** (function)
  - _(no graph edges detected — check direct SQL)_
**`cart_checkout_sessions`** ⚠ PV-004
  - reads: signOut, joinSoftWaitQueue, placeOrder, startCheckoutSession, admin/inventory-debug, POST /api/checkout/release, checkout
  - writes: placeOrder, startCheckoutSession, POST /api/checkout/heartbeat, handleSessionFailed, handleSessionExpired
**`reap_stale_soft_sessions`** (function)
  - _(no graph edges detected — check direct SQL)_
**`cleanup_expired_sessions_for_variant`** (function)
  - _(no graph edges detected — check direct SQL)_
**`reconcile_orphan_soft_held`** (function)
  - _(no graph edges detected — check direct SQL)_
**`release_soft_session`** (function)
  - _(no graph edges detected — check direct SQL)_
**`release_stale_heartbeat_sessions`** (function)
  - _(no graph edges detected — check direct SQL)_
**`soft_waits`**
  - reads: joinSoftWaitQueue, leaveSoftWaitQueue, admin/inventory-debug, getCart
  - writes: signOut, joinSoftWaitQueue, leaveSoftWaitQueue
**`priority_holds`**
  - reads: leaveSoftWaitQueue, startCheckoutSession, forceReleasePriorityHold, admin/inventory-debug, getCart, releaseCustomerPriorityHolds, tickleWishlistDispatcher
  - writes: leaveSoftWaitQueue, startCheckoutSession, forceReleasePriorityHold, releaseCustomerPriorityHolds, dispatchWishlistNotifications, fireWishlistNotification
**`promote_to_priority`** (function)
  - _(no graph edges detected — check direct SQL)_
**`release_priority`** (function)
  - _(no graph edges detected — check direct SQL)_
**`consume_priority_to_soft`** (function)
  - _(no graph edges detected — check direct SQL)_
**`advance_soft_wait_queue_for_session`** (function)
  - _(no graph edges detected — check direct SQL)_
**`advance_soft_wait_queue_after_priority_expiry`** (function)
  - _(no graph edges detected — check direct SQL)_
**`collapse_soft_wait_queue_for_session`** (function)
  - _(no graph edges detected — check direct SQL)_
**`release_expired_priority_holds`** (function)
  - _(no graph edges detected — check direct SQL)_
**`notification_settings`**
  - reads: updateNotificationMode, admin/wishlist-queue, dispatchWishlistNotifications
  - writes: updateNotificationMode
**`pending_wishlist_notifications`**
  - reads: bulkNotify, notifyPending, admin/wishlist-queue
  - writes: bulkNotify, notifyPending, releaseToGeneral, skipPending, dispatchWishlistNotifications
**`sync_user_profile_on_auth_email_change`** (function)
  - _(no graph edges detected — check direct SQL)_
**`getSession`** ⚠ CV-003, DR-002
  - _(no graph edges detected — check direct SQL)_
**`MediaBrowser`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`EnrollMFAForm`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`VerifyMFAForm`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`ProductImagesEditor`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`ReceiptWorkspace`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`VariantImagesTab`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`LoginForm`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`SignupForm`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`CategoryNav`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`MediaPicker`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`OrderHistory`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`AdminReturnPanel`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`LanguageSwitcher`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`WishlistRealtimeBanner`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`Header`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`useCartRealtime`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`useEnsureSession`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`useIsAnonymous`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`usePermission`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`useSearch`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`useVariantInventoryRealtime`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`redirectToSignupIfNotPermanent`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`resolveProductIds`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`resolveVariantInventoryIds`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getCart`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getCartItemCount`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`validateDiscount`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`generateSeoMetadata`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getEffectiveAvailableForVariants`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`convertPrice`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getCurrencies`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getCurrencyRates`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getProductSpecifications`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`checkPermission`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getUserRoles`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`requireMFA`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getShippingMethods`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getCatalogFacets`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getProductBySlug`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`searchProducts`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`searchVariants`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`createClient`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getCurrentSupplierCost`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getSuppliersForVariant`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getWeightedAverageCost`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`resolveLowStockBuckets`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getAvailableLocales`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getTranslations`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`trackEvent`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getWishlist`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`getWishlistWithProducts`** ⚠ DR-002
  - _(no graph edges detected — check direct SQL)_
**`customers`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`addresses`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`attributes`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`attribute_values`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`product_variants`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`soft_waits`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`cart_checkout_sessions`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`products`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`carts`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`cart_items`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`priority_holds`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`users`** ⚠ SEC-004
  - reads: mergeAnonCart
**`categories`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`product_categories`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`orders`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`order_items`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`shipments`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`user_profiles`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`carrier_provider_configs`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`acs_station_cache`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`currencies`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`discount_codes`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`discount_usage`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`email_provider_configs`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`error_events`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`fee_categories`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`fee_rules`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`inventory_items`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`media_assets`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`newsletter_subscribers`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`payment_intents`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`product_images`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`product_specifications`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`supplier_products`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`seo_metadata`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`user_roles`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`permissions`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`roles`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`role_permissions`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`return_requests`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`return_items`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`user_sessions`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`shipping_rates`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`shipping_zones`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`suppliers`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`supply_orders`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`purchase_lots`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`supply_order_lines`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`translations`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`vat_rates`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`wishlist_items`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`wishlists`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`pending_wishlist_notifications`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`notification_settings`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`audit_events`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`tracking_events`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`acs_postcode_cache`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`crm_contacts`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_
**`marketplace_listings`** ⚠ SEC-004
  - _(no graph edges detected — check direct SQL)_

---

## Auth Pipeline

- Middleware: **middleware**
  - Auth logic detected in source (no explicit route-level protection edges traced)

**DB Client Tiers:**
- `user` **getSession**
- `browser` **MediaBrowser**
- `browser` **EnrollMFAForm**
- `browser` **VerifyMFAForm**
- `browser` **ProductImagesEditor**
- `browser` **ReceiptWorkspace**
- `browser` **VariantImagesTab**
- `browser` **LoginForm**
- `browser` **SignupForm**
- `user` **CategoryNav**
- `browser` **MediaPicker**
- `user` **OrderHistory**
- `browser` **AdminReturnPanel**
- `browser` **LanguageSwitcher**
- `browser` **WishlistRealtimeBanner**
- `user` **Header**
- `browser` **useCartRealtime**
- `browser` **useEnsureSession**
- `browser` **useIsAnonymous**
- `browser` **usePermission**
- `browser` **useSearch**
- `browser` **useVariantInventoryRealtime**
- `browser` **redirectToSignupIfNotPermanent**
- `user` **resolveProductIds**
- `user` **resolveVariantInventoryIds**
- `user` **getCart**
- `user` **getCartItemCount**
- `user` **validateDiscount**
- `user` **generateSeoMetadata**
- `user` **getEffectiveAvailableForVariants**
- `user` **convertPrice**
- `user` **getCurrencies**
- `user` **getCurrencyRates**
- `user` **getProductSpecifications**
- `user` **checkPermission**
- `user` **getUserRoles**
- `user` **requireMFA**
- `user` **getShippingMethods**
- `user` **getCatalogFacets**
- `user` **getProductBySlug**
- `user` **searchProducts**
- `user` **searchVariants**
- `user` **createClient**
- `unknown` **updateSession**
- `user` **createClient**
- `user` **getCurrentSupplierCost**
- `user` **getSuppliersForVariant**
- `user` **getWeightedAverageCost**
- `user` **resolveLowStockBuckets**
- `user` **getAvailableLocales**
- `user` **getTranslations**
- `user` **trackEvent**
- `user` **getWishlist**
- `user` **getWishlistWithProducts**

**Unprotected pages** (73/73):
- account/addresses
- account
- account/sessions
- admin/attributes
- admin/audit-log
- admin/categories/new
- admin/categories
- admin/categories/[id]/edit
- admin/currencies
- admin/customers/new
- _+63 more_

---

## Critical Nodes (High Fan-In)

- **createClient** `supabase_server` — 194 inbound edges
- **ok** `primitive` — 158 inbound edges
- **fail** `primitive` — 158 inbound edges
- **createAdminClient** `service` — 125 inbound edges
- **checkPermission** `barrel` — 105 inbound edges
- **logAuditEvent** `barrel` — 91 inbound edges
- **AdminLayout** `component` — 55 inbound edges
- **createClient** `supabase_client` — 19 inbound edges
- **formatCurrency** `service` — 14 inbound edges
- **checkRateLimit** `barrel` — 11 inbound edges

---

## Diagnostics

**Total:** 789 (169 errors · 205 warnings · 415 info)

### 🔴 Errors
- `PV-004` **API route writes DB without auth: POST /api/checkout/heartbeat**
  This API route performs database writes but has no authentication edge. Any user can trigger this write.
  Affected: POST /api/checkout/heartbeat, cart_checkout_sessions
  Fix: Add session validation at the top of the handler before performing any write.
- `SEC-005` **Action writes DB without auth: subscribeNewsletter**
  This server action performs DB writes but no authentication edge or permission guard was detected.
  Affected: subscribeNewsletter, newsletter_subscribers
  Fix: Call requirePermission() or validateSession() before any DB mutation.
- `SEC-001` **Admin route without auth guard: admin/attributes**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/attributes
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/audit-log**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/audit-log
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/categories/new**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/categories/new
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/categories**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/categories
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/categories/[id]/edit**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/categories/[id]/edit
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/currencies**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/currencies
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/customers/new**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/customers/new
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/customers**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/customers
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/customers/[id]**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/customers/[id]
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/discounts/new**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/discounts/new
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/discounts**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/discounts
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/discounts/[id]/edit**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/discounts/[id]/edit
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/errors**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/errors
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/inventory**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/inventory
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/inventory-debug**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/inventory-debug
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/media**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/media
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/mfa-enroll**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/mfa-enroll
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/mfa-verify**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/mfa-verify
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/newsletter**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/newsletter
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/orders/new**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/orders/new
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/orders**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/orders
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/orders/[id]**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/orders/[id]
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/permissions**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/permissions
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/products/bulk-edit**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/products/bulk-edit
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/products/new**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/products/new
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/products**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/products
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/products/[id]/edit**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/products/[id]/edit
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/products/[id]/variants/[variantId]**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/products/[id]/variants/[variantId]
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/reports/margins**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/reports/margins
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/returns**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/returns
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/roles/new**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/roles/new
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/roles**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/roles
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/roles/[id]/edit**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/roles/[id]/edit
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/seo/edit**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/seo/edit
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/seo/new**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/seo/new
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/seo**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/seo
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/settings/couriers**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/settings/couriers
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/settings/email**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/settings/email
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/settings/fees**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/settings/fees
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/shipping**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/shipping
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/shipping/rates/new**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/shipping/rates/new
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/shipping/rates/[id]/edit**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/shipping/rates/[id]/edit
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/shipping/zones/new**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/shipping/zones/new
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/shipping/zones/[id]/edit**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/shipping/zones/[id]/edit
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/suppliers/new**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/suppliers/new
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/suppliers**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/suppliers
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/suppliers/[id]**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/suppliers/[id]
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/supply-orders**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/supply-orders
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/supply-orders/[id]**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/supply-orders/[id]
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/tracking**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/tracking
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/translations**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/translations
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/users/new**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/users/new
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/users**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/users
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/users/[id]**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/users/[id]
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/vat-rates**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/vat-rates
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-001` **Admin route without auth guard: admin/wishlist-queue**
  Route at an /admin path has no detected auth protection edge and is not flagged as secure.
  Affected: admin/wishlist-queue
  Fix: Add a role-based middleware matcher or guard to protect all /admin routes.
- `SEC-011` **Cron route without secret validation: POST /api/cron/wishlist-advance**
  This /api/cron/ route has no detected CRON_SECRET or auth header check. Without validation, any external party can trigger this route on demand.
  Affected: POST /api/cron/wishlist-advance
  Fix: Add: if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) return new Response('Unauthorized', { status: 401 })
  Reference: https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
- `SEC-010` **Webhook without signature verification: POST**
  No signature validation edge detected on this webhook handler. Any party can send fake events.
  Affected: POST
  Fix: Add stripe.webhooks.constructEvent(), svix.verify(), or equivalent signature check as the first action in the handler.
- `SEC-010` **Webhook without signature verification: POST**
  No signature validation edge detected on this webhook handler. Any party can send fake events.
  Affected: POST
  Fix: Add stripe.webhooks.constructEvent(), svix.verify(), or equivalent signature check as the first action in the handler.
- `MI-004` **Stripe: missing STRIPE_WEBHOOK_SECRET env var**
  No STRIPE_WEBHOOK_SECRET found in any env node. Webhook signature verification will fail.
  Fix: Add STRIPE_WEBHOOK_SECRET from your Stripe dashboard to .env.local and production environment.
- `MI-014` **Resend: missing RESEND_API_KEY**
  Resend is installed but RESEND_API_KEY was not found in any env node.
  Fix: Add RESEND_API_KEY from your Resend dashboard to .env.local.
- `CV-003` **File in actions/ not classified as server action: saveAddress**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: saveAddress
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteAddress**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteAddress
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: createAttribute**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: createAttribute
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateAttribute**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateAttribute
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteAttribute**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteAttribute
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: createAttributeValue**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: createAttributeValue
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateAttributeValue**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateAttributeValue
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteAttributeValue**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteAttributeValue
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: getSession**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: getSession
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: getSession**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: getSession
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: signIn**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: signIn
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: signUp**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: signUp
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: signOut**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: signOut
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: addToCart**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: addToCart
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateCartItem**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateCartItem
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: removeFromCart**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: removeFromCart
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: createCategory**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: createCategory
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateCategory**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateCategory
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteCategory**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteCategory
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: placeOrder**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: placeOrder
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: createShipment**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: createShipment
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: upsertCarrierProvider**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: upsertCarrierProvider
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteCarrierProvider**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteCarrierProvider
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: testCarrierProvider**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: testCarrierProvider
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: setActiveCarrierProvider**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: setActiveCarrierProvider
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: listAcsStations**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: listAcsStations
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: upsertCurrency**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: upsertCurrency
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteCurrency**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteCurrency
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: matchOrCreateCustomer**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: matchOrCreateCustomer
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: CustomerMatchOutcome**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: CustomerMatchOutcome
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateCustomer**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateCustomer
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteCustomer**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteCustomer
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: applyDiscount**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: applyDiscount
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: createDiscountCode**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: createDiscountCode
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateDiscountCode**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateDiscountCode
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteDiscountCode**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteDiscountCode
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: upsertEmailProvider**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: upsertEmailProvider
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: sendTestEmail**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: sendTestEmail
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: setActiveProvider**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: setActiveProvider
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteEmailProvider**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteEmailProvider
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: setErrorResolved**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: setErrorResolved
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: saveFeeCategory**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: saveFeeCategory
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteFeeCategory**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteFeeCategory
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: saveFeeRule**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: saveFeeRule
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteFeeRule**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteFeeRule
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: setInventoryLevel**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: setInventoryLevel
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: forceReleaseSoftSession**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: forceReleaseSoftSession
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: forceReleasePriorityHold**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: forceReleasePriorityHold
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: uploadMedia**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: uploadMedia
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateMediaAsset**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateMediaAsset
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteMediaAsset**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteMediaAsset
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: subscribeNewsletter**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: subscribeNewsletter
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateSubscriber**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateSubscriber
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: transitionOrderStatus**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: transitionOrderStatus
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: refundOrder**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: refundOrder
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: createOrder**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: createOrder
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteOrder**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteOrder
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: searchAdminVariants**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: searchAdminVariants
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: AdminVariantResult**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: AdminVariantResult
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: searchCustomers**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: searchCustomers
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: CustomerResult**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: CustomerResult
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: createCheckoutSession**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: createCheckoutSession
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: addProductImage**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: addProductImage
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: setPrimaryImage**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: setPrimaryImage
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: setImageVariant**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: setImageVariant
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteProductImage**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteProductImage
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: reorderProductImages**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: reorderProductImages
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: createProduct**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: createProduct
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateProduct**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateProduct
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteProduct**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteProduct
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: setProductCategories**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: setProductCategories
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: assignRole**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: assignRole
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: revokeRole**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: revokeRole
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: createRole**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: createRole
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateRole**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateRole
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteRole**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteRole
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: setRolePermissions**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: setRolePermissions
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: createPermission**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: createPermission
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deletePermission**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deletePermission
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: requestReturn**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: requestReturn
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: upsertSeoMetadata**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: upsertSeoMetadata
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteSeoMetadata**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteSeoMetadata
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: revokeSession**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: revokeSession
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: createShippingZone**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: createShippingZone
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateShippingZone**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateShippingZone
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteShippingZone**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteShippingZone
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: createShippingRate**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: createShippingRate
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateShippingRate**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateShippingRate
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteShippingRate**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteShippingRate
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: upsertTranslation**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: upsertTranslation
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteTranslation**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteTranslation
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: createUser**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: createUser
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteUser**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteUser
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: addVariant**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: addVariant
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateVariant**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateVariant
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: deleteVariant**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: deleteVariant
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: toggleWishlist**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: toggleWishlist
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: subscribeToRestock**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: subscribeToRestock
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateWishlistFlags**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateWishlistFlags
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: removeWishlistItem**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: removeWishlistItem
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: notifyPending**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: notifyPending
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: skipPending**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: skipPending
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: bulkNotify**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: bulkNotify
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: releaseToGeneral**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: releaseToGeneral
  Fix: Add 'use server' as the very first statement of the file (before all imports).
- `CV-003` **File in actions/ not classified as server action: updateNotificationMode**
  This file lives in an actions/ directory but was not classified as a server action. The 'use server' directive may be missing or misplaced.
  Affected: updateNotificationMode
  Fix: Add 'use server' as the very first statement of the file (before all imports).

### 🟡 Warnings
- `DC-003` **Unused server action: leaveSoftWaitQueue**
  This server action has no inbound calls or trigger edges.
  Affected: leaveSoftWaitQueue
  Fix: Remove the action or wire it to a form or component.
- `DC-001` **Unused component: opengraph-image**
  This component has no inbound render or wraps edges — it is never used in any page or layout.
  Affected: opengraph-image
  Fix: Remove the component or add it to a page/layout. Check if it was meant to replace an existing component.
- `DC-001` **Unused component: WorkspaceTabs**
  This component has no inbound render or wraps edges — it is never used in any page or layout.
  Affected: WorkspaceTabs
  Fix: Remove the component or add it to a page/layout. Check if it was meant to replace an existing component.
- `DC-001` **Unused component: ChatWidget**
  This component has no inbound render or wraps edges — it is never used in any page or layout.
  Affected: ChatWidget
  Fix: Remove the component or add it to a page/layout. Check if it was meant to replace an existing component.
- `DC-001` **Unused component: ACTIVE_CURRENCY_COOKIE**
  This component has no inbound render or wraps edges — it is never used in any page or layout.
  Affected: ACTIVE_CURRENCY_COOKIE
  Fix: Remove the component or add it to a page/layout. Check if it was meant to replace an existing component.
- `BP-003` **God action writes 5 tables: createProduct**
  This server action writes to 5 different DB tables. It spans too many domain concerns.
  Affected: createProduct, products, product_variants, supplier_products, product_categories, seo_metadata
  Fix: Break into smaller, focused actions per domain entity.
- `BP-001` **High fan-in component (55 callers): AdminLayout**
  This component is rendered by 55 other nodes (threshold: 10). Changes here have widespread impact.
  Affected: AdminLayout
  Fix: Extract sub-components to reduce coupling. High fan-in means changes here break everything.
- `DR-002` **Multiple Supabase server (anon) clients (34 found)**
  34 Supabase clients of the same tier ('user') detected. Each tier should be instantiated once as a singleton. Having separate tiers (browser/server/admin) is expected.
  Affected: getSession, CategoryNav, OrderHistory, Header, resolveProductIds, resolveVariantInventoryIds +28 more
  Fix: Instantiate each Supabase client tier once in lib/supabase/ and re-import it everywhere.
- `DR-002` **Multiple Supabase browser clients (19 found)**
  19 Supabase clients of the same tier ('browser') detected. Each tier should be instantiated once as a singleton. Having separate tiers (browser/server/admin) is expected.
  Affected: MediaBrowser, EnrollMFAForm, VerifyMFAForm, ProductImagesEditor, ReceiptWorkspace, VariantImagesTab +13 more
  Fix: Instantiate each Supabase client tier once in lib/supabase/ and re-import it everywhere.
- `SEC-008` **Mutation API route without auth protection: POST /api/checkout/heartbeat**
  This API route performs writes but has no auth or CSRF protection detected. REST routes do not get automatic CSRF protection unlike server actions.
  Affected: POST /api/checkout/heartbeat
  Fix: Add session validation or CSRF token verification to stateful API routes.
- `SEC-016` `suspected` **Middleware missing HTTP security headers: middleware**
  Middleware is the ideal place to set Strict-Transport-Security, X-Frame-Options, X-Content-Type-Options and Content-Security-Policy. No such headers were detected. Vercel does not inject these automatically.
  Affected: middleware
  Fix: In middleware.ts, set response headers: X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin, and Strict-Transport-Security: max-age=31536000; includeSubDomains.
  Reference: https://nextjs.org/docs/app/building-your-application/configuring/response-size-limit
- `AR-002` **No root error boundary (app/error.tsx missing)**
  The App Router uses error.tsx to catch unhandled errors and show a recovery UI. Without a root-level error.tsx, any uncaught error will fall through to Next.js's generic 500 page with no user-friendly recovery or custom branding.
  Fix: Create src/app/error.tsx with a React error boundary component that renders a user-friendly error state and a "Try again" retry button.
  Reference: https://nextjs.org/docs/app/building-your-application/routing/error-handling
- `MI-002` **Supabase: missing generated TypeScript types**
  No database.types.ts file found. DB queries are untyped which reduces type safety.
  Fix: Run: supabase gen types typescript --linked > database.types.ts
  Reference: https://supabase.com/docs/guides/api/rest/generating-types
- `TC-001` **No test files found in project**
  No *.test.ts, *.spec.ts or similar test files were found. Zero tests is a significant production risk.
  Fix: Set up Vitest or Jest with Testing Library. Start with critical actions and API routes.
- `SEO-001` **Public page missing metadata: account/addresses**
  No metadata export found in this page or any ancestor layout in the App Router tree.
  Affected: account/addresses
  Fix: Export a metadata object or generateMetadata function. The page will inherit metadata from the nearest ancestor layout if defined there.
  Reference: https://nextjs.org/docs/app/building-your-application/optimizing/metadata
- `SEO-001` **Public page missing metadata: account**
  No metadata export found in this page or any ancestor layout in the App Router tree.
  Affected: account
  Fix: Export a metadata object or generateMetadata function. The page will inherit metadata from the nearest ancestor layout if defined there.
  Reference: https://nextjs.org/docs/app/building-your-application/optimizing/metadata
- `SEO-001` **Public page missing metadata: account/sessions**
  No metadata export found in this page or any ancestor layout in the App Router tree.
  Affected: account/sessions
  Fix: Export a metadata object or generateMetadata function. The page will inherit metadata from the nearest ancestor layout if defined there.
  Reference: https://nextjs.org/docs/app/building-your-application/optimizing/metadata
- `SEO-001` **Public page missing metadata: cart**
  No metadata export found in this page or any ancestor layout in the App Router tree.
  Affected: cart
  Fix: Export a metadata object or generateMetadata function. The page will inherit metadata from the nearest ancestor layout if defined there.
  Reference: https://nextjs.org/docs/app/building-your-application/optimizing/metadata
- `SEO-001` **Public page missing metadata: orders**
  No metadata export found in this page or any ancestor layout in the App Router tree.
  Affected: orders
  Fix: Export a metadata object or generateMetadata function. The page will inherit metadata from the nearest ancestor layout if defined there.
  Reference: https://nextjs.org/docs/app/building-your-application/optimizing/metadata
- `SEO-001` **Public page missing metadata: orders/[id]**
  No metadata export found in this page or any ancestor layout in the App Router tree.
  Affected: orders/[id]
  Fix: Export a metadata object or generateMetadata function. The page will inherit metadata from the nearest ancestor layout if defined there.
  Reference: https://nextjs.org/docs/app/building-your-application/optimizing/metadata
- `SEO-001` **Public page missing metadata: /**
  No metadata export found in this page or any ancestor layout in the App Router tree.
  Affected: /
  Fix: Export a metadata object or generateMetadata function. The page will inherit metadata from the nearest ancestor layout if defined there.
  Reference: https://nextjs.org/docs/app/building-your-application/optimizing/metadata
- `SEO-001` **Public page missing metadata: products**
  No metadata export found in this page or any ancestor layout in the App Router tree.
  Affected: products
  Fix: Export a metadata object or generateMetadata function. The page will inherit metadata from the nearest ancestor layout if defined there.
  Reference: https://nextjs.org/docs/app/building-your-application/optimizing/metadata
- `SEO-001` **Public page missing metadata: products/[slug]**
  No metadata export found in this page or any ancestor layout in the App Router tree.
  Affected: products/[slug]
  Fix: Export a metadata object or generateMetadata function. The page will inherit metadata from the nearest ancestor layout if defined there.
  Reference: https://nextjs.org/docs/app/building-your-application/optimizing/metadata
- `SEO-001` **Public page missing metadata: wishlist**
  No metadata export found in this page or any ancestor layout in the App Router tree.
  Affected: wishlist
  Fix: Export a metadata object or generateMetadata function. The page will inherit metadata from the nearest ancestor layout if defined there.
  Reference: https://nextjs.org/docs/app/building-your-application/optimizing/metadata
- `SEO-006` **Auth/transactional page missing noindex: auth/signin**
  Pages like login, checkout, and callback should be excluded from search engine indexing. Without noindex, they may appear in search results and consume crawl budget.
  Affected: auth/signin
  Fix: Add export const metadata = { robots: { index: false, follow: false } } to this page or its layout.
  Reference: https://nextjs.org/docs/app/api-reference/functions/generate-metadata#robots
- `SEO-006` **Auth/transactional page missing noindex: auth/signup**
  Pages like login, checkout, and callback should be excluded from search engine indexing. Without noindex, they may appear in search results and consume crawl budget.
  Affected: auth/signup
  Fix: Add export const metadata = { robots: { index: false, follow: false } } to this page or its layout.
  Reference: https://nextjs.org/docs/app/api-reference/functions/generate-metadata#robots
- `SEO-006` **Auth/transactional page missing noindex: checkout/mock/[session_id]**
  Pages like login, checkout, and callback should be excluded from search engine indexing. Without noindex, they may appear in search results and consume crawl budget.
  Affected: checkout/mock/[session_id]
  Fix: Add export const metadata = { robots: { index: false, follow: false } } to this page or its layout.
  Reference: https://nextjs.org/docs/app/api-reference/functions/generate-metadata#robots
- `SEO-006` **Auth/transactional page missing noindex: checkout**
  Pages like login, checkout, and callback should be excluded from search engine indexing. Without noindex, they may appear in search results and consume crawl budget.
  Affected: checkout
  Fix: Add export const metadata = { robots: { index: false, follow: false } } to this page or its layout.
  Reference: https://nextjs.org/docs/app/api-reference/functions/generate-metadata#robots
- `SEO-006` **Auth/transactional page missing noindex: checkout/payment/[id]**
  Pages like login, checkout, and callback should be excluded from search engine indexing. Without noindex, they may appear in search results and consume crawl budget.
  Affected: checkout/payment/[id]
  Fix: Add export const metadata = { robots: { index: false, follow: false } } to this page or its layout.
  Reference: https://nextjs.org/docs/app/api-reference/functions/generate-metadata#robots
- `SEO-006` **Auth/transactional page missing noindex: checkout/success/[id]**
  Pages like login, checkout, and callback should be excluded from search engine indexing. Without noindex, they may appear in search results and consume crawl budget.
  Affected: checkout/success/[id]
  Fix: Add export const metadata = { robots: { index: false, follow: false } } to this page or its layout.
  Reference: https://nextjs.org/docs/app/api-reference/functions/generate-metadata#robots
- `MI-022` **Dynamic route missing generateMetadata: orders/[id]**
  This dynamic route has no generateMetadata() export. Every instance of this page (e.g. every room, product) renders with identical title/description/OG image, which harms SEO and social sharing.
  Affected: orders/[id]
  Fix: Add export async function generateMetadata({ params }) to return entity-specific title, description, and openGraph metadata for each dynamic page.
  Reference: https://nextjs.org/docs/app/api-reference/functions/generate-metadata
- `MI-022` **Dynamic route missing generateMetadata: products/[slug]**
  This dynamic route has no generateMetadata() export. Every instance of this page (e.g. every room, product) renders with identical title/description/OG image, which harms SEO and social sharing.
  Affected: products/[slug]
  Fix: Add export async function generateMetadata({ params }) to return entity-specific title, description, and openGraph metadata for each dynamic page.
  Reference: https://nextjs.org/docs/app/api-reference/functions/generate-metadata
- `CV-014` **Fetch without error boundary: account/addresses**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: account/addresses
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: account**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: account
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: account/sessions**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: account/sessions
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/attributes**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/attributes
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/audit-log**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/audit-log
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/categories/new**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/categories/new
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/categories**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/categories
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/categories/[id]/edit**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/categories/[id]/edit
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/currencies**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/currencies
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/customers**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/customers
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/customers/[id]**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/customers/[id]
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/discounts**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/discounts
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/discounts/[id]/edit**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/discounts/[id]/edit
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/errors**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/errors
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/inventory**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/inventory
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/inventory-debug**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/inventory-debug
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/media**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/media
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/newsletter**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/newsletter
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/orders**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/orders
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/orders/[id]**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/orders/[id]
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/permissions**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/permissions
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/products/bulk-edit**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/products/bulk-edit
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/products/new**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/products/new
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/products**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/products
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/products/[id]/edit**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/products/[id]/edit
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/products/[id]/variants/[variantId]**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/products/[id]/variants/[variantId]
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/reports/margins**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/reports/margins
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/returns**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/returns
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/roles**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/roles
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/roles/[id]/edit**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/roles/[id]/edit
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/seo/edit**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/seo/edit
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/seo**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/seo
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/settings/couriers**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/settings/couriers
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/settings/email**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/settings/email
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/settings/fees**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/settings/fees
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/shipping**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/shipping
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/shipping/rates/new**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/shipping/rates/new
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/shipping/rates/[id]/edit**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/shipping/rates/[id]/edit
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/shipping/zones/[id]/edit**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/shipping/zones/[id]/edit
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/suppliers**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/suppliers
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/suppliers/[id]**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/suppliers/[id]
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/supply-orders**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/supply-orders
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/supply-orders/[id]**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/supply-orders/[id]
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/tracking**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/tracking
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/translations**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/translations
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/users/new**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/users/new
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/users**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/users
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/users/[id]**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/users/[id]
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/vat-rates**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/vat-rates
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: admin/wishlist-queue**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: admin/wishlist-queue
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: checkout/mock/[session_id]**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: checkout/mock/[session_id]
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: checkout/payment/[id]**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: checkout/payment/[id]
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: checkout/success/[id]**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: checkout/success/[id]
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-014` **Fetch without error boundary: orders/[id]**
  This server component fetches data but has no sibling error.tsx to catch failures.
  Affected: orders/[id]
  Fix: Add error.tsx to the same route segment or wrap the fetch in try/catch.
- `CV-018` **Action file with zero auth guards: deleteAddress.ts**
  None of the 1 export(s) in 'deleteAddress.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteAddress
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: saveAddress.ts**
  None of the 1 export(s) in 'saveAddress.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: saveAddress
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createAttribute.ts**
  None of the 1 export(s) in 'createAttribute.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createAttribute
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createAttributeValue.ts**
  None of the 1 export(s) in 'createAttributeValue.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createAttributeValue
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteAttribute.ts**
  None of the 1 export(s) in 'deleteAttribute.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteAttribute
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteAttributeValue.ts**
  None of the 1 export(s) in 'deleteAttributeValue.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteAttributeValue
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateAttribute.ts**
  None of the 1 export(s) in 'updateAttribute.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateAttribute
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateAttributeValue.ts**
  None of the 1 export(s) in 'updateAttributeValue.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateAttributeValue
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: signOut.ts**
  None of the 1 export(s) in 'signOut.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: signOut
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: addToCart.ts**
  None of the 1 export(s) in 'addToCart.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: addToCart
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: joinSoftWaitQueue.ts**
  None of the 1 export(s) in 'joinSoftWaitQueue.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: joinSoftWaitQueue
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: leaveSoftWaitQueue.ts**
  None of the 1 export(s) in 'leaveSoftWaitQueue.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: leaveSoftWaitQueue
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: mergeAnonCart.ts**
  None of the 1 export(s) in 'mergeAnonCart.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: mergeAnonCart
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: removeFromCart.ts**
  None of the 1 export(s) in 'removeFromCart.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: removeFromCart
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateCartItem.ts**
  None of the 1 export(s) in 'updateCartItem.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateCartItem
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createCategory.ts**
  None of the 1 export(s) in 'createCategory.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createCategory
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteCategory.ts**
  None of the 1 export(s) in 'deleteCategory.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteCategory
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateCategory.ts**
  None of the 1 export(s) in 'updateCategory.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateCategory
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: placeOrder.ts**
  None of the 1 export(s) in 'placeOrder.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: placeOrder
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: startCheckoutSession.ts**
  None of the 1 export(s) in 'startCheckoutSession.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: startCheckoutSession
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createShipment.ts**
  None of the 1 export(s) in 'createShipment.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createShipment
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteCarrierProvider.ts**
  None of the 1 export(s) in 'deleteCarrierProvider.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteCarrierProvider
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: listAcsStations.ts**
  None of the 1 export(s) in 'listAcsStations.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: listAcsStations
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: setActiveCarrierProvider.ts**
  None of the 1 export(s) in 'setActiveCarrierProvider.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: setActiveCarrierProvider
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: testCarrierProvider.ts**
  None of the 1 export(s) in 'testCarrierProvider.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: testCarrierProvider
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: upsertCarrierProvider.ts**
  None of the 1 export(s) in 'upsertCarrierProvider.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: upsertCarrierProvider
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteCurrency.ts**
  None of the 1 export(s) in 'deleteCurrency.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteCurrency
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: upsertCurrency.ts**
  None of the 1 export(s) in 'upsertCurrency.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: upsertCurrency
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteCustomer.ts**
  None of the 1 export(s) in 'deleteCustomer.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteCustomer
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: matchOrCreateCustomer.ts**
  None of the 1 export(s) in 'matchOrCreateCustomer.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: matchOrCreateCustomer
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateCustomer.ts**
  None of the 1 export(s) in 'updateCustomer.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateCustomer
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: applyDiscount.ts**
  None of the 1 export(s) in 'applyDiscount.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: applyDiscount
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createDiscountCode.ts**
  None of the 1 export(s) in 'createDiscountCode.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createDiscountCode
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteDiscountCode.ts**
  None of the 1 export(s) in 'deleteDiscountCode.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteDiscountCode
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateDiscountCode.ts**
  None of the 1 export(s) in 'updateDiscountCode.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateDiscountCode
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteEmailProvider.ts**
  None of the 1 export(s) in 'deleteEmailProvider.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteEmailProvider
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: sendTestEmail.ts**
  None of the 1 export(s) in 'sendTestEmail.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: sendTestEmail
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: setActiveProvider.ts**
  None of the 1 export(s) in 'setActiveProvider.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: setActiveProvider
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: upsertEmailProvider.ts**
  None of the 1 export(s) in 'upsertEmailProvider.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: upsertEmailProvider
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: setErrorResolved.ts**
  None of the 1 export(s) in 'setErrorResolved.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: setErrorResolved
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteFeeCategory.ts**
  None of the 1 export(s) in 'deleteFeeCategory.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteFeeCategory
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteFeeRule.ts**
  None of the 1 export(s) in 'deleteFeeRule.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteFeeRule
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: saveFeeCategory.ts**
  None of the 1 export(s) in 'saveFeeCategory.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: saveFeeCategory
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: saveFeeRule.ts**
  None of the 1 export(s) in 'saveFeeRule.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: saveFeeRule
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: bulkInventoryOps.ts**
  None of the 3 export(s) in 'bulkInventoryOps.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: bulkSetQuantity, bulkSetThreshold, bulkSetTrackSupply
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteMediaAsset.ts**
  None of the 1 export(s) in 'deleteMediaAsset.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteMediaAsset
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateMediaAsset.ts**
  None of the 1 export(s) in 'updateMediaAsset.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateMediaAsset
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: uploadMedia.ts**
  None of the 1 export(s) in 'uploadMedia.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: uploadMedia
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: subscribeNewsletter.ts**
  None of the 1 export(s) in 'subscribeNewsletter.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: subscribeNewsletter
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateSubscriber.ts**
  None of the 1 export(s) in 'updateSubscriber.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateSubscriber
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createOrder.ts**
  None of the 1 export(s) in 'createOrder.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createOrder
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteOrder.ts**
  None of the 1 export(s) in 'deleteOrder.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteOrder
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: refundOrder.ts**
  None of the 1 export(s) in 'refundOrder.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: refundOrder
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: transitionOrderStatus.ts**
  None of the 1 export(s) in 'transitionOrderStatus.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: transitionOrderStatus
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createCheckoutSession.ts**
  None of the 1 export(s) in 'createCheckoutSession.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createCheckoutSession
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: addProductImage.ts**
  None of the 1 export(s) in 'addProductImage.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: addProductImage
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteProductImage.ts**
  None of the 1 export(s) in 'deleteProductImage.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteProductImage
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: reorderProductImages.ts**
  None of the 1 export(s) in 'reorderProductImages.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: reorderProductImages
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: setImageVariant.ts**
  None of the 1 export(s) in 'setImageVariant.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: setImageVariant
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: setPrimaryImage.ts**
  None of the 1 export(s) in 'setPrimaryImage.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: setPrimaryImage
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: addProductSpec.ts**
  None of the 1 export(s) in 'addProductSpec.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: addProductSpec
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: removeProductSpec.ts**
  None of the 1 export(s) in 'removeProductSpec.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: removeProductSpec
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateProductSpec.ts**
  None of the 1 export(s) in 'updateProductSpec.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateProductSpec
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: bulkDeleteProducts.ts**
  None of the 1 export(s) in 'bulkDeleteProducts.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: bulkDeleteProducts
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: bulkSetActive.ts**
  None of the 1 export(s) in 'bulkSetActive.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: bulkSetActive
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: bulkUpdateProducts.ts**
  None of the 1 export(s) in 'bulkUpdateProducts.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: bulkUpdateProducts
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createProduct.ts**
  None of the 1 export(s) in 'createProduct.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createProduct
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteProduct.ts**
  None of the 1 export(s) in 'deleteProduct.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteProduct
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: setProductCategories.ts**
  None of the 1 export(s) in 'setProductCategories.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: setProductCategories
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateProduct.ts**
  None of the 1 export(s) in 'updateProduct.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateProduct
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: assignRole.ts**
  None of the 1 export(s) in 'assignRole.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: assignRole
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createPermission.ts**
  None of the 1 export(s) in 'createPermission.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createPermission
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createRole.ts**
  None of the 1 export(s) in 'createRole.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createRole
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deletePermission.ts**
  None of the 1 export(s) in 'deletePermission.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deletePermission
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteRole.ts**
  None of the 1 export(s) in 'deleteRole.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteRole
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: revokeRole.ts**
  None of the 1 export(s) in 'revokeRole.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: revokeRole
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: setRolePermissions.ts**
  None of the 1 export(s) in 'setRolePermissions.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: setRolePermissions
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateRole.ts**
  None of the 1 export(s) in 'updateRole.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateRole
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: requestReturn.ts**
  None of the 1 export(s) in 'requestReturn.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: requestReturn
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteSeoMetadata.ts**
  None of the 1 export(s) in 'deleteSeoMetadata.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteSeoMetadata
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: upsertSeoMetadata.ts**
  None of the 1 export(s) in 'upsertSeoMetadata.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: upsertSeoMetadata
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: revokeSession.ts**
  None of the 1 export(s) in 'revokeSession.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: revokeSession
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createShippingRate.ts**
  None of the 1 export(s) in 'createShippingRate.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createShippingRate
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createShippingZone.ts**
  None of the 1 export(s) in 'createShippingZone.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createShippingZone
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteShippingRate.ts**
  None of the 1 export(s) in 'deleteShippingRate.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteShippingRate
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteShippingZone.ts**
  None of the 1 export(s) in 'deleteShippingZone.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteShippingZone
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateShippingRate.ts**
  None of the 1 export(s) in 'updateShippingRate.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateShippingRate
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateShippingZone.ts**
  None of the 1 export(s) in 'updateShippingZone.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateShippingZone
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: applyDefaultSupplierToVariants.ts**
  None of the 1 export(s) in 'applyDefaultSupplierToVariants.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: applyDefaultSupplierToVariants
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createSupplier.ts**
  None of the 1 export(s) in 'createSupplier.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createSupplier
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteSupplier.ts**
  None of the 1 export(s) in 'deleteSupplier.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteSupplier
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: linkSupplierToVariant.ts**
  None of the 1 export(s) in 'linkSupplierToVariant.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: linkSupplierToVariant
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: saveReceiptColumnMap.ts**
  None of the 1 export(s) in 'saveReceiptColumnMap.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: saveReceiptColumnMap
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: unlinkSupplierFromVariant.ts**
  None of the 1 export(s) in 'unlinkSupplierFromVariant.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: unlinkSupplierFromVariant
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateSupplier.ts**
  None of the 1 export(s) in 'updateSupplier.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateSupplier
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateSupplierProduct.ts**
  None of the 1 export(s) in 'updateSupplierProduct.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateSupplierProduct
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: addInventoryVariantsToDrafts.ts**
  None of the 1 export(s) in 'addInventoryVariantsToDrafts.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: addInventoryVariantsToDrafts
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: addManyToDraft.ts**
  None of the 1 export(s) in 'addManyToDraft.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: addManyToDraft
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: addToDraft.ts**
  None of the 1 export(s) in 'addToDraft.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: addToDraft
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: cancelOrder.ts**
  None of the 1 export(s) in 'cancelOrder.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: cancelOrder
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: confirmReceipt.ts**
  None of the 1 export(s) in 'confirmReceipt.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: confirmReceipt
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: manualStatusChange.ts**
  None of the 1 export(s) in 'manualStatusChange.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: manualStatusChange
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: placeOrder.ts**
  None of the 1 export(s) in 'placeOrder.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: placeOrder
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: removeDraftLine.ts**
  None of the 1 export(s) in 'removeDraftLine.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: removeDraftLine
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: removeInventoryVariantsFromDrafts.ts**
  None of the 1 export(s) in 'removeInventoryVariantsFromDrafts.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: removeInventoryVariantsFromDrafts
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateDraftLine.ts**
  None of the 1 export(s) in 'updateDraftLine.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateDraftLine
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteTranslation.ts**
  None of the 1 export(s) in 'deleteTranslation.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteTranslation
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: upsertTranslation.ts**
  None of the 1 export(s) in 'upsertTranslation.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: upsertTranslation
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createUser.ts**
  None of the 1 export(s) in 'createUser.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createUser
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: addVariant.ts**
  None of the 1 export(s) in 'addVariant.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: addVariant
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteVariant.ts**
  None of the 1 export(s) in 'deleteVariant.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteVariant
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateVariant.ts**
  None of the 1 export(s) in 'updateVariant.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateVariant
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: createVatRate.ts**
  None of the 1 export(s) in 'createVatRate.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: createVatRate
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: deleteVatRate.ts**
  None of the 1 export(s) in 'deleteVatRate.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: deleteVatRate
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateVatRate.ts**
  None of the 1 export(s) in 'updateVatRate.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateVatRate
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: removeWishlistItem.ts**
  None of the 1 export(s) in 'removeWishlistItem.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: removeWishlistItem
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: subscribeToRestock.ts**
  None of the 1 export(s) in 'subscribeToRestock.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: subscribeToRestock
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: toggleWishlist.ts**
  None of the 1 export(s) in 'toggleWishlist.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: toggleWishlist
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.
- `CV-018` **Action file with zero auth guards: updateWishlistFlags.ts**
  None of the 1 export(s) in 'updateWishlistFlags.ts' contain an auth guard and they perform DB mutations. Any user can invoke these server actions via crafted requests.
  Affected: updateWishlistFlags
  Fix: Add an auth check at the top of each exported action, or add a shared guard at the top of the file.

### 🔵 Info
- `DC-009` **Unlinked config: tailwind.config.ts**
  This configuration node has no edges. Nothing in the graph references it.
  Affected: tailwind.config.ts
  Fix: Verify this config file is still needed, or remove it.
- `DC-009` **Unlinked config: next.config**
  This configuration node has no edges. Nothing in the graph references it.
  Affected: next.config
  Fix: Verify this config file is still needed, or remove it.
- `DC-009` **Unlinked config: .env.local**
  This configuration node has no edges. Nothing in the graph references it.
  Affected: .env.local
  Fix: Verify this config file is still needed, or remove it.
- `DC-009` **Unlinked config: supabase/config.toml**
  This configuration node has no edges. Nothing in the graph references it.
  Affected: supabase/config.toml
  Fix: Verify this config file is still needed, or remove it.
- `DC-009` **Unlinked config: config**
  This configuration node has no edges. Nothing in the graph references it.
  Affected: config
  Fix: Verify this config file is still needed, or remove it.
- `DC-011` **Unreferenced env group: NEXT_PUBLIC_SUPABASE_URL**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: NEXT_PUBLIC_SUPABASE_URL
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: NEXT_PUBLIC_SUPABASE_ANON_KEY**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: NEXT_PUBLIC_SUPABASE_ANON_KEY
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: SUPABASE_SERVICE_ROLE_KEY**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: SUPABASE_SERVICE_ROLE_KEY
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: STRIPE_SECRET_KEY**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: STRIPE_SECRET_KEY
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: STRIPE_WEBHOOK_SECRET**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: STRIPE_WEBHOOK_SECRET
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: CRM_API_KEY**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: CRM_API_KEY
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: CRM_API_URL**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: CRM_API_URL
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: COURIER_API_KEY**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: COURIER_API_KEY
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: COURIER_API_URL**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: COURIER_API_URL
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: MARKETPLACE_API_KEY**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: MARKETPLACE_API_KEY
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: MARKETPLACE_API_URL**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: MARKETPLACE_API_URL
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: NEWSLETTER_API_KEY**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: NEWSLETTER_API_KEY
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: NEWSLETTER_API_URL**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: NEWSLETTER_API_URL
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: NEXT_PUBLIC_SITE_URL**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: NEXT_PUBLIC_SITE_URL
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: NEXT_PUBLIC_DEFAULT_LOCALE**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: NEXT_PUBLIC_DEFAULT_LOCALE
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-011` **Unreferenced env group: NEXT_PUBLIC_DEFAULT_CURRENCY**
  This environment variable group is defined but nothing in the graph references it. May be legacy.
  Affected: NEXT_PUBLIC_DEFAULT_CURRENCY
  Fix: Verify these env vars are still in use or remove them from .env.example.
- `DC-012` **Dead barrel: saveAddress**
  This barrel re-exports items but nothing imports from it.
  Affected: saveAddress
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteAddress**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteAddress
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: createAttribute**
  This barrel re-exports items but nothing imports from it.
  Affected: createAttribute
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: updateAttribute**
  This barrel re-exports items but nothing imports from it.
  Affected: updateAttribute
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteAttribute**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteAttribute
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: createAttributeValue**
  This barrel re-exports items but nothing imports from it.
  Affected: createAttributeValue
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: updateAttributeValue**
  This barrel re-exports items but nothing imports from it.
  Affected: updateAttributeValue
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteAttributeValue**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteAttributeValue
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: getSession**
  This barrel re-exports items but nothing imports from it.
  Affected: getSession
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: signIn**
  This barrel re-exports items but nothing imports from it.
  Affected: signIn
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: signUp**
  This barrel re-exports items but nothing imports from it.
  Affected: signUp
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: signOut**
  This barrel re-exports items but nothing imports from it.
  Affected: signOut
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: addToCart**
  This barrel re-exports items but nothing imports from it.
  Affected: addToCart
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: updateCartItem**
  This barrel re-exports items but nothing imports from it.
  Affected: updateCartItem
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: removeFromCart**
  This barrel re-exports items but nothing imports from it.
  Affected: removeFromCart
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: createCategory**
  This barrel re-exports items but nothing imports from it.
  Affected: createCategory
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: updateCategory**
  This barrel re-exports items but nothing imports from it.
  Affected: updateCategory
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteCategory**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteCategory
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: placeOrder**
  This barrel re-exports items but nothing imports from it.
  Affected: placeOrder
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: createShipment**
  This barrel re-exports items but nothing imports from it.
  Affected: createShipment
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: listAcsStations**
  This barrel re-exports items but nothing imports from it.
  Affected: listAcsStations
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: upsertCurrency**
  This barrel re-exports items but nothing imports from it.
  Affected: upsertCurrency
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteCurrency**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteCurrency
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: matchOrCreateCustomer**
  This barrel re-exports items but nothing imports from it.
  Affected: matchOrCreateCustomer
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: updateCustomer**
  This barrel re-exports items but nothing imports from it.
  Affected: updateCustomer
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteCustomer**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteCustomer
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: applyDiscount**
  This barrel re-exports items but nothing imports from it.
  Affected: applyDiscount
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: createDiscountCode**
  This barrel re-exports items but nothing imports from it.
  Affected: createDiscountCode
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: updateDiscountCode**
  This barrel re-exports items but nothing imports from it.
  Affected: updateDiscountCode
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteDiscountCode**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteDiscountCode
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: upsertEmailProvider**
  This barrel re-exports items but nothing imports from it.
  Affected: upsertEmailProvider
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: sendTestEmail**
  This barrel re-exports items but nothing imports from it.
  Affected: sendTestEmail
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: setActiveProvider**
  This barrel re-exports items but nothing imports from it.
  Affected: setActiveProvider
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteEmailProvider**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteEmailProvider
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: setErrorResolved**
  This barrel re-exports items but nothing imports from it.
  Affected: setErrorResolved
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: setInventoryLevel**
  This barrel re-exports items but nothing imports from it.
  Affected: setInventoryLevel
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: uploadMedia**
  This barrel re-exports items but nothing imports from it.
  Affected: uploadMedia
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: updateMediaAsset**
  This barrel re-exports items but nothing imports from it.
  Affected: updateMediaAsset
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteMediaAsset**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteMediaAsset
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: subscribeNewsletter**
  This barrel re-exports items but nothing imports from it.
  Affected: subscribeNewsletter
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: updateSubscriber**
  This barrel re-exports items but nothing imports from it.
  Affected: updateSubscriber
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: transitionOrderStatus**
  This barrel re-exports items but nothing imports from it.
  Affected: transitionOrderStatus
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: refundOrder**
  This barrel re-exports items but nothing imports from it.
  Affected: refundOrder
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: createOrder**
  This barrel re-exports items but nothing imports from it.
  Affected: createOrder
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteOrder**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteOrder
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: searchAdminVariants**
  This barrel re-exports items but nothing imports from it.
  Affected: searchAdminVariants
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: searchCustomers**
  This barrel re-exports items but nothing imports from it.
  Affected: searchCustomers
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: createCheckoutSession**
  This barrel re-exports items but nothing imports from it.
  Affected: createCheckoutSession
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: addProductImage**
  This barrel re-exports items but nothing imports from it.
  Affected: addProductImage
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: setPrimaryImage**
  This barrel re-exports items but nothing imports from it.
  Affected: setPrimaryImage
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: setImageVariant**
  This barrel re-exports items but nothing imports from it.
  Affected: setImageVariant
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteProductImage**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteProductImage
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: reorderProductImages**
  This barrel re-exports items but nothing imports from it.
  Affected: reorderProductImages
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: createProduct**
  This barrel re-exports items but nothing imports from it.
  Affected: createProduct
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: updateProduct**
  This barrel re-exports items but nothing imports from it.
  Affected: updateProduct
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteProduct**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteProduct
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: setProductCategories**
  This barrel re-exports items but nothing imports from it.
  Affected: setProductCategories
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: assignRole**
  This barrel re-exports items but nothing imports from it.
  Affected: assignRole
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: revokeRole**
  This barrel re-exports items but nothing imports from it.
  Affected: revokeRole
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: createRole**
  This barrel re-exports items but nothing imports from it.
  Affected: createRole
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: updateRole**
  This barrel re-exports items but nothing imports from it.
  Affected: updateRole
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteRole**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteRole
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: setRolePermissions**
  This barrel re-exports items but nothing imports from it.
  Affected: setRolePermissions
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: createPermission**
  This barrel re-exports items but nothing imports from it.
  Affected: createPermission
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deletePermission**
  This barrel re-exports items but nothing imports from it.
  Affected: deletePermission
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: requestReturn**
  This barrel re-exports items but nothing imports from it.
  Affected: requestReturn
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: upsertSeoMetadata**
  This barrel re-exports items but nothing imports from it.
  Affected: upsertSeoMetadata
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteSeoMetadata**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteSeoMetadata
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: revokeSession**
  This barrel re-exports items but nothing imports from it.
  Affected: revokeSession
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: createShippingZone**
  This barrel re-exports items but nothing imports from it.
  Affected: createShippingZone
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: updateShippingZone**
  This barrel re-exports items but nothing imports from it.
  Affected: updateShippingZone
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteShippingZone**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteShippingZone
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: createShippingRate**
  This barrel re-exports items but nothing imports from it.
  Affected: createShippingRate
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: updateShippingRate**
  This barrel re-exports items but nothing imports from it.
  Affected: updateShippingRate
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteShippingRate**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteShippingRate
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: upsertTranslation**
  This barrel re-exports items but nothing imports from it.
  Affected: upsertTranslation
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteTranslation**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteTranslation
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: createUser**
  This barrel re-exports items but nothing imports from it.
  Affected: createUser
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteUser**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteUser
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: addVariant**
  This barrel re-exports items but nothing imports from it.
  Affected: addVariant
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: updateVariant**
  This barrel re-exports items but nothing imports from it.
  Affected: updateVariant
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: deleteVariant**
  This barrel re-exports items but nothing imports from it.
  Affected: deleteVariant
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: toggleWishlist**
  This barrel re-exports items but nothing imports from it.
  Affected: toggleWishlist
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: subscribeToRestock**
  This barrel re-exports items but nothing imports from it.
  Affected: subscribeToRestock
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: updateWishlistFlags**
  This barrel re-exports items but nothing imports from it.
  Affected: updateWishlistFlags
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: removeWishlistItem**
  This barrel re-exports items but nothing imports from it.
  Affected: removeWishlistItem
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: useCart**
  This barrel re-exports items but nothing imports from it.
  Affected: useCart
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: useSearch**
  This barrel re-exports items but nothing imports from it.
  Affected: useSearch
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: usePermission**
  This barrel re-exports items but nothing imports from it.
  Affected: usePermission
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: useCommandPalette**
  This barrel re-exports items but nothing imports from it.
  Affected: useCommandPalette
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: syncContactToCRM**
  This barrel re-exports items but nothing imports from it.
  Affected: syncContactToCRM
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: captureError**
  This barrel re-exports items but nothing imports from it.
  Affected: captureError
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: decrementInventory**
  This barrel re-exports items but nothing imports from it.
  Affected: decrementInventory
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: syncListings**
  This barrel re-exports items but nothing imports from it.
  Affected: syncListings
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: convertPrice**
  This barrel re-exports items but nothing imports from it.
  Affected: convertPrice
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: getCurrencies**
  This barrel re-exports items but nothing imports from it.
  Affected: getCurrencies
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: getDefaultCurrency**
  This barrel re-exports items but nothing imports from it.
  Affected: getDefaultCurrency
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: getUserRoles**
  This barrel re-exports items but nothing imports from it.
  Affected: getUserRoles
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: cleanupExpiredSessions**
  This barrel re-exports items but nothing imports from it.
  Affected: cleanupExpiredSessions
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: calculateShipping**
  This barrel re-exports items but nothing imports from it.
  Affected: calculateShipping
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: getShippingMethods**
  This barrel re-exports items but nothing imports from it.
  Affected: getShippingMethods
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: searchProducts**
  This barrel re-exports items but nothing imports from it.
  Affected: searchProducts
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: SendEmailInput**
  This barrel re-exports items but nothing imports from it.
  Affected: SendEmailInput
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: SendEmailResult**
  This barrel re-exports items but nothing imports from it.
  Affected: SendEmailResult
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: sendEmail**
  This barrel re-exports items but nothing imports from it.
  Affected: sendEmail
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: getTranslation**
  This barrel re-exports items but nothing imports from it.
  Affected: getTranslation
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: getTranslations**
  This barrel re-exports items but nothing imports from it.
  Affected: getTranslations
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: getAvailableLocales**
  This barrel re-exports items but nothing imports from it.
  Affected: getAvailableLocales
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-012` **Dead barrel: getWishlist**
  This barrel re-exports items but nothing imports from it.
  Affected: getWishlist
  Fix: Clean up unused barrel exports to reduce bundle surface area.
- `DC-004` `suspected` **No internal callers for API route: POST /api/checkout/release**
  No graph node fetches from this route internally. It may be invoked externally (webhooks, cron jobs, OAuth callbacks, third-party services) — static analysis cannot trace these callers.
  Affected: POST /api/checkout/release
  Fix: If this route is called externally, no action needed. If purely internal, verify it is still used or remove it.
- `DC-004` `suspected` **No internal callers for API route: GET /api/cron/wishlist-advance**
  No graph node fetches from this route internally. It may be invoked externally (webhooks, cron jobs, OAuth callbacks, third-party services) — static analysis cannot trace these callers.
  Affected: GET /api/cron/wishlist-advance
  Fix: If this route is called externally, no action needed. If purely internal, verify it is still used or remove it.
- `DC-004` `suspected` **No internal callers for API route: POST /api/cron/wishlist-advance**
  No graph node fetches from this route internally. It may be invoked externally (webhooks, cron jobs, OAuth callbacks, third-party services) — static analysis cannot trace these callers.
  Affected: POST /api/cron/wishlist-advance
  Fix: If this route is called externally, no action needed. If purely internal, verify it is still used or remove it.
- `DC-004` `suspected` **No internal callers for API route: POST /api/track**
  No graph node fetches from this route internally. It may be invoked externally (webhooks, cron jobs, OAuth callbacks, third-party services) — static analysis cannot trace these callers.
  Affected: POST /api/track
  Fix: If this route is called externally, no action needed. If purely internal, verify it is still used or remove it.
- `DC-004` `suspected` **No internal callers for API route: GET /auth/callback**
  No graph node fetches from this route internally. It may be invoked externally (webhooks, cron jobs, OAuth callbacks, third-party services) — static analysis cannot trace these callers.
  Affected: GET /auth/callback
  Fix: If this route is called externally, no action needed. If purely internal, verify it is still used or remove it.
- `BP-010` **Page renders 10 components directly: admin/inventory**
  Pages should compose via layouts, not render all components inline.
  Affected: admin/inventory
  Fix: Introduce layout abstraction or section components to reduce page-level coupling.
- `BP-010` **Page renders 10 components directly: admin/products**
  Pages should compose via layouts, not render all components inline.
  Affected: admin/products
  Fix: Introduce layout abstraction or section components to reduce page-level coupling.
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: vat_rates**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: vat_rates
  Fix: Check Supabase Dashboard → Table Editor → vat_rates → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: suppliers**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: suppliers
  Fix: Check Supabase Dashboard → Table Editor → suppliers → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: supplier_products**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: supplier_products
  Fix: Check Supabase Dashboard → Table Editor → supplier_products → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: supply_orders**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: supply_orders
  Fix: Check Supabase Dashboard → Table Editor → supply_orders → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: supply_order_lines**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: supply_order_lines
  Fix: Check Supabase Dashboard → Table Editor → supply_order_lines → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: purchase_lots**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: purchase_lots
  Fix: Check Supabase Dashboard → Table Editor → purchase_lots → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: product_specifications**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: product_specifications
  Fix: Check Supabase Dashboard → Table Editor → product_specifications → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: customers**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: customers
  Fix: Check Supabase Dashboard → Table Editor → customers → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: addresses**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: addresses
  Fix: Check Supabase Dashboard → Table Editor → addresses → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: attributes**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: attributes
  Fix: Check Supabase Dashboard → Table Editor → attributes → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: attribute_values**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: attribute_values
  Fix: Check Supabase Dashboard → Table Editor → attribute_values → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: product_variants**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: product_variants
  Fix: Check Supabase Dashboard → Table Editor → product_variants → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: soft_waits**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: soft_waits
  Fix: Check Supabase Dashboard → Table Editor → soft_waits → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: cart_checkout_sessions**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: cart_checkout_sessions
  Fix: Check Supabase Dashboard → Table Editor → cart_checkout_sessions → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: products**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: products
  Fix: Check Supabase Dashboard → Table Editor → products → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: carts**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: carts
  Fix: Check Supabase Dashboard → Table Editor → carts → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: cart_items**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: cart_items
  Fix: Check Supabase Dashboard → Table Editor → cart_items → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: priority_holds**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: priority_holds
  Fix: Check Supabase Dashboard → Table Editor → priority_holds → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: users**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: users
  Fix: Check Supabase Dashboard → Table Editor → users → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: categories**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: categories
  Fix: Check Supabase Dashboard → Table Editor → categories → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: product_categories**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: product_categories
  Fix: Check Supabase Dashboard → Table Editor → product_categories → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: orders**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: orders
  Fix: Check Supabase Dashboard → Table Editor → orders → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: order_items**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: order_items
  Fix: Check Supabase Dashboard → Table Editor → order_items → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: shipments**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: shipments
  Fix: Check Supabase Dashboard → Table Editor → shipments → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: user_profiles**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: user_profiles
  Fix: Check Supabase Dashboard → Table Editor → user_profiles → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: carrier_provider_configs**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: carrier_provider_configs
  Fix: Check Supabase Dashboard → Table Editor → carrier_provider_configs → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: acs_station_cache**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: acs_station_cache
  Fix: Check Supabase Dashboard → Table Editor → acs_station_cache → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: currencies**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: currencies
  Fix: Check Supabase Dashboard → Table Editor → currencies → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: discount_codes**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: discount_codes
  Fix: Check Supabase Dashboard → Table Editor → discount_codes → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: discount_usage**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: discount_usage
  Fix: Check Supabase Dashboard → Table Editor → discount_usage → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: email_provider_configs**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: email_provider_configs
  Fix: Check Supabase Dashboard → Table Editor → email_provider_configs → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: error_events**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: error_events
  Fix: Check Supabase Dashboard → Table Editor → error_events → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: fee_categories**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: fee_categories
  Fix: Check Supabase Dashboard → Table Editor → fee_categories → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: fee_rules**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: fee_rules
  Fix: Check Supabase Dashboard → Table Editor → fee_rules → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: inventory_items**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: inventory_items
  Fix: Check Supabase Dashboard → Table Editor → inventory_items → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: media_assets**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: media_assets
  Fix: Check Supabase Dashboard → Table Editor → media_assets → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: newsletter_subscribers**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: newsletter_subscribers
  Fix: Check Supabase Dashboard → Table Editor → newsletter_subscribers → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: payment_intents**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: payment_intents
  Fix: Check Supabase Dashboard → Table Editor → payment_intents → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: product_images**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: product_images
  Fix: Check Supabase Dashboard → Table Editor → product_images → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: product_specifications**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: product_specifications
  Fix: Check Supabase Dashboard → Table Editor → product_specifications → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: supplier_products**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: supplier_products
  Fix: Check Supabase Dashboard → Table Editor → supplier_products → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: seo_metadata**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: seo_metadata
  Fix: Check Supabase Dashboard → Table Editor → seo_metadata → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: user_roles**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: user_roles
  Fix: Check Supabase Dashboard → Table Editor → user_roles → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: permissions**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: permissions
  Fix: Check Supabase Dashboard → Table Editor → permissions → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: roles**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: roles
  Fix: Check Supabase Dashboard → Table Editor → roles → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: role_permissions**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: role_permissions
  Fix: Check Supabase Dashboard → Table Editor → role_permissions → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: return_requests**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: return_requests
  Fix: Check Supabase Dashboard → Table Editor → return_requests → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: return_items**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: return_items
  Fix: Check Supabase Dashboard → Table Editor → return_items → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: user_sessions**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: user_sessions
  Fix: Check Supabase Dashboard → Table Editor → user_sessions → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: shipping_rates**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: shipping_rates
  Fix: Check Supabase Dashboard → Table Editor → shipping_rates → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: shipping_zones**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: shipping_zones
  Fix: Check Supabase Dashboard → Table Editor → shipping_zones → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: suppliers**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: suppliers
  Fix: Check Supabase Dashboard → Table Editor → suppliers → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: supply_orders**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: supply_orders
  Fix: Check Supabase Dashboard → Table Editor → supply_orders → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: purchase_lots**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: purchase_lots
  Fix: Check Supabase Dashboard → Table Editor → purchase_lots → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: supply_order_lines**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: supply_order_lines
  Fix: Check Supabase Dashboard → Table Editor → supply_order_lines → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: translations**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: translations
  Fix: Check Supabase Dashboard → Table Editor → translations → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: vat_rates**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: vat_rates
  Fix: Check Supabase Dashboard → Table Editor → vat_rates → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: wishlist_items**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: wishlist_items
  Fix: Check Supabase Dashboard → Table Editor → wishlist_items → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: wishlists**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: wishlists
  Fix: Check Supabase Dashboard → Table Editor → wishlists → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: pending_wishlist_notifications**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: pending_wishlist_notifications
  Fix: Check Supabase Dashboard → Table Editor → pending_wishlist_notifications → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: notification_settings**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: notification_settings
  Fix: Check Supabase Dashboard → Table Editor → notification_settings → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: audit_events**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: audit_events
  Fix: Check Supabase Dashboard → Table Editor → audit_events → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: tracking_events**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: tracking_events
  Fix: Check Supabase Dashboard → Table Editor → tracking_events → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: acs_postcode_cache**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: acs_postcode_cache
  Fix: Check Supabase Dashboard → Table Editor → acs_postcode_cache → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: crm_contacts**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: crm_contacts
  Fix: Check Supabase Dashboard → Table Editor → crm_contacts → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `SEC-004` `unverifiable` **Verify RLS policy exists for table: marketplace_listings**
  No RLS policy edge was detected for this Supabase table in the static graph. Arch cannot verify RLS configuration from code — this requires checking Supabase Dashboard → Authentication → Policies.
  Affected: marketplace_listings
  Fix: Check Supabase Dashboard → Table Editor → marketplace_listings → RLS → Policies. If RLS is off, enable it and add at least one policy.
  Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
- `AR-001` `suspected` **Action with excessive orchestration: saveAddress**
  saveAddress calls ~18 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: saveAddress
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: createAttributeValue**
  createAttributeValue calls ~13 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: createAttributeValue
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: deleteAttribute**
  deleteAttribute calls ~16 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: deleteAttribute
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: deleteAttributeValue**
  deleteAttributeValue calls ~13 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: deleteAttributeValue
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: signOut**
  signOut calls ~15 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: signOut
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: joinSoftWaitQueue**
  joinSoftWaitQueue calls ~22 distinct functions and writes 3 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: joinSoftWaitQueue
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: leaveSoftWaitQueue**
  leaveSoftWaitQueue calls ~19 distinct functions and writes 3 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: leaveSoftWaitQueue
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: mergeAnonCart**
  mergeAnonCart calls ~22 distinct functions and writes 3 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: mergeAnonCart
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: removeFromCart**
  removeFromCart calls ~14 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: removeFromCart
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: createCategory**
  createCategory calls ~14 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: createCategory
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: updateCategory**
  updateCategory calls ~13 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: updateCategory
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: placeOrder**
  placeOrder calls ~31 distinct functions and writes 4 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: placeOrder
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: startCheckoutSession**
  startCheckoutSession calls ~25 distinct functions and writes 2 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: startCheckoutSession
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: createShipment**
  createShipment calls ~18 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: createShipment
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: listAcsStations**
  listAcsStations calls ~21 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: listAcsStations
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: setActiveCarrierProvider**
  setActiveCarrierProvider calls ~15 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: setActiveCarrierProvider
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: testCarrierProvider**
  testCarrierProvider calls ~18 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: testCarrierProvider
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: upsertCarrierProvider**
  upsertCarrierProvider calls ~20 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: upsertCarrierProvider
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: matchOrCreateCustomer**
  matchOrCreateCustomer calls ~20 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: matchOrCreateCustomer
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: updateCustomer**
  updateCustomer calls ~16 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: updateCustomer
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: applyDiscount**
  applyDiscount calls ~16 distinct functions and writes 2 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: applyDiscount
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: sendTestEmail**
  sendTestEmail calls ~20 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: sendTestEmail
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: setActiveProvider**
  setActiveProvider calls ~15 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: setActiveProvider
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: upsertEmailProvider**
  upsertEmailProvider calls ~17 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: upsertEmailProvider
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: deleteFeeCategory**
  deleteFeeCategory calls ~13 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: deleteFeeCategory
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: deleteFeeRule**
  deleteFeeRule calls ~13 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: deleteFeeRule
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: saveFeeCategory**
  saveFeeCategory calls ~17 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: saveFeeCategory
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: saveFeeRule**
  saveFeeRule calls ~15 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: saveFeeRule
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: forceReleasePriorityHold**
  forceReleasePriorityHold calls ~16 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: forceReleasePriorityHold
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: deleteMediaAsset**
  deleteMediaAsset calls ~14 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: deleteMediaAsset
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: subscribeNewsletter**
  subscribeNewsletter calls ~19 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: subscribeNewsletter
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: createOrder**
  createOrder calls ~26 distinct functions and writes 2 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: createOrder
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: deleteOrder**
  deleteOrder calls ~18 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: deleteOrder
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: refundOrder**
  refundOrder calls ~27 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: refundOrder
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: transitionOrderStatus**
  transitionOrderStatus calls ~24 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: transitionOrderStatus
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: createCheckoutSession**
  createCheckoutSession calls ~27 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: createCheckoutSession
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: addProductImage**
  addProductImage calls ~14 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: addProductImage
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: addProductSpec**
  addProductSpec calls ~13 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: addProductSpec
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: bulkSetActive**
  bulkSetActive calls ~13 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: bulkSetActive
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: bulkUpdateProducts**
  bulkUpdateProducts calls ~27 distinct functions and writes 4 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: bulkUpdateProducts
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: createProduct**
  createProduct calls ~20 distinct functions and writes 5 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: createProduct
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: updateProduct**
  updateProduct calls ~15 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: updateProduct
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: deleteRole**
  deleteRole calls ~15 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: deleteRole
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: revokeRole**
  revokeRole calls ~13 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: revokeRole
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: setRolePermissions**
  setRolePermissions calls ~13 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: setRolePermissions
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: requestReturn**
  requestReturn calls ~15 distinct functions and writes 2 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: requestReturn
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: applyDefaultSupplierToVariants**
  applyDefaultSupplierToVariants calls ~15 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: applyDefaultSupplierToVariants
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: createSupplier**
  createSupplier calls ~13 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: createSupplier
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: updateSupplier**
  updateSupplier calls ~17 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: updateSupplier
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: updateSupplierProduct**
  updateSupplierProduct calls ~17 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: updateSupplierProduct
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: addInventoryVariantsToDrafts**
  addInventoryVariantsToDrafts calls ~22 distinct functions and writes 2 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: addInventoryVariantsToDrafts
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: addManyToDraft**
  addManyToDraft calls ~25 distinct functions and writes 2 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: addManyToDraft
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: addToDraft**
  addToDraft calls ~23 distinct functions and writes 2 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: addToDraft
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: cancelOrder**
  cancelOrder calls ~13 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: cancelOrder
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: confirmReceipt**
  confirmReceipt calls ~20 distinct functions and writes 4 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: confirmReceipt
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: manualStatusChange**
  manualStatusChange calls ~13 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: manualStatusChange
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: placeOrder**
  placeOrder calls ~13 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: placeOrder
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: removeInventoryVariantsFromDrafts**
  removeInventoryVariantsFromDrafts calls ~21 distinct functions and writes 2 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: removeInventoryVariantsFromDrafts
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: createUser**
  createUser calls ~17 distinct functions and writes 2 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: createUser
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: createVatRate**
  createVatRate calls ~14 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: createVatRate
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: updateVatRate**
  updateVatRate calls ~15 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: updateVatRate
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: subscribeToRestock**
  subscribeToRestock calls ~15 distinct functions and writes 2 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: subscribeToRestock
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: bulkNotify**
  bulkNotify calls ~20 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: bulkNotify
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: notifyPending**
  notifyPending calls ~16 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: notifyPending
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: releaseToGeneral**
  releaseToGeneral calls ~14 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: releaseToGeneral
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: skipPending**
  skipPending calls ~15 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: skipPending
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `AR-001` `suspected` **Action with excessive orchestration: updateNotificationMode**
  updateNotificationMode calls ~20 distinct functions and writes 1 DB table(s). Actions should orchestrate at a high level — detailed business logic belongs in a service layer.
  Affected: updateNotificationMode
  Fix: Extract the core logic into a dedicated service function. The action should validate, call the service, and return a result — nothing more.
- `MI-012` **Missing error.tsx near: account/addresses**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: account/addresses
  Fix: Add error.tsx in the same folder as account/addresses to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: account**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: account
  Fix: Add error.tsx in the same folder as account to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: account/sessions**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: account/sessions
  Fix: Add error.tsx in the same folder as account/sessions to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/attributes**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/attributes
  Fix: Add error.tsx in the same folder as admin/attributes to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/audit-log**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/audit-log
  Fix: Add error.tsx in the same folder as admin/audit-log to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/categories/new**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/categories/new
  Fix: Add error.tsx in the same folder as admin/categories/new to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/categories**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/categories
  Fix: Add error.tsx in the same folder as admin/categories to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/categories/[id]/edit**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/categories/[id]/edit
  Fix: Add error.tsx in the same folder as admin/categories/[id]/edit to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/currencies**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/currencies
  Fix: Add error.tsx in the same folder as admin/currencies to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/customers/new**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/customers/new
  Fix: Add error.tsx in the same folder as admin/customers/new to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/customers**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/customers
  Fix: Add error.tsx in the same folder as admin/customers to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/customers/[id]**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/customers/[id]
  Fix: Add error.tsx in the same folder as admin/customers/[id] to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/discounts/new**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/discounts/new
  Fix: Add error.tsx in the same folder as admin/discounts/new to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/discounts**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/discounts
  Fix: Add error.tsx in the same folder as admin/discounts to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/discounts/[id]/edit**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/discounts/[id]/edit
  Fix: Add error.tsx in the same folder as admin/discounts/[id]/edit to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/errors**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/errors
  Fix: Add error.tsx in the same folder as admin/errors to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/inventory**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/inventory
  Fix: Add error.tsx in the same folder as admin/inventory to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/inventory-debug**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/inventory-debug
  Fix: Add error.tsx in the same folder as admin/inventory-debug to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/media**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/media
  Fix: Add error.tsx in the same folder as admin/media to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/mfa-enroll**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/mfa-enroll
  Fix: Add error.tsx in the same folder as admin/mfa-enroll to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/mfa-verify**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/mfa-verify
  Fix: Add error.tsx in the same folder as admin/mfa-verify to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/newsletter**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/newsletter
  Fix: Add error.tsx in the same folder as admin/newsletter to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/orders/new**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/orders/new
  Fix: Add error.tsx in the same folder as admin/orders/new to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/orders**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/orders
  Fix: Add error.tsx in the same folder as admin/orders to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/orders/[id]**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/orders/[id]
  Fix: Add error.tsx in the same folder as admin/orders/[id] to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin
  Fix: Add error.tsx in the same folder as admin to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/permissions**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/permissions
  Fix: Add error.tsx in the same folder as admin/permissions to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/products/bulk-edit**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/products/bulk-edit
  Fix: Add error.tsx in the same folder as admin/products/bulk-edit to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/products/new**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/products/new
  Fix: Add error.tsx in the same folder as admin/products/new to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/products**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/products
  Fix: Add error.tsx in the same folder as admin/products to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/products/[id]/edit**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/products/[id]/edit
  Fix: Add error.tsx in the same folder as admin/products/[id]/edit to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/products/[id]/variants/[variantId]**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/products/[id]/variants/[variantId]
  Fix: Add error.tsx in the same folder as admin/products/[id]/variants/[variantId] to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/reports/margins**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/reports/margins
  Fix: Add error.tsx in the same folder as admin/reports/margins to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/returns**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/returns
  Fix: Add error.tsx in the same folder as admin/returns to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/roles/new**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/roles/new
  Fix: Add error.tsx in the same folder as admin/roles/new to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/roles**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/roles
  Fix: Add error.tsx in the same folder as admin/roles to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/roles/[id]/edit**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/roles/[id]/edit
  Fix: Add error.tsx in the same folder as admin/roles/[id]/edit to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/seo/edit**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/seo/edit
  Fix: Add error.tsx in the same folder as admin/seo/edit to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/seo/new**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/seo/new
  Fix: Add error.tsx in the same folder as admin/seo/new to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/seo**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/seo
  Fix: Add error.tsx in the same folder as admin/seo to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/settings/couriers**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/settings/couriers
  Fix: Add error.tsx in the same folder as admin/settings/couriers to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/settings/email**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/settings/email
  Fix: Add error.tsx in the same folder as admin/settings/email to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/settings/fees**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/settings/fees
  Fix: Add error.tsx in the same folder as admin/settings/fees to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/shipping**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/shipping
  Fix: Add error.tsx in the same folder as admin/shipping to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/shipping/rates/new**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/shipping/rates/new
  Fix: Add error.tsx in the same folder as admin/shipping/rates/new to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/shipping/rates/[id]/edit**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/shipping/rates/[id]/edit
  Fix: Add error.tsx in the same folder as admin/shipping/rates/[id]/edit to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/shipping/zones/new**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/shipping/zones/new
  Fix: Add error.tsx in the same folder as admin/shipping/zones/new to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/shipping/zones/[id]/edit**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/shipping/zones/[id]/edit
  Fix: Add error.tsx in the same folder as admin/shipping/zones/[id]/edit to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/suppliers/new**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/suppliers/new
  Fix: Add error.tsx in the same folder as admin/suppliers/new to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/suppliers**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/suppliers
  Fix: Add error.tsx in the same folder as admin/suppliers to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/suppliers/[id]**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/suppliers/[id]
  Fix: Add error.tsx in the same folder as admin/suppliers/[id] to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/supply-orders**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/supply-orders
  Fix: Add error.tsx in the same folder as admin/supply-orders to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/supply-orders/[id]**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/supply-orders/[id]
  Fix: Add error.tsx in the same folder as admin/supply-orders/[id] to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/tracking**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/tracking
  Fix: Add error.tsx in the same folder as admin/tracking to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/translations**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/translations
  Fix: Add error.tsx in the same folder as admin/translations to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/users/new**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/users/new
  Fix: Add error.tsx in the same folder as admin/users/new to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/users**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/users
  Fix: Add error.tsx in the same folder as admin/users to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/users/[id]**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/users/[id]
  Fix: Add error.tsx in the same folder as admin/users/[id] to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/vat-rates**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/vat-rates
  Fix: Add error.tsx in the same folder as admin/vat-rates to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: admin/wishlist-queue**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: admin/wishlist-queue
  Fix: Add error.tsx in the same folder as admin/wishlist-queue to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: auth/signin**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: auth/signin
  Fix: Add error.tsx in the same folder as auth/signin to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: auth/signup**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: auth/signup
  Fix: Add error.tsx in the same folder as auth/signup to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: checkout/mock/[session_id]**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: checkout/mock/[session_id]
  Fix: Add error.tsx in the same folder as checkout/mock/[session_id] to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: checkout/payment/[id]**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: checkout/payment/[id]
  Fix: Add error.tsx in the same folder as checkout/payment/[id] to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: checkout/success/[id]**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: checkout/success/[id]
  Fix: Add error.tsx in the same folder as checkout/success/[id] to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: orders**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: orders
  Fix: Add error.tsx in the same folder as orders to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: orders/[id]**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: orders/[id]
  Fix: Add error.tsx in the same folder as orders/[id] to handle runtime errors gracefully.
- `MI-012` **Missing error.tsx near: products/[slug]**
  No error boundary (error.tsx) found in the same route segment as this page.
  Affected: products/[slug]
  Fix: Add error.tsx in the same folder as products/[slug] to handle runtime errors gracefully.
- `MI-013` **Missing loading.tsx near: account/addresses**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: account/addresses
  Fix: Add loading.tsx in the same folder as account/addresses.
- `MI-013` **Missing loading.tsx near: account**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: account
  Fix: Add loading.tsx in the same folder as account.
- `MI-013` **Missing loading.tsx near: account/sessions**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: account/sessions
  Fix: Add loading.tsx in the same folder as account/sessions.
- `MI-013` **Missing loading.tsx near: admin/attributes**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/attributes
  Fix: Add loading.tsx in the same folder as admin/attributes.
- `MI-013` **Missing loading.tsx near: admin/audit-log**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/audit-log
  Fix: Add loading.tsx in the same folder as admin/audit-log.
- `MI-013` **Missing loading.tsx near: admin/categories/new**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/categories/new
  Fix: Add loading.tsx in the same folder as admin/categories/new.
- `MI-013` **Missing loading.tsx near: admin/categories**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/categories
  Fix: Add loading.tsx in the same folder as admin/categories.
- `MI-013` **Missing loading.tsx near: admin/categories/[id]/edit**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/categories/[id]/edit
  Fix: Add loading.tsx in the same folder as admin/categories/[id]/edit.
- `MI-013` **Missing loading.tsx near: admin/currencies**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/currencies
  Fix: Add loading.tsx in the same folder as admin/currencies.
- `MI-013` **Missing loading.tsx near: admin/customers**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/customers
  Fix: Add loading.tsx in the same folder as admin/customers.
- `MI-013` **Missing loading.tsx near: admin/customers/[id]**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/customers/[id]
  Fix: Add loading.tsx in the same folder as admin/customers/[id].
- `MI-013` **Missing loading.tsx near: admin/discounts**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/discounts
  Fix: Add loading.tsx in the same folder as admin/discounts.
- `MI-013` **Missing loading.tsx near: admin/discounts/[id]/edit**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/discounts/[id]/edit
  Fix: Add loading.tsx in the same folder as admin/discounts/[id]/edit.
- `MI-013` **Missing loading.tsx near: admin/errors**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/errors
  Fix: Add loading.tsx in the same folder as admin/errors.
- `MI-013` **Missing loading.tsx near: admin/inventory**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/inventory
  Fix: Add loading.tsx in the same folder as admin/inventory.
- `MI-013` **Missing loading.tsx near: admin/inventory-debug**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/inventory-debug
  Fix: Add loading.tsx in the same folder as admin/inventory-debug.
- `MI-013` **Missing loading.tsx near: admin/media**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/media
  Fix: Add loading.tsx in the same folder as admin/media.
- `MI-013` **Missing loading.tsx near: admin/newsletter**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/newsletter
  Fix: Add loading.tsx in the same folder as admin/newsletter.
- `MI-013` **Missing loading.tsx near: admin/orders**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/orders
  Fix: Add loading.tsx in the same folder as admin/orders.
- `MI-013` **Missing loading.tsx near: admin/orders/[id]**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/orders/[id]
  Fix: Add loading.tsx in the same folder as admin/orders/[id].
- `MI-013` **Missing loading.tsx near: admin/permissions**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/permissions
  Fix: Add loading.tsx in the same folder as admin/permissions.
- `MI-013` **Missing loading.tsx near: admin/products/bulk-edit**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/products/bulk-edit
  Fix: Add loading.tsx in the same folder as admin/products/bulk-edit.
- `MI-013` **Missing loading.tsx near: admin/products/new**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/products/new
  Fix: Add loading.tsx in the same folder as admin/products/new.
- `MI-013` **Missing loading.tsx near: admin/products**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/products
  Fix: Add loading.tsx in the same folder as admin/products.
- `MI-013` **Missing loading.tsx near: admin/products/[id]/edit**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/products/[id]/edit
  Fix: Add loading.tsx in the same folder as admin/products/[id]/edit.
- `MI-013` **Missing loading.tsx near: admin/products/[id]/variants/[variantId]**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/products/[id]/variants/[variantId]
  Fix: Add loading.tsx in the same folder as admin/products/[id]/variants/[variantId].
- `MI-013` **Missing loading.tsx near: admin/reports/margins**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/reports/margins
  Fix: Add loading.tsx in the same folder as admin/reports/margins.
- `MI-013` **Missing loading.tsx near: admin/returns**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/returns
  Fix: Add loading.tsx in the same folder as admin/returns.
- `MI-013` **Missing loading.tsx near: admin/roles**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/roles
  Fix: Add loading.tsx in the same folder as admin/roles.
- `MI-013` **Missing loading.tsx near: admin/roles/[id]/edit**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/roles/[id]/edit
  Fix: Add loading.tsx in the same folder as admin/roles/[id]/edit.
- `MI-013` **Missing loading.tsx near: admin/seo/edit**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/seo/edit
  Fix: Add loading.tsx in the same folder as admin/seo/edit.
- `MI-013` **Missing loading.tsx near: admin/seo**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/seo
  Fix: Add loading.tsx in the same folder as admin/seo.
- `MI-013` **Missing loading.tsx near: admin/settings/couriers**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/settings/couriers
  Fix: Add loading.tsx in the same folder as admin/settings/couriers.
- `MI-013` **Missing loading.tsx near: admin/settings/email**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/settings/email
  Fix: Add loading.tsx in the same folder as admin/settings/email.
- `MI-013` **Missing loading.tsx near: admin/settings/fees**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/settings/fees
  Fix: Add loading.tsx in the same folder as admin/settings/fees.
- `MI-013` **Missing loading.tsx near: admin/shipping**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/shipping
  Fix: Add loading.tsx in the same folder as admin/shipping.
- `MI-013` **Missing loading.tsx near: admin/shipping/rates/new**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/shipping/rates/new
  Fix: Add loading.tsx in the same folder as admin/shipping/rates/new.
- `MI-013` **Missing loading.tsx near: admin/shipping/rates/[id]/edit**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/shipping/rates/[id]/edit
  Fix: Add loading.tsx in the same folder as admin/shipping/rates/[id]/edit.
- `MI-013` **Missing loading.tsx near: admin/shipping/zones/[id]/edit**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/shipping/zones/[id]/edit
  Fix: Add loading.tsx in the same folder as admin/shipping/zones/[id]/edit.
- `MI-013` **Missing loading.tsx near: admin/suppliers**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/suppliers
  Fix: Add loading.tsx in the same folder as admin/suppliers.
- `MI-013` **Missing loading.tsx near: admin/suppliers/[id]**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/suppliers/[id]
  Fix: Add loading.tsx in the same folder as admin/suppliers/[id].
- `MI-013` **Missing loading.tsx near: admin/supply-orders**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/supply-orders
  Fix: Add loading.tsx in the same folder as admin/supply-orders.
- `MI-013` **Missing loading.tsx near: admin/supply-orders/[id]**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/supply-orders/[id]
  Fix: Add loading.tsx in the same folder as admin/supply-orders/[id].
- `MI-013` **Missing loading.tsx near: admin/tracking**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/tracking
  Fix: Add loading.tsx in the same folder as admin/tracking.
- `MI-013` **Missing loading.tsx near: admin/translations**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/translations
  Fix: Add loading.tsx in the same folder as admin/translations.
- `MI-013` **Missing loading.tsx near: admin/users/new**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/users/new
  Fix: Add loading.tsx in the same folder as admin/users/new.
- `MI-013` **Missing loading.tsx near: admin/users**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/users
  Fix: Add loading.tsx in the same folder as admin/users.
- `MI-013` **Missing loading.tsx near: admin/users/[id]**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/users/[id]
  Fix: Add loading.tsx in the same folder as admin/users/[id].
- `MI-013` **Missing loading.tsx near: admin/vat-rates**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/vat-rates
  Fix: Add loading.tsx in the same folder as admin/vat-rates.
- `MI-013` **Missing loading.tsx near: admin/wishlist-queue**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: admin/wishlist-queue
  Fix: Add loading.tsx in the same folder as admin/wishlist-queue.
- `MI-013` **Missing loading.tsx near: checkout/mock/[session_id]**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: checkout/mock/[session_id]
  Fix: Add loading.tsx in the same folder as checkout/mock/[session_id].
- `MI-013` **Missing loading.tsx near: checkout**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: checkout
  Fix: Add loading.tsx in the same folder as checkout.
- `MI-013` **Missing loading.tsx near: checkout/payment/[id]**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: checkout/payment/[id]
  Fix: Add loading.tsx in the same folder as checkout/payment/[id].
- `MI-013` **Missing loading.tsx near: checkout/success/[id]**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: checkout/success/[id]
  Fix: Add loading.tsx in the same folder as checkout/success/[id].
- `MI-013` **Missing loading.tsx near: orders/[id]**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: orders/[id]
  Fix: Add loading.tsx in the same folder as orders/[id].
- `MI-013` **Missing loading.tsx near: wishlist**
  This page fetches data but no loading.tsx was found in its route segment for React Suspense streaming.
  Affected: wishlist
  Fix: Add loading.tsx in the same folder as wishlist.
- `SG-004` **33 pages at same routing depth without grouping**
  33 pages share the same route depth without being organised into route groups.
  Affected: account/addresses, account/sessions, admin/attributes, admin/audit-log, admin/categories, admin/currencies +27 more
  Fix: Use route groups like (marketing)/, (app)/ to share layouts without affecting URL structure.
- `SG-004` **7 pages at same routing depth without grouping**
  7 pages share the same route depth without being organised into route groups.
  Affected: account, admin, cart, checkout, orders, products +1 more
  Fix: Use route groups like (marketing)/, (app)/ to share layouts without affecting URL structure.
- `SG-004` **23 pages at same routing depth without grouping**
  23 pages share the same route depth without being organised into route groups.
  Affected: admin/categories/new, admin/customers/new, admin/customers/[id], admin/discounts/new, admin/orders/new, admin/orders/[id] +17 more
  Fix: Use route groups like (marketing)/, (app)/ to share layouts without affecting URL structure.
- `SEO-002` `suspected` **Dynamic route without generateStaticParams: orders/[id]**
  This dynamic page renders on every request. Adding generateStaticParams + ISR would improve TTFB for known paths — but dynamic rendering is valid for CMS-driven content.
  Affected: orders/[id]
  Fix: If slugs are known at build time, add generateStaticParams() + revalidate to enable ISR. Otherwise this is intentional.
  Reference: https://nextjs.org/docs/app/api-reference/functions/generate-static-params
- `SEO-002` `suspected` **Dynamic route without generateStaticParams: products/[slug]**
  This dynamic page renders on every request. Adding generateStaticParams + ISR would improve TTFB for known paths — but dynamic rendering is valid for CMS-driven content.
  Affected: products/[slug]
  Fix: If slugs are known at build time, add generateStaticParams() + revalidate to enable ISR. Otherwise this is intentional.
  Reference: https://nextjs.org/docs/app/api-reference/functions/generate-static-params
- `PR-001` **Possibly unnecessary 'use client': SaveInfoPrompt**
  No browser hooks, event handlers, or store consumption detected. Consider converting to a server component.
  Affected: SaveInfoPrompt
  Fix: Remove 'use client' and render as a server component to reduce client bundle size.
- `PR-001` **Possibly unnecessary 'use client': RequirePermission**
  No browser hooks, event handlers, or store consumption detected. Consider converting to a server component.
  Affected: RequirePermission
  Fix: Remove 'use client' and render as a server component to reduce client bundle size.
- `PR-002` **Static-only client component: SaveInfoPrompt**
  No hooks, event handlers, or store usage detected. This component may not need 'use client'.
  Affected: SaveInfoPrompt
  Fix: Convert to a server component by removing the 'use client' directive.
- `PR-002` **Static-only client component: RequirePermission**
  No hooks, event handlers, or store usage detected. This component may not need 'use client'.
  Affected: RequirePermission
  Fix: Convert to a server component by removing the 'use client' directive.
- `CV-018` **Action file with zero auth guards: signIn.ts**
  None of the 1 export(s) in 'signIn.ts' contain an auth guard. This may be intentional for pre-auth flows (login, registration) but should be verified for actions that modify data.
  Affected: signIn
  Fix: Verify this is intentional. If these actions modify protected data, add an auth guard.
- `CV-018` **Action file with zero auth guards: signUp.ts**
  None of the 1 export(s) in 'signUp.ts' contain an auth guard. This may be intentional for pre-auth flows (login, registration) but should be verified for actions that modify data.
  Affected: signUp
  Fix: Verify this is intentional. If these actions modify protected data, add an auth guard.
- `CV-018` **Action file with zero auth guards: addToCartWithContentionCheck.ts**
  None of the 1 export(s) in 'addToCartWithContentionCheck.ts' contain an auth guard. This may be intentional for pre-auth flows (login, registration) but should be verified for actions that modify data.
  Affected: addToCartWithContentionCheck
  Fix: Verify this is intentional. If these actions modify protected data, add an auth guard.
- `CV-018` **Action file with zero auth guards: refreshCart.ts**
  None of the 1 export(s) in 'refreshCart.ts' contain an auth guard. This may be intentional for pre-auth flows (login, registration) but should be verified for actions that modify data.
  Affected: refreshCart
  Fix: Verify this is intentional. If these actions modify protected data, add an auth guard.
- `CV-018` **Action file with zero auth guards: getEffectiveAvailableAction.ts**
  None of the 1 export(s) in 'getEffectiveAvailableAction.ts' contain an auth guard. This may be intentional for pre-auth flows (login, registration) but should be verified for actions that modify data.
  Affected: getEffectiveAvailableAction
  Fix: Verify this is intentional. If these actions modify protected data, add an auth guard.
- `CV-018` **Action file with zero auth guards: setInventoryLevel.ts**
  None of the 1 export(s) in 'setInventoryLevel.ts' contain an auth guard. This may be intentional for pre-auth flows (login, registration) but should be verified for actions that modify data.
  Affected: setInventoryLevel
  Fix: Verify this is intentional. If these actions modify protected data, add an auth guard.
- `CV-018` **Action file with zero auth guards: searchAdminVariants.ts**
  None of the 1 export(s) in 'searchAdminVariants.ts' contain an auth guard. This may be intentional for pre-auth flows (login, registration) but should be verified for actions that modify data.
  Affected: searchAdminVariants
  Fix: Verify this is intentional. If these actions modify protected data, add an auth guard.
- `CV-018` **Action file with zero auth guards: searchCustomers.ts**
  None of the 1 export(s) in 'searchCustomers.ts' contain an auth guard. This may be intentional for pre-auth flows (login, registration) but should be verified for actions that modify data.
  Affected: searchCustomers
  Fix: Verify this is intentional. If these actions modify protected data, add an auth guard.
- `CV-018` **Action file with zero auth guards: searchSupplierVariants.ts**
  None of the 1 export(s) in 'searchSupplierVariants.ts' contain an auth guard. This may be intentional for pre-auth flows (login, registration) but should be verified for actions that modify data.
  Affected: searchSupplierVariants
  Fix: Verify this is intentional. If these actions modify protected data, add an auth guard.
- `CV-018` **Action file with zero auth guards: deleteUser.ts**
  None of the 1 export(s) in 'deleteUser.ts' contain an auth guard. This may be intentional for pre-auth flows (login, registration) but should be verified for actions that modify data.
  Affected: deleteUser
  Fix: Verify this is intentional. If these actions modify protected data, add an auth guard.
- `MC-010` **package.json missing engines.node field**
  No Node.js version constraint specified. Vercel may deploy on an unexpected Node runtime.
  Fix: Add "engines": { "node": ">=20" } to package.json.


---

## Environment Variables

- `.env.local`
- `NEXT_PUBLIC_SUPABASE_URL` `PUBLIC`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` `PUBLIC`
- `SUPABASE_SERVICE_ROLE_KEY` `SECRET`
- `STRIPE_SECRET_KEY` `SECRET`
- `STRIPE_WEBHOOK_SECRET` `SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` `PUBLIC`
- `CRM_API_KEY` `SECRET`
- `CRM_API_URL`
- `COURIER_API_KEY` `SECRET`
- `COURIER_API_URL`
- `MARKETPLACE_API_KEY` `SECRET`
- `MARKETPLACE_API_URL`
- `NEWSLETTER_API_KEY` `SECRET`
- `NEWSLETTER_API_URL`
- `NEXT_PUBLIC_SITE_URL` `PUBLIC`
- `NEXT_PUBLIC_DEFAULT_LOCALE` `PUBLIC`
- `NEXT_PUBLIC_DEFAULT_CURRENCY` `PUBLIC`

---

_This file is auto-generated by [Arch](https://github.com/arch-app). Do not edit manually._
