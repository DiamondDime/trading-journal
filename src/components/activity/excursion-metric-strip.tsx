import { BackfillButton } from "./backfill-button";
import type { ExcursionRow } from "@/lib/db/satellite";

interface ExcursionMetricStripProps {
  activityId: string;
  /** The activity's excursion row, or null when no backfill has run yet. */
  excursion: ExcursionRow | null;
  /**
   * Average loss across the user's book of closed activities (positive
   * number; see computeMoreMetrics in src/lib/analytics/metrics.ts). Used
   * as the R-unit baseline for MFE-R / MAE-R / Realized-R.
   *
   * Pass 0 when the user has no losing trades yet — we degrade to "—" in
   * that case so we don't divide by zero.
   */
  avgLossUsd: number;
  /** Entry price for the position, as a decimal string. */
  entryPrice: string;
  /** Trade direction. Excursion math flips sign for shorts. */
  side: "long" | "short";
  /**
   * Net realized PnL for this activity in USD. Becomes the "Realized R"
   * number when divided by the R unit.
   */
  netPnlUsd: number;
  /** Position size in base units, as a decimal string. Required to convert
   *  price-space excursions (USD per unit) into total-USD excursions before
   *  dividing by avgLossUsd. */
  qty: string;
}

/**
 * Server component — renders the 3-up MFE-R / MAE-R / Realized-R metric
 * row below the hero on a trade or spread detail page.
 *
 * MFE-R math (long position):
 *   priceMove = mfePrice - entryPrice         (positive when favorable)
 *   dollarMove = priceMove * qty              (total favorable $ at the peak)
 *   mfeR = dollarMove / avgLossUsd            (in units of an average loss)
 *
 * For a short, the favorable direction is inverted:
 *   priceMove = entryPrice - mfePrice
 *
 * MAE-R is the same in reverse using `maePrice`. The sign convention:
 *   MFE-R is positive (best favorable move ≥ 0 by definition).
 *   MAE-R is negative or zero (worst adverse move ≤ 0).
 *
 * Realized-R is netPnlUsd / avgLossUsd. Sign mirrors the trade result.
 *
 * When avgLossUsd is 0 (no losses yet across the book) or the excursion
 * row's mfe/mae prices are null, the corresponding cell shows "—".
 *
 * When the excursion row is entirely null (no backfill has ever run), we
 * render the empty-state with a backfill trigger.
 */
export function ExcursionMetricStrip({
  activityId,
  excursion,
  avgLossUsd,
  entryPrice,
  side,
  netPnlUsd,
  qty,
}: ExcursionMetricStripProps) {
  // Empty state — no excursion row at all. Show the inline backfill CTA.
  if (excursion === null) {
    return (
      <section className="mt-14">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Excursion · R-units
            </h2>
            <p className="mt-1 font-serif text-[12px] italic text-text-tertiary">
              Best/worst price moves while the trade was open, in units of an
              average loss.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-col items-start gap-3 rounded-md border border-dashed border-border bg-inset px-4 py-5">
          <p className="font-mono text-[11px] text-text-tertiary">
            No excursion data yet
          </p>
          <BackfillButton activityId={activityId} />
        </div>
      </section>
    );
  }

  const entry = Number(entryPrice);
  const qtyN = Number(qty);
  const usableQty = Number.isFinite(qtyN) && qtyN > 0 ? qtyN : null;
  const usableEntry = Number.isFinite(entry) && entry > 0 ? entry : null;
  const rUnit = avgLossUsd > 0 ? avgLossUsd : null;

  /**
   * Convert an excursion price to a signed R-value.
   *
   *   dollarMove = (price - entry) * qty                  for long
   *              = (entry - price) * qty                  for short
   *   R          = dollarMove / avgLossUsd
   *
   * For MFE-R the input is mfePrice and the result is ≥ 0 (the most
   * favorable move can't be adverse, by definition of MFE).
   *
   * For MAE-R the input is maePrice and the result is ≤ 0 (worst adverse
   * move). Note we sign the R-value in the *favorable* direction; the
   * negative comes out naturally because the price moved against the
   * trade's direction.
   */
  function priceToR(priceStr: string | null): number | null {
    if (priceStr === null || usableEntry === null || usableQty === null || rUnit === null) {
      return null;
    }
    const price = Number(priceStr);
    if (!Number.isFinite(price)) return null;
    const direction = side === "long" ? 1 : -1;
    const dollarMove = (price - usableEntry) * direction * usableQty;
    return dollarMove / rUnit;
  }

  const mfeRValue = priceToR(excursion.mfePrice);
  const maeRValue = priceToR(excursion.maePrice);
  const realizedRValue = rUnit !== null ? netPnlUsd / rUnit : null;

  const mfeR = formatR(mfeRValue);
  const maeR = formatR(maeRValue);
  const realizedR = formatR(realizedRValue);

  return (
    <section className="mt-14">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            Excursion · R-units
          </h2>
          <p className="mt-1 font-serif text-[12px] italic text-text-tertiary">
            Best/worst price moves while the trade was open, in units of an
            average loss.
          </p>
        </div>
        {excursion.source === "kline_backfill" && excursion.backfilledAt && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            Backfilled{" "}
            {new Date(excursion.backfilledAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCell
          label="MFE-R"
          value={mfeR.label}
          tone={mfeR.tone}
          caption="Best favorable move in R-units"
        />
        <MetricCell
          label="MAE-R"
          value={maeR.label}
          tone={maeR.tone}
          caption="Worst adverse move in R-units"
        />
        <MetricCell
          label="Realized R"
          value={realizedR.label}
          tone={realizedR.tone}
          caption="What you actually banked"
        />
      </div>
      {rUnit === null && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          R-units unavailable — need at least one losing closed activity for the
          baseline.
        </p>
      )}
    </section>
  );
}

function MetricCell({
  label,
  value,
  tone,
  caption,
}: {
  label: string;
  value: string;
  tone: "up" | "down" | "neutral";
  caption: string;
}) {
  const toneClass =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text";
  return (
    <div className="rounded-md border border-border bg-surface px-5 py-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
        {label}
      </p>
      <p className={`mt-2 font-mono text-[28px] font-medium leading-none tabular-nums ${toneClass}`}>
        {value}
      </p>
      <p className="mt-2 font-serif text-[11px] italic leading-tight text-text-tertiary">
        {caption}
      </p>
    </div>
  );
}

function formatR(r: number | null): { label: string; tone: "up" | "down" | "neutral" } {
  if (r === null || !Number.isFinite(r)) return { label: "—", tone: "neutral" };
  const sign = r >= 0 ? "+" : "−";
  const tone: "up" | "down" | "neutral" =
    r > 0 ? "up" : r < 0 ? "down" : "neutral";
  return { label: `${sign}${Math.abs(r).toFixed(1)}R`, tone };
}
