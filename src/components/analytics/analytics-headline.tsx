import { cn } from "@/lib/utils";

/**
 * The "one signature amber moment" per analytics page — used at the top of
 * every page in the /analytics/* suite. Serif label, mono numeral in
 * `--accent-signature`, italic serif subtitle below.
 *
 * Each page renders exactly one of these. Sub-section headings stay in
 * neutral text/tertiary tones so the amber stays visually unique.
 */

interface AnalyticsHeadlineProps {
  label: string;
  value: string;
  subtitle?: string;
  /** Override the default amber tone for cases like the regime page where
   *  the headline value itself isn't a dollar number (e.g. "82%"). */
  tone?: "signature" | "up" | "down";
}

/**
 * Length-aware font tiers. Mirrors KpiCard.heroFontSize but tuned for the
 * page-level hero which has the entire column width to work with, not just
 * the 2-col card. We push the upper bound to ~92px so a "$1,234,567" reads
 * as the centerpiece on a 1440px viewport.
 */
function headlineFontSize(value: string): string {
  const len = value.length;
  if (len <= 5) return "clamp(56px, 8vw, 92px)";
  if (len <= 7) return "clamp(48px, 6.4vw, 78px)";
  if (len <= 10) return "clamp(40px, 5.2vw, 64px)";
  if (len <= 13) return "clamp(32px, 4vw, 54px)";
  return "clamp(28px, 3.4vw, 44px)";
}

export function AnalyticsHeadline({
  label,
  value,
  subtitle,
  tone = "signature",
}: AnalyticsHeadlineProps) {
  const toneClass =
    tone === "up"
      ? "text-up"
      : tone === "down"
      ? "text-down"
      : "text-signature";

  return (
    <div className="flex flex-col gap-2">
      <p className="font-serif text-[11px] font-semibold uppercase tracking-[0.22em] text-text-tertiary">
        {label}
      </p>
      <p
        className={cn(
          "font-mono font-medium leading-[0.95] tabular-nums tracking-tight",
          toneClass,
        )}
        style={{ fontSize: headlineFontSize(value) }}
      >
        {value}
      </p>
      {subtitle && (
        <p className="font-serif text-[14px] italic leading-snug text-text-tertiary">
          {subtitle}
        </p>
      )}
    </div>
  );
}
