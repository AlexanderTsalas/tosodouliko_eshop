export interface VatRate {
  id: string;
  name: string;
  code: string;
  /** Stored as a fraction in [0,1). E.g. 0.24 = 24%. */
  rate: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** Result of resolving the effective VAT rate for a product. */
export interface ResolvedVatRate {
  rate: VatRate;
  /** "product" = direct override, "category" = inherited, "default" = system fallback. */
  source: "product" | "category" | "default";
  /** If multiple categories had a rate set and we picked the lowest — admin should resolve. */
  conflictingCategoryRateIds: string[];
}
