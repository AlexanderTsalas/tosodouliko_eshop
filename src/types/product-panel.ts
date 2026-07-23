import type { ProductPanelData } from "@/components/admin/products/ProductDetailPanel";
import type { Product, ProductImage } from "@/types/products";
import type { ProductVariant } from "@/types/product-variants";
import type { VolumetricPrefix } from "@/types/volumetric";
import type { ProductSupplierSummary } from "@/lib/suppliers/getProductSupplierSummary";
import type { Category } from "@/types/category-navigation";
import type { Supplier } from "@/types/suppliers";
import type { VatRate, ResolvedVatRate } from "@/types/vat-rates";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";
import type { ProductSpecificationView } from "@/types/product-specifications";

/**
 * Shapes returned by the `getProductPanelData` server action. Kept in a
 * plain module (not the `"use server"` action file, which may only export
 * async functions) so both the action and the client panel can import
 * them.
 */

/** Pre-computed props for the panel's Overview tab — mirrors
 *  <ProductOverviewTab/>'s prop shape (minus the render-time
 *  `hideStatStrip` flag) so the client can spread it directly. */
export interface ProductPanelOverviewData {
  product: Product;
  variantCount: number;
  totalStock: number;
  vatRates: VatRate[];
  resolvedVat: ResolvedVatRate | null;
  allSuppliers: Supplier[];
  supplierSummary: ProductSupplierSummary[];
  volumetricPrefixes: VolumetricPrefix[];
  allCategories: Category[];
  initialCategoryIds: string[];
  /** Dynamic (auto-rule) categories the product currently resolves into —
   *  read-only (rule-derived, not stored in product_categories). */
  autoCategories: Array<{ id: string; name: string }>;
  margin: {
    metrics: {
      netSale: number;
      marginAmount: number;
      marginPercent: number;
    } | null;
    missing: string[];
    costSource: "supplier" | "product_fallback" | null;
  };
  avgSupplierCost: { amount: number; supplier_count: number } | null;
  globalShowWhenOosDefault: boolean;
}

/** Pre-computed props for the panel's Images tab (ProductImagesComboTab). */
export interface ProductPanelImagesData {
  productId: string;
  productName: string;
  initialImageAxes: string[];
  initialImages: ProductImage[];
  variants: ProductVariant[];
  attributes: Attribute[];
  attributeValues: AttributeValue[];
  initialSelectedKey?: string;
}

export interface ProductPanelBundle {
  panelData: ProductPanelData;
  overview: ProductPanelOverviewData;
  images: ProductPanelImagesData;
  /** Product specifications (read-only spec sheet) shown in the variants
   *  tab — orthogonal to variant axes. */
  specs: ProductSpecificationView[];
}
