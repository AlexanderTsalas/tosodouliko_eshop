"use client";

import { useState, useTransition } from "react";
import { toggleWishlist } from "@/actions/wishlist/toggleWishlist";
import { redirectToSignupIfNotPermanent } from "@/lib/auth/requirePermanentAccount";
import MaskIcon from "@/components/layout/MaskIcon";

/**
 * Compact wishlist heart for catalog/related cards. Reuses the existing
 * toggleWishlist server action (+ the permanent-account signup gate) — no new
 * business logic. Because the catalog grid is cached, the heart starts
 * unfilled and reflects state optimistically after the user taps it (matching
 * the reference card's simple heart). Lives as a sibling of the card's link
 * (not nested inside the anchor) and stops propagation so a tap toggles the
 * wishlist instead of navigating.
 */
export default function WishlistHeartButton({
  productId,
  variantId,
  className = "",
  variant = "overlay",
  label,
}: {
  productId: string;
  variantId?: string;
  className?: string;
  /** "overlay" = round chip over a card image; "bordered" = inline square
   *  button (e.g. next to the PDP add-to-cart); "icon" = large circular dark
   *  action button with a hover-revealed label (PDP, right of the price). */
  variant?: "overlay" | "bordered" | "icon";
  /** Optional text. For "icon" it's revealed below the circle on hover; for
   *  other variants it renders inline next to the heart. */
  label?: string;
}) {
  const [inList, setInList] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      const ok = await redirectToSignupIfNotPermanent();
      if (!ok) return;
      const r = await toggleWishlist({ productId, variantId });
      if (r.success) setInList(r.data.added);
    });
  }

  // Circular dark action button (PDP). Light (canvas) icon on a dark circle;
  // turns terracotta once added. The label fades in below on hover, absolutely
  // positioned so it never shifts the layout.
  if (variant === "icon") {
    return (
      <div className="group icon-wiggle-group relative flex flex-col items-center">
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending}
          aria-pressed={inList}
          aria-label={label ?? (inList ? "Αφαίρεση από τη λίστα επιθυμιών" : "Προσθήκη στη λίστα επιθυμιών")}
          className={`flex items-center justify-center w-14 h-14 rounded-full text-canvas transition-colors disabled:opacity-60 ${
            inList ? "bg-terracotta" : "bg-[#6b4f37] hover:bg-terracotta"
          }`}
        >
          <MaskIcon src="/icons_svgs/wishlist.svg" className="icon-wiggle w-10 h-10" />
        </button>
        {label && (
          <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-medium text-ink opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            {label}
          </span>
        )}
      </div>
    );
  }

  const base =
    variant === "bordered"
      ? "" // PDP: bare icon, no square border around it
      : "p-2 rounded-full bg-canvas/90 hover:bg-canvas shadow-[0_2px_10px_rgba(43,36,32,0.3)]";
  const color = inList ? "text-terracotta" : "text-[#8a6d49] hover:text-terracotta";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={inList}
      aria-label={inList ? "Αφαίρεση από τη λίστα επιθυμιών" : "Προσθήκη στη λίστα επιθυμιών"}
      className={`icon-wiggle-group inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 ${color} ${base} ${className}`}
    >
      <MaskIcon
        src="/icons_svgs/wishlist.svg"
        className={`icon-wiggle ${label ? "w-7 h-7" : "w-10 h-10"}`}
      />
      {label && <span>{label}</span>}
    </button>
  );
}
