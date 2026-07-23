interface HedgehogLogoProps {
  className?: string;
}

/**
 * τοσοδούλικο brand mascot — a hand-drawn sleeping baby hedgehog, rendered
 * as inline SVG line-art. Ported from the reference design; colours are
 * driven by the warm brand palette (terracotta strokes, stone-taupe base).
 */
export default function HedgehogLogo({ className = "w-12 h-12" }: HedgehogLogoProps) {
  return (
    <svg
      className={`${className} text-stone-taupe fill-none stroke-current`}
      viewBox="0 0 160 110"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="τοσοδούλικο"
    >
      <g
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-terracotta/90"
      >
        {/* Sleeping eye */}
        <path d="M103 54 C105.5 56.5 109 56.5 111.5 54" strokeWidth="2" />
        {/* Happy closed smile */}
        <path d="M112.5 61 C111 62.5 108.5 62.5 107.5 61" strokeWidth="1.8" />
        {/* Nose tip */}
        <circle cx="123" cy="56" r="2.2" className="fill-terracotta stroke-none" />
        {/* Snout outline */}
        <path d="M101.5 48 C105 48 111.5 50.5 119.5 53.5 C121 54 122 55 123 56 C121 57.5 116 60.5 109.5 60.5 C101.5 60.5 98 62.5 93 62 C88 61.5 84 62.5 81.5 62.5" />
        {/* Forefoot */}
        <path d="M86 63 C85 66.5 88 66.5 89.5 63" />
        {/* Backfoot */}
        <path d="M72 63 C71 66.5 74 66.5 75.5 63" />
        {/* Bedding baseline */}
        <path d="M68 62.5 C68.5 63 70 63 71.5 63 M76 63 C78.5 63 82.5 63 85.5 63 M90 63 C91.5 63 92.5 62.8 93.5 62.5" strokeWidth="1.5" />
        {/* Spines — row 1 (outer) */}
        <path d="M49 53 C45 49 46 43 51 40" />
        <path d="M53.5 40.5 C49 36 51 30 56.5 28.5" />
        <path d="M60 29.5 C56.5 24.5 60 18.5 66 18.5" />
        <path d="M69.5 21 C67.5 15.5 73.5 11 79 13.5" />
        <path d="M83.5 16 C83.5 10 90.5 8.5 94.5 13" />
        <path d="M98 21.5 C99.5 16 106.5 17 107 22.5" />
        <path d="M106.5 31.5 C110.5 27 115.5 31 113.5 36.5" />
        {/* Spines — row 2 (core) */}
        <path d="M57 51 C54 46 56 42.5 61 40.5" />
        <path d="M64 41 C60.5 36 64 31.5 69.5 31.5" />
        <path d="M72.5 31 C70.5 25 76 20.5 81.5 22.5" />
        <path d="M85 24.5 C84 18.5 90 16 93.5 20.5" />
        <path d="M96.5 28.5 C97 22.5 103 22 103.5 27.5" />
        <path d="M102 38.5 C104.5 34 109.5 36 107 41.5" />
        {/* Spines — row 3 */}
        <path d="M66 52 C64 47.5 67.5 44 71.5 43.5" />
        <path d="M74.5 43 C72.5 37.5 78 33.5 82.5 35" />
        <path d="M86 35 C85.5 29 91.5 27.5 94 32.5" />
        <path d="M96 36 C96.5 31 101.5 31 101.5 36.5" />
        <path d="M97.5 45 C99.5 41 103.5 43 101 47.5" />
        {/* Spines — row 4 (lower) */}
        <path d="M75 51.5 C74 47.5 79 44.5 82 46.5" />
        <path d="M85 46.5 C85 41.5 90 40 91.5 44.5" />
        <path d="M92.5 47 C93.5 42 97.5 42.5 96.5 47" />
        {/* Tail curve */}
        <path d="M49 53 C49 57 51.5 58.5 54 59.5 C57.5 61 62 61 65 61" strokeWidth="1.8" />
      </g>
    </svg>
  );
}
