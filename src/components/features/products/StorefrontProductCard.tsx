import Link from "next/link";
import Image from "next/image";
import Price from "@/components/features/multi-currency/Price";
import OfferBadge from "@/components/features/products/OfferBadge";
import WishlistHeartButton from "@/components/features/wishlist/WishlistHeartButton";
import type { CatalogCard, OfferRuleSummary } from "@/lib/site-search";
import { strings } from "@/config/strings";

interface Props {
  card: CatalogCard;
  /** Rule lookup keyed by id, for badge rendering — same shape as
   *  `searchVariants` returns alongside its card list. Optional;
   *  when missing, no badge renders (still safe). */
  offerRulesById?: Record<string, OfferRuleSummary>;
  /** When true, the card image is rendered with Next.js `priority` —
   *  meant for the first row above-the-fold on the catalog page so
   *  LCP isn't gated on lazy-load. Default false. */
  priorityImage?: boolean;
  /** Width behaviour. "fixed" (default) keeps the shared 13rem tile used
   *  in carousels. "fluid" fills its grid cell — used by the catalog's
   *  responsive stretch grid. "feature" is a ~2× tile (caps at 26rem,
   *  fills its grid cell) used by the home featured grid. */
  layout?: "fixed" | "fluid" | "feature" | "masonry";
}

/**
 * Storefront product / variant card. One source of truth for the
 * tile that appears on the catalog grid, in related-products
 * carousels, and anywhere else we surface a "buyable thing" link.
 *
 * Visual contract:
 *   - Bordered rounded container with consistent padding
 *   - Square image (object-cover) at the top
 *   - OOS overlay + offer badge corners on the image
 *   - Title + price below the image
 *
 * Catalog-specific layout (column count, grid gap, etc) stays at
 * the page level — this component just produces one tile.
 */
export default function StorefrontProductCard({
  card,
  offerRulesById,
  priorityImage = false,
  layout = "fixed",
}: Props) {
  const title = cardTitle(card);
  const rule = card.offer_state
    ? offerRulesById?.[card.offer_state.rule_id] ?? null
    : null;

  // Masonry "physical photograph" variant — a polaroid-style white frame with
  // a slight tilt (straightens on hover) and a varied image aspect ratio, so
  // cards stagger in the CSS-columns masonry on the catalog page.
  if (layout === "masonry") {
    const seed = hashString(card.cardKey);
    const tilt = ["-rotate-2", "-rotate-1", "rotate-1", "rotate-2", "rotate-1"][seed % 5];
    const aspect = ["aspect-[4/5]", "aspect-square", "aspect-[3/4]"][seed % 3];
    return (
      <li className="group list-none">
        <div
          className={`relative bg-[#FFFDFB] border border-stone-taupe/15 p-2.5 pb-1 shadow-[0_8px_22px_-8px_rgba(43,36,32,0.3)] transition-all duration-300 ${tilt} group-hover:rotate-0 group-hover:-translate-y-1 group-hover:shadow-[0_16px_34px_-10px_rgba(43,36,32,0.42)]`}
        >
          <WishlistHeartButton
            productId={card.product.id}
            variantId={card.variant.id}
            className="absolute top-4 right-4 z-20"
          />
          <Link href={card.href} className="block">
            <div className={`relative overflow-hidden rounded-md border-2 border-[#4a3320]/55 bg-warm-sand ${aspect}`}>
              {card.image && card.image.url ? (
                <Image
                  src={card.image.url}
                  alt={card.image.alt_text ?? title}
                  fill
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                  quality={72}
                  priority={priorityImage}
                  className={"object-cover" + (card.out_of_stock ? " opacity-70" : "")}
                />
              ) : (
                <div className="w-full h-full bg-muted" aria-hidden="true" />
              )}
              {(card.out_of_stock || rule) && (
                <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1.5">
                  {card.out_of_stock && (
                    <span className="rounded bg-[hsl(var(--badge-oos-overlay))] text-[hsl(var(--badge-oos-text))] text-[10px] font-medium px-2 py-0.5 uppercase tracking-wide">
                      {strings.products.outOfStock}
                    </span>
                  )}
                  {rule && <OfferBadge rule={rule} size="sm" />}
                </div>
              )}
            </div>
            {card.product.brand && (
              <span className="block text-[9px] font-mono uppercase tracking-widest text-stone-taupe font-bold mt-3 px-1">
                {card.product.brand}
              </span>
            )}
            <p
              className={`font-sans font-bold text-base leading-snug text-ink transition-colors group-hover:text-terracotta line-clamp-3 px-1 ${
                card.product.brand ? "mt-0.5" : "mt-3"
              }`}
            >
              {title}
            </p>
          </Link>
          <div className="px-1 pb-1 mt-1">
            <PriceLine card={card} />
          </div>
        </div>
      </li>
    );
  }

  const widthClass =
    layout === "fluid"
      ? "w-full"
      : layout === "feature"
        ? "w-full max-w-[26rem] mx-auto"
        : "storefront-product-card";
  return (
    <li className={`${widthClass} group relative border border-stone-taupe/15 rounded-sm p-3 flex flex-col gap-2 bg-card list-none transition-all duration-300 shadow-[0_8px_22px_-12px_rgba(43,36,32,0.28)] hover:shadow-[0_16px_34px_-12px_rgba(43,36,32,0.4)] hover:border-stone-taupe/35`}>
      {/* Wishlist heart — sibling of the link (not nested in the anchor),
          absolutely positioned over the image. */}
      <WishlistHeartButton
        productId={card.product.id}
        variantId={card.variant.id}
        className="absolute top-5 right-5 z-20"
      />
      <Link href={card.href} className="block">
        <div className="relative overflow-hidden rounded-md border-2 border-[#4a3320]/55 bg-warm-sand">
          {card.image && card.image.url ? (
            <Image
              src={card.image.url}
              alt={card.image.alt_text ?? title}
              width={400}
              height={400}
              sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
              quality={70}
              priority={priorityImage}
              className={
                "w-full aspect-square object-cover transition-transform duration-500 group-hover:scale-105" +
                (card.out_of_stock ? " opacity-70" : "")
              }
            />
          ) : (
            <div
              className={
                "w-full aspect-square bg-muted" +
                (card.out_of_stock ? " opacity-70" : "")
              }
              aria-hidden="true"
            />
          )}
          {(card.out_of_stock || rule) && (
            <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1.5">
              {card.out_of_stock && (
                <span className="rounded bg-[hsl(var(--badge-oos-overlay))] text-[hsl(var(--badge-oos-text))] text-[10px] font-medium px-2 py-0.5 uppercase tracking-wide">
                  {strings.products.outOfStock}
                </span>
              )}
              {rule && <OfferBadge rule={rule} size="sm" />}
            </div>
          )}
        </div>
        {card.product.brand && (
          <span className="block text-[9px] font-mono uppercase tracking-widest text-stone-taupe font-bold mt-2">
            {card.product.brand}
          </span>
        )}
        <p className={`font-sans font-bold text-base leading-snug text-ink transition-colors group-hover:text-terracotta line-clamp-3 ${card.product.brand ? "mt-0.5" : "mt-2"}`}>
          {title}
        </p>
      </Link>
      <PriceLine card={card} />
    </li>
  );
}

/** Shared price row (effective + struck-through original, or plain price). */
function PriceLine({ card }: { card: CatalogCard }) {
  return (
    <p className="text-lg flex items-baseline gap-2 flex-wrap font-sans tabular-nums [word-spacing:-0.18em]">
      {card.offer_state ? (
        <>
          <span className="font-bold text-ink">
            <Price amount={card.offer_state.effective_price} currency={card.product.currency} />
          </span>
          <span className="text-muted-foreground line-through text-xs">
            <Price amount={card.offer_state.original_price} currency={card.product.currency} />
          </span>
        </>
      ) : (
        <span className="font-semibold text-ink">
          <Price amount={Number(card.variant.price)} currency={card.product.currency} />
        </span>
      )}
    </p>
  );
}

/** Tiny deterministic string hash — drives the per-card tilt/aspect so a
 *  card always renders the same angle (stable across re-renders). */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * "Product Name — Value / Value" — used by both the catalog page and
 * the related-products carousels so card titles stay consistent.
 */
export function cardTitle(card: {
  product: { name: string };
  splitterValues: Record<string, string>;
}): string {
  const values = Object.values(card.splitterValues);
  if (values.length === 0) return card.product.name;
  return `${card.product.name} — ${values.join(" / ")}`;
}
