/**
 * Named parcel size tier used by locker/APM couriers that price by size
 * class instead of exact dimensions. See migration
 * 20260610000003_volumetric_prefixes for the schema rationale.
 *
 * carrier_codes is a free-form JSON map of internal carrier slug →
 * size code that carrier expects (e.g. { "box_now": 1, "acs": "STD" }).
 * Provider classes (AcsProvider, BoxNowProvider) read the key they
 * care about and ignore the rest.
 */
export interface VolumetricPrefix {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  /** Reference outer dimensions for this tier — millimeters. */
  max_length_mm: number | null;
  max_width_mm: number | null;
  max_height_mm: number | null;
  /** Max gross weight in grams; null = no cap. */
  max_weight_g: number | null;
  /** Per-carrier size code mapping. */
  carrier_codes: Record<string, string | number>;
  display_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}
