import ProductCategoriesEditor from "@/components/admin/products/ProductCategoriesEditor";
import type { Category } from "@/types/category-navigation";

interface Props {
  productId: string;
  allCategories: Category[];
  initialCategoryIds: string[];
}

export default function ProductCategoriesTab({
  productId,
  allCategories,
  initialCategoryIds,
}: Props) {
  return (
    <ProductCategoriesEditor
      productId={productId}
      allCategories={allCategories}
      initialCategoryIds={initialCategoryIds}
    />
  );
}
