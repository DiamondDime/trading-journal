"use client";

/**
 * OhlcChart — candlestick price action for a closed trade or spread.
 *
 * Renders the kline window fetched from
 * `/api/activities/[id]/klines` using TradingView's `lightweight-charts`
 * (Apache 2.0). The component never renders during SSR — the canvas-backed
 * lightweight-charts library requires `window` / `document`. Loading is
 * client-only via `useEffect`, deferring the bundle until the section
 * mounts on the user's screen.
 *
 * Visual contract (matches the editorial design language):
 *   - green up-candles / red down-candles via `--accent-up` / `--accent-down`
 *   - background `--bg-surface`, grid `--border-subtle` at low opacity
 *   - entry / exit shown as dashed horizontal price-lines plus circle markers
 *   - MAE / MFE shown as arrow markers ("+X.XR" labels suppressed for v1 —
 *     the metric strip below already surfaces the R values)
 *   - 320 px tall on desktop, full-width
 *
 * State machine:
 *   1. mount → loading skeleton
 *   2. fetch ok with bars → mount chart
 *   3. fetch ok with no bars → empty state (italic-serif: "Price history not
 *      available for this symbol on this venue.")
 *   4. fetch 404/UNSUPPORTED → empty state, same copy
 *   5. fetch other error → terse error state
 *
 * Don't optimize the chart away: the page server-renders quickly enough that
 * a client-side fetch for the bars feels instant, and avoiding SSR for
 * lightweight-charts is a hard requirement.
 */

import { useEffect, useRef, useState } from "react";

import { useT } from "@/lib/i18n/client";

// Type-only imports keep the bundle SSR-safe (the runtime import is dynamic
// inside the effect). The types are tree-shaken away in production builds.
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  UTCTimestamp,
  SeriesMarker,
} from "lightweight-charts";

interface ApiBar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ApiPoint {
  ts: number;
  price: number;
}

interface KlinePayload {
  interval: "1m" | "5m" | "15m" | "1h";
  symbol: string;
  exchange: string;
  bars: ApiBar[];
  entry: ApiPoint | null;
  exit: ApiPoint | null;
  mae: ApiPoint | null;
  mfe: ApiPoint | null;
}

interface OhlcChartProps {
  activityId: string;
}

export function OhlcChart({ activityId }: OhlcChartProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "empty"; reason: "unsupported" | "no_data" }
    | { kind: "error"; message: string }
    | { kind: "ok"; payload: KlinePayload }
  >({ kind: "loading" });

  // ── Fetch ────────────────────────────────────────────────────────────
  // Deliberate setState-in-effect: async fetch lifecycle drives state, not
  // pure derivation.
  useEffect(() => {
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ kind: "loading" });

    (async () => {
      try {
        const res = await fetch(`/api/activities/${activityId}/klines`, {
          signal: ac.signal,
          headers: { Accept: "application/json" },
        });
        if (res.status === 404) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: { code?: string };
          };
          const reason = body?.error?.code === "UNSUPPORTED" ? "unsupported" : "no_data";
          if (!ac.signal.aborted) setState({ kind: "empty", reason });
          return;
        }
        if (!res.ok) {
          if (!ac.signal.aborted) {
            setState({
              kind: "error",
              message: t("activity.ohlc.reasons.serverHttp", { status: res.status }),
            });
          }
          return;
        }
        const json = (await res.json()) as { data?: KlinePayload };
        const payload = json.data;
        if (!payload) {
          if (!ac.signal.aborted) {
            setState({ kind: "error", message: t("activity.ohlc.reasons.malformed") });
          }
          return;
        }
        if (payload.bars.length === 0) {
          if (!ac.signal.aborted) setState({ kind: "empty", reason: "no_data" });
          return;
        }
        if (!ac.signal.aborted) setState({ kind: "ok", payload });
      } catch (err) {
        if (ac.signal.aborted) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : t("activity.ohlc.reasons.network"),
        });
      }
    })();

    return () => ac.abort();
  }, [activityId, t]);

  // ── Chart mount / unmount + theme reactivity ─────────────────────────
  useEffect(() => {
    if (state.kind !== "ok" || !containerRef.current) return;

    let disposed = false;
    let resizeObs: ResizeObserver | null = null;
    let darkObs: MutationObserver | null = null;

    void (async () => {
      // Dynamic import keeps the ~50 KB lightweight-charts bundle out of
      // every page chunk — only loaded once a detail page actually shows
      // a chart.
      const lwc = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;

      const isDark = isDarkMode();
      const chart = lwc.createChart(containerRef.current, buildChartOptions(isDark));
      const series = chart.addSeries(lwc.CandlestickSeries, buildSeriesOptions(isDark));

      const bars: CandlestickData<UTCTimestamp>[] = state.payload.bars.map((b) => ({
        time: Math.floor(b.ts / 1000) as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
      series.setData(bars);

      // ── Markers (entry / exit / MAE / MFE) ────────────────────────────
      const markers = buildMarkers(state.payload, {
        entry: t("activity.ohlc.markers.entry"),
        exit: t("activity.ohlc.markers.exit"),
        mfe: t("activity.ohlc.markers.mfe"),
        mae: t("activity.ohlc.markers.mae"),
      });
      if (markers.length > 0) {
        lwc.createSeriesMarkers(series, markers);
      }

      // ── Horizontal price lines for entry + exit ──────────────────────
      if (state.payload.entry !== null) {
        series.createPriceLine({
          price: state.payload.entry.price,
          color: cssVar("--text-tertiary", "#6b7280"),
          lineWidth: 1,
          lineStyle: lwc.LineStyle.Dashed,
          axisLabelVisible: true,
          title: t("activity.ohlc.priceLines.entry"),
        });
      }
      if (state.payload.exit !== null) {
        series.createPriceLine({
          price: state.payload.exit.price,
          color: cssVar("--text-tertiary", "#6b7280"),
          lineWidth: 1,
          lineStyle: lwc.LineStyle.Dotted,
          axisLabelVisible: true,
          title: t("activity.ohlc.priceLines.exit"),
        });
      }

      chart.timeScale().fitContent();

      chartRef.current = chart;
      seriesRef.current = series;

      // Resize observer — chart needs explicit size updates because it's
      // canvas-backed and doesn't listen for container resize itself.
      resizeObs = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          chart.applyOptions({ width, height });
        }
      });
      resizeObs.observe(containerRef.current);

      // Theme switch reactivity — listen for the .dark class toggle on
      // <html> (next-themes pattern used elsewhere in this repo) and re-apply
      // colors without rebuilding the chart.
      darkObs = new MutationObserver(() => {
        const dark = isDarkMode();
        chart.applyOptions(buildChartOptions(dark));
        series.applyOptions(buildSeriesOptions(dark));
      });
      darkObs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-theme"],
      });
    })();

    return () => {
      disposed = true;
      if (resizeObs) resizeObs.disconnect();
      if (darkObs) darkObs.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      seriesRef.current = null;
    };
    // We intentionally rebuild the chart when the payload changes —
    // lightweight-charts mutates the canvas, so React reconciliation alone
    // doesn't apply data updates. JSON-stringify keeps the dep cheap to
    // compare across renders. `t` is included so a locale switch re-builds
    // the chart with localized marker/price-line labels.
  }, [state, t]);

  // ── Render ───────────────────────────────────────────────────────────
  if (state.kind === "loading") {
    return (
      <div
        aria-busy="true"
        className="h-[320px] w-full animate-pulse rounded-md border border-border bg-surface"
      />
    );
  }

  if (state.kind === "empty") {
    return (
      <div className="flex h-[160px] w-full items-center justify-center rounded-md border border-dashed border-border bg-surface">
        <p className="font-serif text-sm italic text-text-tertiary">{t("activity.ohlc.empty")}</p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex h-[160px] w-full items-center justify-center rounded-md border border-dashed border-border bg-surface px-6 text-center">
        <p className="font-serif text-sm italic text-text-tertiary">
          {t("activity.ohlc.error", { message: state.message })}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <div
        ref={containerRef}
        className="h-[320px] w-full"
        // role/aria-label so a screen reader still announces what this is
        // even though the canvas content itself is opaque to AT.
        role="img"
        aria-label={t("activity.ohlc.aria", {
          symbol: state.payload.symbol,
          exchange: state.payload.exchange,
          interval: state.payload.interval,
        })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MarkerLabels {
  entry: string;
  exit: string;
  mfe: string;
  mae: string;
}

function buildMarkers(
  payload: KlinePayload,
  labels: MarkerLabels,
): SeriesMarker<UTCTimestamp>[] {
  const markers: SeriesMarker<UTCTimestamp>[] = [];

  if (payload.entry !== null) {
    markers.push({
      time: Math.floor(payload.entry.ts / 1000) as UTCTimestamp,
      position: "belowBar",
      color: cssVar("--accent-up", "#16a34a"),
      shape: "circle",
      text: labels.entry,
      size: 1,
    });
  }
  if (payload.exit !== null) {
    markers.push({
      time: Math.floor(payload.exit.ts / 1000) as UTCTimestamp,
      position: "aboveBar",
      color: cssVar("--text-tertiary", "#6b7280"),
      shape: "circle",
      text: labels.exit,
      size: 1,
    });
  }
  if (payload.mfe !== null) {
    // Triangle pointing toward the favorable side. We use the
    // exchange-token "up" hue because MFE is the best price ever reached
    // in the trade's favor; for shorts the same arrow color still reads as
    // "the optimum exit" semantically.
    markers.push({
      time: Math.floor(payload.mfe.ts / 1000) as UTCTimestamp,
      position: "aboveBar",
      color: cssVar("--accent-up", "#16a34a"),
      shape: "arrowDown",
      text: labels.mfe,
      size: 1,
    });
  }
  if (payload.mae !== null) {
    markers.push({
      time: Math.floor(payload.mae.ts / 1000) as UTCTimestamp,
      position: "belowBar",
      color: cssVar("--accent-down", "#dc2626"),
      shape: "arrowUp",
      text: labels.mae,
      size: 1,
    });
  }
  // Sort by time — lightweight-charts requires markers in ascending order
  // and silently drops out-of-order entries.
  markers.sort((a, b) => Number(a.time) - Number(b.time));
  return markers;
}

function buildChartOptions(isDark: boolean) {
  return {
    layout: {
      background: { color: cssVar("--bg-surface", isDark ? "#161b22" : "#ffffff") },
      textColor: cssVar("--text-tertiary", isDark ? "#8b949e" : "#6b7280"),
      fontFamily:
        "var(--font-jetbrains), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 11,
      attributionLogo: false,
    },
    rightPriceScale: {
      borderColor: cssVar("--border-color", isDark ? "#30363d" : "#e5e7eb"),
      scaleMargins: { top: 0.1, bottom: 0.1 },
    },
    timeScale: {
      borderColor: cssVar("--border-color", isDark ? "#30363d" : "#e5e7eb"),
      timeVisible: true,
      secondsVisible: false,
    },
    grid: {
      vertLines: { color: cssVar("--border-subtle", isDark ? "#21262d" : "#f0f2f5") },
      horzLines: { color: cssVar("--border-subtle", isDark ? "#21262d" : "#f0f2f5") },
    },
    crosshair: {
      mode: 1, // CrosshairMode.Normal — magnet to nearest data point feels janky
      vertLine: { color: cssVar("--border-strong", isDark ? "#484f58" : "#d1d5db") },
      horzLine: { color: cssVar("--border-strong", isDark ? "#484f58" : "#d1d5db") },
    },
    handleScroll: false,
    handleScale: false,
    autoSize: false,
  };
}

function buildSeriesOptions(isDark: boolean) {
  const up = cssVar("--accent-up", isDark ? "#3fb950" : "#16a34a");
  const down = cssVar("--accent-down", isDark ? "#f85149" : "#dc2626");
  return {
    upColor: up,
    downColor: down,
    borderUpColor: up,
    borderDownColor: down,
    wickUpColor: up,
    wickDownColor: down,
    borderVisible: true,
    wickVisible: true,
  };
}

/**
 * Read a CSS custom property off the document root with a static fallback.
 * SSR-safe — fall back to the literal when window is undefined.
 */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function isDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}
