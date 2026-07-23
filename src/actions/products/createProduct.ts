"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { slugify } from "@/lib/slugify";
import { fail, ok, type Result } from "@/types/result";
import type { Product } from "@/types/products";

const VariantSpec = z.object({
  sku: z.string().min(1).max(100),
  price: z.number().nonnegative(),
  attributeCombo: z.record(z.string()).nullable().optional(),
  isActive: z.boolean().default(true),
});

const SeoSpec = z.object({
  title: z.string().max(200).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  ogImageUrl: z.string().url().nullable().optional(),
  canonicalUrl: z.string().url().nullable().optional(),
  robots: z.string().max(200).nullable().optional(),
  noIndex: z.boolean().optional(),
});

const Schema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).optional(),
  description: z.string().max(20000).optional(),
  basePrice: z.number().nonnegative(),
  currency: z.string().min(3).max(3).default("EUR"),
  weightG: z.number().int().nonnegative().optional(),
  /** Physical dimensions in millimetres — used by volumetric weight
   *  pricing on the shipping side. Same field set as updateProduct. */
  lengthMm: z.number().int().nonnegative().nullable().optional(),
  widthMm: z.number().int().nonnegative().nullable().optional(),
  heightMm: z.number().int().nonnegative().nullable().optional(),
  /** Volumetric prefix override — null = use carrier default. */
  volumetricPrefixId: z.string().uuid().nullable().optional(),
  ageMin: z.number().int().min(0).max(99).optional(),
  ageMax: z.number().int().min(0).max(99).optional(),
  brand: z.string().max(200).optional(),
  active: z.boolean().default(true),
  /** Out-of-stock visibility override. null = use global default. */
  showWhenOos: z.boolean().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),

  /** At least one variant required — every product must be sellable. */
  variants: z.array(VariantSpec).min(1, "At least one variant is required."),

  /** Optional initial category assignment. */
  categoryIds: z.array(z.string().uuid()).optional(),

  /** Optional SEO metadata persisted alongside the product. */
  seo: SeoSpec.optional(),

  /** Optional VAT classification (falls back to category default ⇒ system default). */
  vatRateId: z.string().uuid().nullable().optional(),

  /** Optional wholesale/manufacturing cost — drives margin metrics only. */
  costPrice: z.number().nonnegative().nullable().optional(),
  costCurrency: z.string().min(3).max(3).nullable().optional(),

  /** Optional default supplier — auto-linked to every variant created with the product. */
  defaultSupplierId: z.string().uuid().nullable().optional(),

  /**
   * Optional initial unit cost from the default supplier. When provided
   * along with `defaultSupplierId`, the supplier_products row(s) created
   * for the new variants carry this cost from day one (instead of
   * being NULL and falling back to products.cost_price). Useful when
   * the admin already knows the negotiated cost at product-creation
   * time. The `addMatrixCombos` action later propagates these links
   * (including cost) to variants created by axis expansion.
   *
   * Schema rule: if `initialUnitCost` is set, `initialUnitCostCurrency`
   * MUST be set too (matches the supplier_products CHECK constraint
   * `(unit_cost IS NULL AND unit_cost_currency IS NULL) OR (both set)`).
   * Silently ignored if `defaultSupplierId` is null.
   */
  initialUnitCost: z.number().nonnegative().nullable().optional(),
  initialUnitCostCurrency: z
    .string()
    .min(3)
    .max(3)
    .toUpperCase()
    .nullable()
    .optional(),

  /**
   * Admin-chosen SKU prefix. Persisted on the product so future
   * "add axis value" operations can derive new variant SKUs from the
   * same prefix instead of falling back to the product slug.
   */
  baseSku: z.string().min(1).max(100).optional(),

  /**
   * Optional product specifications (Material, Origin, Δέσιμο, …)
   * staged in the create form's Variants tab and inserted into
   * product_specifications in the same transaction as the product.
   * Each spec carries the attribute_id + free-text value. Renames
   * still belong on the dedicated /admin/attributes page (the same
   * read-only-value policy that ProductSpecsPanel enforces in
   * create mode).
   */
  productSpecs: z
    .array(
      z.object({
        attributeId: z.string().uuid(),
        value: z.string().min(1).max(500),
      })
    )
    .optional(),

  /**
   * Optional per-attribute split-listing override map (slug → bool).
   * Mirrors the SplitOverridesPanel output. Stored in
   * products.split_overrides jsonb. Empty/missing = "inherit the
   * global attribute.splits_listing flag" for every axis.
   */
  splitOverrides: z.record(z.boolean()).nullable().optional(),

  /**
   * Attribute axes that affect the product's images. Mirrors the
   * ProductImageAxesSelector output and lands in products.image_axes.
   * Empty array means "no axis differentiation" (general images apply
   * to all variants). Same shape the storefront selectImagesForVariant
   * algorithm consumes.
   */
  imageAxes: z.array(z.string().min(1).max(80)).default([]),

  /**
   * Optional images uploaded in the create-mode admin UI before the
   * product was saved. Each entry has already had its bytes pushed to
   * storage (via requestProductImageUpload + browser-direct PUT) and
   * arrives here with the storage_key the file lives under. This
   * action inserts the corresponding media_assets + product_images
   * rows in the same transaction-ish flow as the product creation —
   * so by the time the user lands on the edit page, all the images
   * they staged in the form are already there.
   *
   * Cover semantics: per (product, attribute_combo) group. The first
   * image marked is_cover within each group wins; subsequent ones
   * are silently demoted (the UI shouldn't produce multi-cover rows
   * anyway).
   */
  stagedImages: z
    .array(
      z.object({
        storageKey: z.string().min(1),
        bucket: z.string().min(1),
        sizeBytes: z.number().int().nonnegative().max(20 * 1024 * 1024),
        attributeCombo: z.record(z.string()).default({}),
        altText: z.string().max(500).optional(),
        isCover: z.boolean().default(false),
        displayOrder: z.number().int().nonnegative().default(0),
      })
    )
    .default([]),
});

/**
 * Atomically creates a product and all of its variants. If any variant insert
 * fails (e.g., duplicate SKU), the parent product row is rolled back so we
 * never end up with a variant-less product.
 */
export async function createProduct(
  input: z.input<typeof Schema>
): Promise<Result<Product>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<Product>("Invalid input: " + parsed.error.issues[0].message, "INVALID_INPUT");
  }

  if (!(await checkPermission("manage:products"))) {
    return fail<Product>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<Product>("Not authenticated", "UNAUTHENTICATED");

  const slug = parsed.data.slug ?? slugify(parsed.data.name);
  const admin = createAdminClient();

  // 1. Insert product row.
  const { data: productRow, error: productErr } = await admin
    .from("products")
    .insert({
      name: parsed.data.name,
      slug,
      description: parsed.data.description ?? null,
      base_price: parsed.data.basePrice,
      currency: parsed.data.currency,
      weight_g: parsed.data.weightG ?? null,
      length_mm: parsed.data.lengthMm ?? null,
      width_mm: parsed.data.widthMm ?? null,
      height_mm: parsed.data.heightMm ?? null,
      volumetric_prefix_id: parsed.data.volumetricPrefixId ?? null,
      age_min: parsed.data.ageMin ?? null,
      age_max: parsed.data.ageMax ?? null,
      brand: parsed.data.brand ?? null,
      active: parsed.data.active ?? true,
      show_when_oos:
        parsed.data.showWhenOos === undefined
          ? null
          : parsed.data.showWhenOos,
      metadata: parsed.data.metadata ?? null,
      vat_rate_id: parsed.data.vatRateId ?? null,
      cost_price: parsed.data.costPrice ?? null,
      cost_currency: parsed.data.costCurrency
        ? parsed.data.costCurrency.toUpperCase()
        : null,
      default_supplier_id: parsed.data.defaultSupplierId ?? null,
      base_sku: parsed.data.baseSku ?? null,
      // Per-attribute split-listing override jsonb. Empty/missing →
      // null = inherit the global attribute.splits_listing flag.
      split_overrides:
        parsed.data.splitOverrides &&
        Object.keys(parsed.data.splitOverrides).length > 0
          ? parsed.data.splitOverrides
          : null,
      // Image-affecting axes (e.g. ["color"] for shoes). Empty = no
      // axis differentiation, general images apply to all variants.
      image_axes: parsed.data.imageAxes ?? [],
    })
    .select()
    .single();

  if (productErr || !productRow) {
    if (productErr?.code === "23505") return fail<Product>("Slug already in use", "DUPLICATE_SLUG");
    return fail<Product>(productErr?.message ?? "Insert failed", productErr?.code);
  }

  const productId = (productRow as { id: string }).id;

  // 2. Bulk insert variants. The on_variant_inventory_change trigger creates
  //    inventory_items rows automatically.
  const variantRows = parsed.data.variants.map((v) => ({
    product_id: productId,
    sku: v.sku,
    price: v.price,
    attribute_combo: v.attributeCombo ?? null,
    is_active: v.isActive ?? true,
  }));

  const { data: insertedVariants, error: variantsErr } = await admin
    .from("product_variants")
    .insert(variantRows)
    .select("id");

  if (variantsErr) {
    // 3. Roll back the product (cascade kills any successfully-inserted variants).
    await admin.from("products").delete().eq("id", productId);

    if (variantsErr.code === "23505") {
      return fail<Product>(
        "Duplicate variant: SKU or attribute combination already exists.",
        "DUPLICATE_VARIANT"
      );
    }
    return fail<Product>(
      "Failed to create variants: " + variantsErr.message,
      variantsErr.code
    );
  }

  // 2b. If a default supplier was passed, auto-link it to every new variant
  //     as preferred. Includes negotiated unit_cost when the admin
  //     entered one at creation time — this means the supplier_products
  //     row goes in with cost from day one, no separate "go set the cost"
  //     step. Non-fatal: if this fails we keep the product+variants
  //     (admin can link manually from the variant tab).
  //
  //     The cost+currency pair: both required or both null (matches the
  //     supplier_products CHECK constraint). Defensive guard at the JS
  //     layer too — partial input would otherwise raise a DB error here.
  if (parsed.data.defaultSupplierId && insertedVariants && insertedVariants.length > 0) {
    const hasCost =
      parsed.data.initialUnitCost !== null &&
      parsed.data.initialUnitCost !== undefined &&
      parsed.data.initialUnitCostCurrency !== null &&
      parsed.data.initialUnitCostCurrency !== undefined;
    const supplierLinks = (insertedVariants as Array<{ id: string }>).map((v) => ({
      variant_id: v.id,
      supplier_id: parsed.data.defaultSupplierId!,
      is_preferred: true,
      ...(hasCost
        ? {
            unit_cost: parsed.data.initialUnitCost,
            unit_cost_currency: parsed.data.initialUnitCostCurrency,
          }
        : {}),
    }));
    await admin.from("supplier_products").insert(supplierLinks);
  }

  // 2c. Optional product specifications — staged at create time
  //     via the Variants tab's ProductSpecsPanel (create mode).
  //     Non-fatal: if these fail to insert, the product+variants are
  //     kept and the admin can add specs later from the edit page's
  //     Variants tab. display_order is the array index so the on-
  //     screen order matches what the admin built.
  if (parsed.data.productSpecs && parsed.data.productSpecs.length > 0) {
    const specRows = parsed.data.productSpecs.map((s, idx) => ({
      product_id: productId,
      attribute_id: s.attributeId,
      value: s.value,
      display_order: idx,
    }));
    await admin.from("product_specifications").insert(specRows);
  }

  // 2d. Optional staged images — uploaded to storage during the
  //     create-form session via the same Images tab UI as edit mode.
  //     Bytes already live at the given storage_key; we now create
  //     the media_assets + product_images rows that link them to
  //     this product. Non-fatal: if the inserts fail the product +
  //     variants stay; admin can re-upload from the edit page. The
  //     orphan-media reaper cleans up the unreferenced bytes after
  //     24h.
  //
  //     Cover semantics: enforce single-cover-per-attribute_combo
  //     group. The client may submit multiple is_cover=true for
  //     different groups (one per group) but never multi within a
  //     group; we still defend in case the UI lets it slip through.
  if (parsed.data.stagedImages.length > 0) {
    // First, insert one media_assets row per staged image.
    const mediaRows = parsed.data.stagedImages.map((s) => ({
      uploader_id: authData.user.id,
      bucket: s.bucket,
      storage_key: s.storageKey,
      filename: s.storageKey.split("/").pop() ?? s.storageKey,
      mime_type: "image/webp",
      size_bytes: s.sizeBytes,
      alt_text: s.altText ?? null,
      folder: `products/${slug}`,
      is_public: true,
    }));
    const { data: insertedMedia, error: mediaErr } = await admin
      .from("media_assets")
      .insert(mediaRows)
      .select("id, bucket, storage_key");
    if (mediaErr) {
      console.error(
        "[createProduct] staged-images media_assets insert failed:",
        mediaErr.message
      );
    } else if (insertedMedia) {
      // Map (bucket, storage_key) → media_asset_id so we can pair
      // each staged entry with its newly-created media row.
      const mediaIdByKey = new Map(
        (insertedMedia as Array<{ id: string; bucket: string; storage_key: string }>).map((m) => [
          `${m.bucket}::${m.storage_key}`,
          m.id,
        ])
      );

      // Single-cover-per-group enforcement: track which groups have
      // already had their cover set, and demote any subsequent
      // is_cover=true in the same group.
      const groupCoverSet = new Set<string>();
      const comboKey = (c: Record<string, string>) =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries(c).sort(([a], [b]) => a.localeCompare(b))
          )
        );

      const imageRows = parsed.data.stagedImages.map((s) => {
        const mediaAssetId = mediaIdByKey.get(`${s.bucket}::${s.storageKey}`);
        const gKey = comboKey(s.attributeCombo);
        let isCover = s.isCover;
        if (isCover) {
          if (groupCoverSet.has(gKey)) {
            isCover = false;
          } else {
            groupCoverSet.add(gKey);
          }
        }
        return {
          product_id: productId,
          media_asset_id: mediaAssetId ?? null,
          bucket: s.bucket,
          storage_key: s.storageKey,
          url: null,
          attribute_combo:
            Object.keys(s.attributeCombo).length === 0
              ? null
              : s.attributeCombo,
          alt_text: s.altText ?? null,
          alt_text_is_auto: !s.altText,
          display_order: s.displayOrder,
          is_cover: isCover,
        };
      });

      const { error: imgErr } = await admin
        .from("product_images")
        .insert(imageRows);
      if (imgErr) {
        console.error(
          "[createProduct] staged-images product_images insert failed:",
          imgErr.message
        );
      }
    }
  }

  // 3. Optional category assignments — rollback on failure too.
  if (parsed.data.categoryIds && parsed.data.categoryIds.length > 0) {
    const { error: catsErr } = await admin.from("product_categories").insert(
      parsed.data.categoryIds.map((category_id) => ({
        product_id: productId,
        category_id,
      }))
    );
    if (catsErr) {
      await admin.from("products").delete().eq("id", productId);
      return fail<Product>(
        "Failed to assign categories: " + catsErr.message,
        catsErr.code
      );
    }
  }

  // 4. Optional SEO metadata — non-fatal: if it fails we keep the product.
  if (parsed.data.seo) {
    const seo = parsed.data.seo;
    const hasAny =
      seo.title ||
      seo.description ||
      seo.ogImageUrl ||
      seo.canonicalUrl ||
      seo.robots ||
      seo.noIndex;
    if (hasAny) {
      await admin.from("seo_metadata").insert({
        resource_type: "product",
        resource_id: productId,
        title: seo.title ?? null,
        description: seo.description ?? null,
        og_image_url: seo.ogImageUrl ?? null,
        canonical_url: seo.canonicalUrl ?? null,
        robots: seo.robots ?? null,
        no_index: seo.noIndex ?? false,
      });
    }
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "product.created",
    resource_type: "product",
    resource_id: productId,
    metadata: {
      name: parsed.data.name,
      slug,
      variantCount: parsed.data.variants.length,
    },
  });

  revalidatePath("/admin/products");
  revalidatePath("/admin/inventory");
  revalidatePath(`/products/${slug}`);
  updateTag("catalog-facets");
  return ok(productRow as unknown as Product);
}
