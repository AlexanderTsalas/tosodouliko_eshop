"use client";

import { useEffect, useState } from "react";
import { getVariantSeo } from "@/actions/variants/getVariantSeo";
import SeoMetadataForm from "@/components/admin/seo/SeoMetadataForm";
import TabLoading from "./TabLoading";
import type { SeoMetadata } from "@/types/dynamic-seo";

/**
 * Body for an ephemeral variant-SEO tab. Lazy-loads the variant's
 * seo_metadata row, then renders the shared SeoMetadataForm scoped to
 * resource_type='product_variant'.
 */
export default function VariantSeoTabPanel({
  variantId,
  label,
}: {
  variantId: string;
  label?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [seo, setSeo] = useState<SeoMetadata | null>(null);

  useEffect(() => {
    let alive = true;
    getVariantSeo(variantId)
      .then((d) => {
        if (!alive) return;
        setSeo(d);
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [variantId]);

  if (!loaded) return <TabLoading />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        SEO metadata για την παραλλαγή{label ? ` «${label}»` : ""}.
        Χρησιμοποιείται μόνο για παραλλαγές με δικό τους URL (split-listing).
      </p>
      <SeoMetadataForm
        resourceType="product_variant"
        resourceId={variantId}
        initial={seo}
      />
    </div>
  );
}
