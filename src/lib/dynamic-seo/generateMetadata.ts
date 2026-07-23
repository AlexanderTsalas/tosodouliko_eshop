import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

/**
 * Build a Next.js Metadata object for a (resource_type, resource_id) pair,
 * falling back to the provided defaults if no row exists.
 *
 * For use inside `export async function generateMetadata` route handlers.
 */
export async function generateSeoMetadata(
  resourceType: string,
  resourceId: string,
  defaults?: Partial<Metadata>
): Promise<Metadata> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("seo_metadata")
    .select("*")
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .maybeSingle();

  if (error || !data) return defaults ?? {};

  const row = data as any;
  return {
    title: row.title ?? defaults?.title,
    description: row.description ?? defaults?.description,
    robots: row.no_index ? "noindex,nofollow" : row.robots ?? "index,follow",
    alternates: row.canonical_url ? { canonical: row.canonical_url } : defaults?.alternates,
    openGraph: row.og_image_url
      ? {
          images: [{ url: row.og_image_url }],
          ...(defaults?.openGraph as object | undefined),
        }
      : defaults?.openGraph,
  };
}
