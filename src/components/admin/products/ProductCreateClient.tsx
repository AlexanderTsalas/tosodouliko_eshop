"use client";

import { useState } from "react";
import ClientTabs from "@/components/admin/common/ClientTabs";
import ProductForm from "@/components/admin/products/ProductForm";
import type { Category } from "@/types/category-navigation";
import type { VolumetricPrefix } from "@/types/volumetric";
import type { VatRate } from "@/types/vat-rates";
import type { Supplier } from "@/types/suppliers";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";

interface Props {
  categories: Category[];
  suppliers: Supplier[];
  attributes: Attribute[];
  attributeValues: AttributeValue[];
  volumetricPrefixes: VolumetricPrefix[];
  vatRates: VatRate[];
  globalShowWhenOosDefault: boolean;
}

/**
 * Create-page coordinator. Wraps `ProductForm` with a 2-tab layout
 * (Επισκόπηση / Παραλλαγές) so the create flow mirrors the structure
 * of the edit page (which has the same tabs at the URL level).
 *
 * Architecture:
 *   - ONE ProductForm instance is mounted, holding ALL form state
 *     internally (basics, pricing, logistics, visibility, supplier,
 *     categories, axes, attribute_values).
 *   - The `visibleSections` prop on ProductForm tells it WHICH
 *     sections to paint based on the active tab — state stays alive
 *     across tab switches because the component itself doesn't
 *     unmount.
 *   - The `onNextStep` callback advances the tab from Overview to
 *     Variants when the admin clicks the gated CTA on the overview
 *     tab. The button is disabled until basics+price+SKU are valid.
 *   - The Variants tab's submit button is disabled until ≥1 valid
 *     variant is described (no empty axes, ≥1 unskipped combo OR
 *     baseSku is set as the single-SKU fallback).
 *
 * The admin can also click directly on either tab in the strip to
 * jump there. The state is preserved either way; the only difference
 * from "Next Step" is that direct-click doesn't run the overview-
 * validity gate. That's fine — submit on the Variants tab still
 * enforces it.
 */
type CreateTab = "overview" | "variants" | "images";

export default function ProductCreateClient(props: Props) {
  const [tab, setTab] = useState<CreateTab>("overview");

  return (
    <div>
      <ClientTabs
        tabs={[
          { key: "overview", label: "Επισκόπηση" },
          { key: "variants", label: "Παραλλαγές *" },
          { key: "images", label: "Εικόνες" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as CreateTab)}
      />

      <ProductForm
        mode="create"
        visibleSections={tab}
        /* The "next step" button advances tabs in order:
             overview → variants → images
           When the admin is already on the last tab (images), the
           form swaps the next-step CTA out for the final submit
           button instead — see ProductForm's submit-row branch. */
        onNextStep={
          tab === "overview"
            ? () => setTab("variants")
            : tab === "variants"
              ? () => setTab("images")
              : undefined
        }
        categories={props.categories}
        suppliers={props.suppliers}
        attributes={props.attributes}
        attributeValues={props.attributeValues}
        volumetricPrefixes={props.volumetricPrefixes}
        vatRates={props.vatRates}
        globalShowWhenOosDefault={props.globalShowWhenOosDefault}
      />
    </div>
  );
}
