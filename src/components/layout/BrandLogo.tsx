import { brand } from "@/config/brand";

interface BrandLogoProps {
  size?: "sm" | "md" | "lg";
  /** Extra classes (e.g. hover color overrides). */
  className?: string;
}

/**
 * τοσοδούλικο brand logo — the official horizontal lockup (hedgehog + wordmark
 * + subtext) from /public/brand/logo.svg. Rendered via CSS masking so the
 * single-color SVG takes the brand terracotta accent, always matching the
 * theme. The SVG's intrinsic ratio is 558.54 : 101.03 (≈ 5.528), preserved
 * per size.
 */
const LOGO_RATIO = 558.53564 / 101.03297;
const HEIGHTS: Record<NonNullable<BrandLogoProps["size"]>, number> = {
  sm: 38,
  md: 52,
  lg: 70,
};

export default function BrandLogo({ size = "md", className = "" }: BrandLogoProps) {
  const height = HEIGHTS[size];
  const width = Math.round(height * LOGO_RATIO);

  return (
    <span
      role="img"
      aria-label={brand.name}
      className={`block bg-terracotta transition-colors duration-300 ${className}`}
      style={{
        width,
        height,
        WebkitMaskImage: "url(/brand/logo.svg)",
        maskImage: "url(/brand/logo.svg)",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
