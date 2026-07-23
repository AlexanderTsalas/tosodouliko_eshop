import { redirect } from "next/navigation";

/**
 * Deep-link fallback for `/admin/products/[productId]`.
 *
 * Bare product URLs (bookmarks, pasted links, old references) redirect to
 * the products list with that product's side panel opened via `?focus=`.
 * The panel is the editor now — there is no standalone product edit page.
 */
export default async function ProductDeepLinkFallback({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  redirect(`/admin/products?focus=${productId}`);
}
