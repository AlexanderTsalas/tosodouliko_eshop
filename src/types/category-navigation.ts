export type CategoryMode = "manual" | "auto";

export interface AutoCategoryRules {
  /** attribute_slug → array of values. OR within an attribute, AND across attributes. */
  attribute_filters: Record<string, string[]>;
}

export interface Category {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  display_order: number;
  active: boolean;
  mode: CategoryMode;
  auto_rules: AutoCategoryRules | null;
  /** Default VAT rate inherited by products in this category. */
  vat_rate_id: string | null;
  created_at: string;
}

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}
