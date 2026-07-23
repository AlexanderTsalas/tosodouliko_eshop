/**
 * TikTok glyph — lucide-react ships no brand icon for TikTok, so this is a
 * minimal single-colour SVG that inherits the surrounding text color
 * (fill: currentColor) just like the lucide social icons next to it.
 */
export default function TikTokIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16.5 3c.36 2.13 1.62 3.63 3.75 3.9v2.55c-1.3.05-2.55-.33-3.75-1.02v5.67c0 3.3-2.7 6-6 6s-6-2.7-6-6 2.7-6 6-6c.3 0 .6.02.9.07v2.64c-.29-.09-.59-.16-.9-.16-1.65 0-3 1.35-3 3s1.35 3 3 3 3-1.35 3-3V3h3z" />
    </svg>
  );
}
