import { z } from "zod";

const FkOp = z.enum(["is", "empty", "not_empty"]);
const TextOp = z.enum(["contains", "not_contains", "empty", "not_empty"]);
const NumOp = z.enum([
  "between",
  "eq",
  "gt",
  "lt",
  "gte",
  "lte",
  "empty",
  "not_empty",
]);

/**
 * Zod schema for AdminProductFilterParams, used by all bulk action server
 * actions that accept filter-based matchAll selection.
 */
export const FilterParamsSchema = z
  .object({
    q: z.string().optional(),
    status: z.string().optional(),
    stock: z.string().optional(),

    name: z.string().optional(),
    nameOp: TextOp.optional(),
    baseSku: z.string().optional(),
    baseSkuOp: TextOp.optional(),

    categoryIds: z.array(z.string()).optional(),
    supplierIds: z.array(z.string()).optional(),
    volumePrefixIds: z.array(z.string()).optional(),

    categoryId: z.string().optional(),
    categoryIdOp: FkOp.optional(),
    supplierId: z.string().optional(),
    supplierIdOp: FkOp.optional(),
    vatRateId: z.string().optional(),
    vatRateIdOp: FkOp.optional(),

    brand: z.string().optional(),
    brandOp: TextOp.optional(),

    priceValue: z.string().optional(),
    minPrice: z.string().optional(),
    maxPrice: z.string().optional(),
    priceOp: NumOp.optional(),

    minAge: z.string().optional(),
    maxAge: z.string().optional(),
    ageOp: NumOp.optional(),

    minWeight: z.string().optional(),
    maxWeight: z.string().optional(),
    weightOp: NumOp.optional(),

    minCostPrice: z.string().optional(),
    maxCostPrice: z.string().optional(),
    costPriceOp: NumOp.optional(),

    attributeFilters: z.record(z.array(z.string())).optional(),
  })
  .optional();
