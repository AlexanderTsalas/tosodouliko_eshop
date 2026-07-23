export interface SeoMetadata {
  id: string;
  resource_type: string;
  resource_id: string;
  title: string | null;
  description: string | null;
  og_image_url: string | null;
  robots: string | null;
  canonical_url: string | null;
  no_index: boolean;
  updated_at: string;
}
