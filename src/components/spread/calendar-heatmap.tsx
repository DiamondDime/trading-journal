"use client";

import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// 91 days of daily net PnL — May 16 looking back to Feb 14.
// 0 = no trades (mostly weekends).
// Values chosen to be plausible: most days small, occasional big spike,
// some negative dips, with a visible "thesis broke" cluster around mid-period.
// 13 weeks × 7 days = 91 cells. Stored Sun→Sat by row.
const SERIES: number[] = [
  // week 1
   0,   0,   0,  18,  -4,  31,   0,
  // week 2
   0,  12,  46,   0,  29,  -8,   0,
  // week 3
   0,  22,   0,  61, 184,  17,   0,
  // week 4
   0,  35,  19,  44,   0,  -3,   0,
  // week 5
   0,  -8, -22, -41, -12,   8,   0,
  // week 6
   0,   3,  21,   0,  54,  72,   0,
  // week 7
   0,  44,  61,  29,  88, 127,   0,
  // week 8
   0,  18, -14,  32,  41,  56,   0,
  // week 9
   0,  22,  11,  -6,  73,  29,   0,
  // week 10
   0,  41, 102,  18,  -9,  47,   0,
  // week 11
   0,  16,  38,  61,  44,  19,   0,
  // week 12
   0,  88,  52,  44,  31,  -3,   0,
  // week 13
   0,  61,  78,   0,  29,  41,   0,
];

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
// 13 weeks ending 2026-05-16 → starts Sunday 2026-02-15
const START = new Date(2026, 1, 15); // Feb 15, 2026 (Sun)

function cellColor(v: number, maxAbs: number): string {
  if (v === 0) return "bg-subtle";
  const i = Math.min(1, Math.abs(v) / maxAbs);
  if (v > 0) {
    if (i > 0.75) return "bg-up";
    if (i > 0.5) return "bg-up/80";
    if (i > 0.25) return "bg-up/55";
    return "bg-up/30";
  } else {
    if (i > 0.75) return "bg-down";
    if (i > 0.5) return "bg-down/80";
    if (i > 0.25) return "bg-down/55";
    return "bg-down/30";
  }
}

function fmtDate(idx: number) {
  const d = new Date(START);
  d.setDate(d.getDate() + idx);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtAmount(v: number) {
  if (v === 0) return "no trades";
  const sign = v > 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

// Month labels — show month name above the first week that contains that month's day 1
function monthLabels(): { label: string; weekIdx: number }[] {
  const labels: { label: string; weekIdx: number }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < 13; w++) {
    const d = new Date(START);
    d.setDate(d.getDate() + w * 7);
    if (d.getMonth() !== lastMonth) {
      labels.push({
        label: d.toLocaleDateString("en-US", { month: "short" }),
        weekIdx: w,
      });
      lastMonth = d.getMonth();
    }
  }
  return labels;
}

export function CalendarHeatmap() {
  const maxAbs = React.useMemo(
    () => Math.max(...SERIES.map((v) => Math.abs(v))),
    []
  );
  const labels = React.useMemo(monthLabels, []);

  // Reshape series into columns = weeks, rows = days-of-week
  const weeks: number[][] = [];
  for (let w = 0; w < 13; w++) {
    weeks.push(SERIES.slice(w * 7, w * 7 + 7));
  }

  return (
    <div className="flex flex-col gap-2">
      {/* month labels row */}
      <div className="relative h-4 pl-7">
        {labels.map((m) => (
          <span
            key={`${m.label}-${m.weekIdx}`}
            className="absolute font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
            style={{ left: `calc(${m.weekIdx} * 18px + 1px)` }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        {/* day-of-week labels */}
        <div className="flex flex-col gap-[3px] pt-[1px]">
          {DAY_LABELS.map((d, i) => (
            <span
              key={i}
              className={cn(
                "h-[15px] w-3 text-center font-mono text-[10px] text-text-tertiary leading-[15px]",
                i % 2 === 1 ? "opacity-100" : "opacity-0"
              )}
            >
              {d}
            </span>
          ))}
        </div>

        {/* grid */}
        <div className="flex gap-[3px]">
          {weeks.map((week, w) => (
            <div key={w} className="flex flex-col gap-[3px]">
              {week.map((v, d) => {
                const idx = w * 7 + d;
                return (
                  <Tooltip key={d}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "h-[15px] w-[15px] rounded-[3px] transition-transform hover:scale-125 hover:ring-1 hover:ring-text/40",
                          cellColor(v, maxAbs)
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="font-mono text-[11px]"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="text-text-tertiary">
                          {fmtDate(idx)}
                        </span>
                        <span
                          className={
                            v > 0
                              ? "text-up"
                              : v < 0
                              ? "text-down"
                              : "text-text-tertiary"
                          }
                        >
                          {fmtAmount(v)}
                        </span>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-1 flex items-center gap-3 pl-7 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        <span>Less</span>
        <div className="flex items-center gap-[3px]">
          <span className="h-[10px] w-[10px] rounded-[2px] bg-subtle" />
          <span className="h-[10px] w-[10px] rounded-[2px] bg-up/30" />
          <span className="h-[10px] w-[10px] rounded-[2px] bg-up/55" />
          <span className="h-[10px] w-[10px] rounded-[2px] bg-up/80" />
          <span className="h-[10px] w-[10px] rounded-[2px] bg-up" />
        </div>
        <span>More</span>
        <span className="ml-3">Loss</span>
        <div className="flex items-center gap-[3px]">
          <span className="h-[10px] w-[10px] rounded-[2px] bg-down/30" />
          <span className="h-[10px] w-[10px] rounded-[2px] bg-down/55" />
          <span className="h-[10px] w-[10px] rounded-[2px] bg-down/80" />
          <span className="h-[10px] w-[10px] rounded-[2px] bg-down" />
        </div>
      </div>
    </div>
  );
}

// Need cn locally to avoid client-server import chain issues with shadcn cn
function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
