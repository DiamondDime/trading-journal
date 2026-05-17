"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  HEATMAP_WINDOWS,
  type HeatmapWindow,
} from "@/lib/dashboard/filters";
import { cn } from "@/lib/utils";

/**
 * 13w / 26w / 52w toggle for the calendar heatmap. Persists the choice in
 * URL search params so reloads + dashboard exports preserve it.
 *
 * Server component reads the resolved window once, passes it to <CalendarHeatmap>.
 * This control writes back via router.push so the server re-renders with the
 * new window (and a wider getDailyPnl query).
 */

interface Props {
  current: HeatmapWindow;
}

const LABELS: Record<HeatmapWindow, string> = {
  "13w": "13 weeks",
  "26w": "26 weeks",
  "52w": "52 weeks",
};

export function HeatmapWindowToggle({ current }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setWindow(w: HeatmapWindow) {
    const sp = new URLSearchParams(searchParams.toString());
    if (w === "13w") sp.delete("heatmap");
    else sp.set("heatmap", w);
    const qs = sp.toString();
    router.push(qs ? `/spreads?${qs}` : "/spreads", { scroll: false });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Heatmap window length"
      className="flex items-center gap-1 rounded-md border border-border bg-surface p-0.5"
    >
      {HEATMAP_WINDOWS.map((w) => {
        const active = current === w;
        return (
          <button
            key={w}
            role="radio"
            aria-checked={active}
            type="button"
            onClick={() => setWindow(w)}
            className={cn(
              "rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
              active
                ? "bg-text text-app"
                : "text-text-tertiary hover:text-text",
            )}
          >
            {LABELS[w]}
          </button>
        );
      })}
    </div>
  );
}
