// Combo-aware product images flow. The legacy URL-based actions
// (addProductImage / setPrimaryImage / setImageVariant /
// deleteProductImage / reorderProductImages) were removed once their
// last consumers (VariantImagesTab, ProductImagesEditor) were deleted
// in favour of the combo-aware Images tab on the product edit page.

export { requestProductImageUpload } from "./requestProductImageUpload";
export { recordProductImage } from "./recordProductImage";
export { linkMediaAssetsToProduct } from "./linkMediaAssetsToProduct";
export { setProductImageCover } from "./setProductImageCover";
export { setProductImageAxes } from "./setProductImageAxes";
export { updateProductImage } from "./updateProductImage";
export {
  deleteProductImageWithCoverPromotion,
} from "./deleteProductImageWithCoverPromotion";
export { reorderProductImagesInGroup } from "./reorderProductImagesInGroup";
