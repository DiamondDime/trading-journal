import { cn } from "@/lib/utils";

/**
 * 3-column grid of edge-quantification metrics — what the trader sees on the
 * track-record page to feel their system's quality. Each card has a label, a
 * mono numeral value, a tone (up/down/neutral), and a one-line italic-serif
 * explanation so the metric is self-evident without a glossary.
 *
 * Server component — pure presentation.
 */

export interface SystemMetric {
  label: string;
  value: string;
  /** Italic-serif body caption (one line). */
  caption: string;
  /** Optional supporting line below the caption (mono, tertiary). */
  delta?: string;
  tone?: "up" | "down" | "neutral";
}

interface Props {
  metrics: SystemMetric[];
}

export function SystemMetricsGrid({ metrics }: Props) {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
      {metrics.map((m) => {
        const toneClass =
          m.tone === "up"
            ? "text-up"
            : m.tone === "down"
            ? "text-down"
            : "text-text";
        return (
          <div
            key={m.label}
            className="flex flex-col gap-2 bg-surface px-5 py-5"
          >
            <p className="font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {m.label}
            </p>
            <p
              className={cn(
                "font-mono text-[26px] font-medium leading-none tabular-nums tracking-tight",
                toneClass,
              )}
            >
              {m.value}
            </p>
            <p className="font-serif text-[12px] italic leading-snug text-text-tertiary">
              {m.caption}
            </p>
            {m.delta && (
              <p className="font-mono text-[10px] tracking-wide text-text-tertiary">
                {m.delta}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
