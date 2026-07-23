"use client";

interface Props {
  min: number;
  max: number;
  step?: number;
  /** Current low / high thumb values. */
  lo: number;
  hi: number;
  /** Suffix shown on the value labels (e.g. "€"). */
  unit?: string;
  onChange: (lo: number, hi: number) => void;
}

/**
 * Dual-thumb range slider used by the catalog filters for price + age. Built
 * from two overlaid native range inputs (the inputs are pointer-events:none
 * and only their thumbs are interactive — see `.range-thumb` in globals.css),
 * with a coloured fill marking the selected span. No external dependency.
 */
export default function RangeSlider({
  min,
  max,
  step = 1,
  lo,
  hi,
  unit = "",
  onChange,
}: Props) {
  const clampLo = Math.min(Math.max(lo, min), hi);
  const clampHi = Math.max(Math.min(hi, max), lo);
  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  return (
    <div>
      <div className="relative h-5 flex items-center">
        {/* Base track */}
        <div className="absolute inset-x-0 h-1 rounded-full bg-stone-taupe/30" />
        {/* Selected span */}
        <div
          className="absolute h-1 rounded-full bg-terracotta"
          style={{ left: `${pct(clampLo)}%`, right: `${100 - pct(clampHi)}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={clampLo}
          onChange={(e) => onChange(Math.min(Number(e.target.value), clampHi), clampHi)}
          aria-label="Ελάχιστο"
          className="range-thumb absolute inset-x-0 w-full"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={clampHi}
          onChange={(e) => onChange(clampLo, Math.max(Number(e.target.value), clampLo))}
          aria-label="Μέγιστο"
          className="range-thumb absolute inset-x-0 w-full"
        />
      </div>
      <div className="flex justify-between text-xs text-ink/70 mt-1.5 tabular-nums font-medium">
        <span>
          {clampLo}
          {unit}
        </span>
        <span>
          {clampHi}
          {unit}
          {clampHi >= max ? "+" : ""}
        </span>
      </div>
    </div>
  );
}
