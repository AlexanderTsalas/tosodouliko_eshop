"use client";

import { useEffect, useState } from "react";
import { getProductCustomFieldsData } from "@/actions/products/getProductCustomFieldsData";
import ProductCustomFieldsClient from "@/components/admin/products/ProductCustomFieldsClient";
import TabLoading from "./TabLoading";

type Data = Awaited<ReturnType<typeof getProductCustomFieldsData>>;

/**
 * Lazy wrapper for the custom-fields tab. Fetches binding + library data
 * on mount (i.e. when the tab is first opened) and hands it to the
 * existing ProductCustomFieldsClient unchanged.
 */
export default function CustomFieldsTabPanel({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let alive = true;
    getProductCustomFieldsData(productId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        /* leave in loading state on transient failure */
      });
    return () => {
      alive = false;
    };
  }, [productId]);

  if (!data) return <TabLoading />;

  return (
    <ProductCustomFieldsClient
      product_id={productId}
      product_name={productName}
      bindingsByScope={data.bindingsByScope}
      fieldsLibrary={data.fieldsLibrary}
      groupsLibrary={data.groupsLibrary}
    />
  );
}
