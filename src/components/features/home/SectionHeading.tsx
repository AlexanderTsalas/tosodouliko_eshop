/**
 * Centered section heading used across the home page — mono eyebrow, serif
 * title, terracotta underline. Matches the reference's section-header rhythm.
 */
export default function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  /** Optional line shown below the title (above the gradient rule). */
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center max-w-xl mx-auto mb-12">
      <span className="text-[10px] tracking-widest font-mono text-stone-taupe uppercase font-bold mb-1">
        {eyebrow}
      </span>
      <h2 className="font-serif text-3xl sm:text-4xl text-ink font-bold tracking-tight">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-2 text-sm sm:text-base text-ink/70 font-serif italic">
          {subtitle}
        </p>
      )}
      <span className="w-28 h-0.5 bg-gradient-to-r from-transparent via-terracotta to-transparent mt-3" />
    </div>
  );
}
