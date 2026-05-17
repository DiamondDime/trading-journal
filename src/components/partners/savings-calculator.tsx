"use client";

/**
 * SavingsCalculator — small interactive panel below the partner grid.
 *
 * Formula:
 *   annualSavings = monthlyVolume × makerFee × averageRebatePct × 12
 *
 * `averageRebatePct` is computed on the server (mean of `rebatePct` across
 * referral-eligible exchanges with a non-null value) and passed in as a
 * prop so this component stays a thin display layer.
 *
 * The result is the page's amber moment — `text-signature` on the big
 * number — so the rest of the page (counter, honesty card, partner cards)
 * deliberately stays neutral. Per the project's "one signature accent per
 * page" rule.
 *
 * Volume slider is **linear** (1k → 1M) with snap-to-marker behavior at
 * 10k / 50k / 100k / 500k / 1M. Log scale was tempting but small linear
 * adjustments inside common ranges (10-100k) read more naturally with the
 * current marker spacing. The fee input is constrained to 0.0001-0.005
 * which covers the realistic maker-fee range (0.01% to 0.5%).
 */

import * as React from "react";
import { useT } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/types";

interface Props {
  /** Average rebate fraction across referral exchanges (0-1). */
  averageRebateFraction: number;
  locale: Locale;
}

const MIN_VOLUME = 1_000;
const MAX_VOLUME = 1_000_000;
const DEFAULT_VOLUME = 50_000;
const DEFAULT_FEE_BPS = 4; // 0.04% maker fee — a common venue default.

const MARKERS = [10_000, 50_000, 100_000, 500_000, 1_000_000] as const;

export function SavingsCalculator({ averageRebateFraction, locale }: Props) {
  const t = useT();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";

  const [volume, setVolume] = React.useState<number>(DEFAULT_VOLUME);
  const [feeBps, setFeeBps] = React.useState<number>(DEFAULT_FEE_BPS);

  // bps → fraction. 4 bps = 0.0004 = 0.04%.
  const feeFraction = feeBps / 10_000;
  const annualSavings = volume * feeFraction * averageRebateFraction * 12;

  const currency = React.useMemo(
    () =>
      new Intl.NumberFormat(intlLocale, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }),
    [intlLocale],
  );

  const volumeLabel = React.useMemo(
    () =>
      new Intl.NumberFormat(intlLocale, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(volume),
    [intlLocale, volume],
  );

  return (
    <section
      aria-labelledby="savings-calculator-heading"
      className="rounded-md border border-border bg-surface"
    >
      <header className="border-b border-border-subtle px-6 py-4">
        <h2
          id="savings-calculator-heading"
          className="font-serif text-[18px] font-medium leading-tight text-text"
        >
          {t("partners.calculator.title")}
        </h2>
        <p className="mt-1 font-serif text-[13px] italic text-text-secondary">
          {t("partners.calculator.caption")}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 px-6 py-6 lg:grid-cols-[1.5fr_1fr] lg:gap-10">
        {/* ── inputs ───────────────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Volume slider */}
          <div>
            <div className="flex items-baseline justify-between">
              <label
                htmlFor="calc-volume"
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary"
              >
                {t("partners.calculator.monthlyVolume")}
              </label>
              <span className="font-mono text-[13px] tabular-nums text-text">
                {volumeLabel}
              </span>
            </div>
            <input
              id="calc-volume"
              type="range"
              min={MIN_VOLUME}
              max={MAX_VOLUME}
              step={1_000}
              value={volume}
              onChange={(e) => setVolume(Number(e.currentTarget.value))}
              className="mt-3 h-1 w-full cursor-pointer appearance-none rounded-full bg-subtle accent-text"
              aria-valuemin={MIN_VOLUME}
              aria-valuemax={MAX_VOLUME}
              aria-valuenow={volume}
            />
            <div className="mt-2 flex justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
              {MARKERS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setVolume(m)}
                  className="hover:text-text"
                >
                  {formatCompact(m, intlLocale)}
                </button>
              ))}
            </div>
          </div>

          {/* Fee input */}
          <div>
            <div className="flex items-baseline justify-between">
              <label
                htmlFor="calc-fee"
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary"
              >
                {t("partners.calculator.feeAssumption")}
              </label>
              <span className="font-mono text-[13px] tabular-nums text-text">
                {(feeBps / 100).toFixed(2)}%
              </span>
            </div>
            <input
              id="calc-fee"
              type="range"
              min={1}
              max={50}
              step={1}
              value={feeBps}
              onChange={(e) => setFeeBps(Number(e.currentTarget.value))}
              className="mt-3 h-1 w-full cursor-pointer appearance-none rounded-full bg-subtle accent-text"
              aria-valuemin={1}
              aria-valuemax={50}
              aria-valuenow={feeBps}
            />
            <p className="mt-2 font-serif text-[11.5px] italic text-text-tertiary">
              {t("partners.calculator.hint")}
            </p>
          </div>
        </div>

        {/* ── result ───────────────────────────────────────────────────── */}
        <div className="flex flex-col justify-center border-t border-border-subtle pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {t("partners.calculator.annualRebate")}
          </p>
          <p className="mt-2 font-mono text-[44px] font-medium leading-none tabular-nums tracking-tight text-signature">
            {currency.format(Math.max(0, Math.round(annualSavings)))}
          </p>
          <p className="mt-3 font-serif text-[11.5px] italic leading-snug text-text-tertiary">
            {t("partners.calculator.formula")}
          </p>
        </div>
      </div>
    </section>
  );
}

/** "10k", "50k", "100k", "500k", "1M" — keeps marker labels narrow. */
function formatCompact(n: number, intlLocale: string): string {
  return new Intl.NumberFormat(intlLocale, {
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(n);
}
