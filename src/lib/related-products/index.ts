/**
 * Related Products engine — barrel.
 *
 * Storefront / admin code imports from here. The resolver is a pure
 * function; the loader is the only side-effecting part.
 */

export { resolveRelatedProducts } from "./resolver";
export { loadResolverData } from "./loadResolverData";
export { buildViewerFromProduct } from "./buildViewer";
export {
  findAssociationsForProduct,
  type AssociationsForProductResult,
} from "./findForProduct";
export type {
  ResolverViewer,
  ResolverProductData,
  ResolverDataset,
  ResolvedCarousel,
  ResolverResult,
  ResolverWarning,
} from "./types";
