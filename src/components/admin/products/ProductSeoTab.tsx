import SeoMetadataForm from "@/components/admin/seo/SeoMetadataForm";
import type { SeoMetadata } from "@/types/dynamic-seo";

interface Props {
  productId: string;
  initial: SeoMetadata | null;
}

export default function ProductSeoTab({ productId, initial }: Props) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        SEO metadata για τη σελίδα του προϊόντος. Για παραλλαγές με δικό τους URL (split-listing),
        ορίστε ξεχωριστά metadata στη σελίδα κάθε παραλλαγής.
      </p>
      <SeoMetadataForm
        resourceType="product"
        resourceId={productId}
        initial={initial}
      />
    </div>
  );
}
