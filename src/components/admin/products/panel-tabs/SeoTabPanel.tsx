"use client";

import { useEffect, useState } from "react";
import { getProductSeo } from "@/actions/products/getProductSeo";
import ProductSeoTab from "@/components/admin/products/ProductSeoTab";
import TabLoading from "./TabLoading";
import type { SeoMetadata } from "@/types/dynamic-seo";

/**
 * Lazy wrapper for the product SEO tab. Fetches the product's
 * seo_metadata row on mount, then renders the existing ProductSeoTab
 * (SeoMetadataForm) unchanged.
 */
export default function SeoTabPanel({ productId }: { productId: string }) {
  const [loaded, setLoaded] = useState(false);
  const [seo, setSeo] = useState<SeoMetadata | null>(null);

  useEffect(() => {
    let alive = true;
    getProductSeo(productId)
      .then((d) => {
        if (!alive) return;
        setSeo(d);
        setLoaded(true);
      })
      .catch(() => {
        /* leave in loading state on transient failure */
      });
    return () => {
      alive = false;
    };
  }, [productId]);

  if (!loaded) return <TabLoading />;

  return <ProductSeoTab productId={productId} initial={seo} />;
}
