/**
 * Offers engine — barrel exports.
 *
 * Phase 1 ships:
 *   - Type definitions (see @/types/offers)
 *   - Engine function signatures (throwing skeletons; implementation
 *     follows in Phases 2 + 3)
 *   - loadCandidateOffers wrapping the eligible_offers SQL function
 *
 * See docs/offers-engine-implementation-plan.md for the full plan.
 */

export { evaluateOffersForCart } from "./evaluateOffersForCart";
export { evaluateOffersForVariantSet } from "./evaluateOffersForVariantSet";
export { loadCandidateOffers } from "./loadCandidateOffers";
export {
  applyOffersAtPlaceOrder,
  recordOfferApplications,
} from "./applyOffersAtPlaceOrder";
