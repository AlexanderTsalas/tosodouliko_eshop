/**
 * Renders a single-color SVG (transparent background, one fill) as an icon via
 * CSS masking, so it inherits the surrounding text color — `bg-current` means
 * the icon takes the parent's `text-*` color and any hover transition for free.
 * Used for the custom account / cart / wishlist icons in /public/icons_svgs.
 */
export default function MaskIcon({
  src,
  className = "",
}: {
  src: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-hidden="true"
      className={`inline-block bg-current ${className}`}
      style={{
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
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
