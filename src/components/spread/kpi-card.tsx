import { cn } from "@/lib/utils";

type KpiCardProps = {
  label: string;
  value: string;
  delta?: string;
  /** "hero" variant uses serif + signature amber. Use it exactly ONCE per screen. */
  variant?: "default" | "hero";
  /** Sign-color the value: "up" green, "down" red, default text color. */
  tone?: "up" | "down" | "neutral";
};

/**
 * Hero font-size tiers. The hero KPI spans **2 columns** in the dashboard's
 * 6-column KPI grid (the page widens that row to 7 grid units to make room),
 * so the hero gets ~2× the width of a peer card — ~260-300px of content area
 * at the 1280px breakpoint, ~440-500px at 1920px. JetBrains Mono digit width
 * is ~58% of font-size, so a digit at N-px font runs ~0.58 × N pixels wide.
 *
 *   content_px / (chars × 0.58) ≈ floor for the max font.
 *
 * At 1280px (content ~260px):
 *   5 chars  → 90 → cap 56  ("$0.00")
 *   7 chars  → 64 → cap 48  ("+$1,234")
 *   10 chars → 45 → cap 36  ("+$1,234.56")
 *   13 chars → 35 → cap 30  ("+$123,456.78")
 *   15 chars → 30 → cap 26  ("+$12,345,678.90")
 *
 * Each tier uses `clamp()` so the number breathes between mobile and
 * desktop. Min stops at ~20px (still clearly the hero); max stops at 56px
 * so a 5-char "$0.00" doesn't bloat past the card's vertical rhythm.
 *
 * Hero stays font-mono (not serif) so comma + minus + dollar widths are
 * predictable — tabular-nums alone won't keep a serif from kerning apart.
 * Hero's distinguishing trait is amber text + tracking-tight + the 2-col
 * footprint, not display-typeface flourish.
 */
export function heroFontSize(value: string): string {
  const len = value.length;
  if (len <= 5) return "clamp(36px, 4.6vw, 56px)";
  if (len <= 7) return "clamp(32px, 4vw, 48px)";
  if (len <= 10) return "clamp(26px, 3.2vw, 36px)";
  if (len <= 13) return "clamp(22px, 2.6vw, 30px)";
  return "clamp(20px, 2.2vw, 26px)";
}

/**
 * Default-variant font tiers. Non-hero cards live in 1 grid column so their
 * content area is roughly half of the hero's — ~78px at 1280px, ~200px at
 * 1920px. JetBrains Mono digit width ≈ 0.58 × font-size, so 78px ÷
 * (chars × 0.58) gives the max font size that fits without overflow.
 *
 * At 1280px (content ~78px):
 *   5 chars  → 26  ("92.3%", "65")
 *   7 chars  → 19  ("+$1,234")
 *   10 chars → 13  ("+$1,234.56")
 *   13 chars → 10  ("+$123,456.78")
 *   15 chars → 9   ("+$12,345,678.90")
 *
 * The clamp upper bound is what 1280px hits; vw lets wider viewports grow
 * the font up to a sensible ceiling. Floor at 11px keeps the smallest case
 * still legible.
 */
export function defaultFontSize(value: string): string {
  const len = value.length;
  if (len <= 5) return "clamp(20px, 2vw, 26px)";
  if (len <= 7) return "clamp(15px, 1.4vw, 22px)";
  if (len <= 9) return "clamp(12px, 1.1vw, 18px)";
  if (len <= 11) return "clamp(11px, 0.9vw, 16px)";
  return "clamp(10px, 0.8vw, 14px)";
}

export function KpiCard({
  label,
  value,
  delta,
  variant = "default",
  tone = "neutral",
}: KpiCardProps) {
  const isHero = variant === "hero";

  const toneClass =
    tone === "up"
      ? "text-up"
      : tone === "down"
      ? "text-down"
      : isHero
      ? "text-signature"
      : "text-text";

  // Hero values get `font-mono` (not the prior serif) so that comma + minus +
  // dollar widths are predictable. `tabular-nums` alone isn't enough — serif
  // proportional glyphs would still kern apart. The hero is the most visible
  // number on the dashboard; predictable layout > display-typeface flourish.
  //
  // The hero card spans 2 grid columns at lg+ so that long values like
  // "+$1,234,567.89" fit cleanly. The dashboard's top KPI row uses
  // lg:grid-cols-7 to make the math work: 1 hero (2 cols) + 5 peers = 7.
  // At md (3 cols) and below, the hero falls back to 1 unit; the value
  // tier already shrinks to keep that case readable.
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-surface px-5 py-4 transition-colors hover:border-border-strong",
        isHero && "lg:col-span-2",
      )}
    >
      <p className="font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
        {label}
      </p>
      <p
        className={cn(
          "mt-2 tabular-nums leading-none font-mono font-medium",
          isHero && "tracking-tight",
          toneClass
        )}
        style={{
          fontSize: isHero ? heroFontSize(value) : defaultFontSize(value),
        }}
      >
        {value}
      </p>
      {delta && (
        <p className="mt-2 font-mono text-[11px] tracking-wide text-text-tertiary">
          {delta}
        </p>
      )}
    </div>
  );
}
