import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardSummaryRow } from "@/components/wizard/wizard-summary-row";
import { WizardErrorBanner } from "@/components/wizard/wizard-error-banner";
import { WizardCardPreview } from "@/components/wizard/wizard-card-preview";
import { WizardSubmitButton } from "@/components/wizard/wizard-submit-button";
import {
  OptionPayoffChart,
  deriveOptionMetrics,
  type PayoffChartLegInput,
} from "@/components/activity/option-payoff-chart";
import { getT } from "@/lib/i18n/server";
import type { ActivityStatus } from "@/types/canonical";
import { logOption } from "../actions";

export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

const SCALAR_FIELDS = [
  "subtype",
  "spread_style",
  "underlying",
  "exchange",
  "iv_at_open",
  "entry_thesis",
  "exit_plan",
  "target_price",
  "stop_price",
  "max_loss_usd",
  "max_profit_usd",
  "expected_holding_days",
  "target_iv_change_bps",
  "opened_at",
  "name",
  "regime_tags",
  "custom_tags",
  "strategy_tag",
  "tax_taxable",
  "tax_jurisdiction",
  "status",
  "edit",
] as const;

const LEG_FIELDS = [
  "leg_index",
  "exchange",
  "underlying",
  "expiry",
  "strike",
  "option_kind",
  "side",
  "contracts",
  "premium_per_contract",
  "iv",
  "delta",
  "gamma",
  "theta",
  "vega",
  "rho",
] as const;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return fallback;
}

function parseNum(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmtUsd(n: number, signed = false): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}$${abs}`;
}

function fmtNumber(n: number, fraction = 4): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: fraction });
}

function fmtDate(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface ExtractedLeg {
  leg_index: number;
  exchange: string;
  underlying: string;
  expiry: string;
  strike: string;
  option_kind: string;
  side: string;
  contracts: string;
  premium_per_contract: string;
  iv: string;
  delta: string;
  gamma: string;
  theta: string;
  vega: string;
  rho: string;
}

/**
 * Rebuild the legs array from URLSearchParams. The form upstream emits
 * `legs[i].field` keys; we group by index and pull each named field.
 */
function extractLegsFromSearch(sp: Awaited<Search>): ExtractedLeg[] {
  const PATH_RE = /^legs\[(\d+)\]\.(.+)$/;
  const buckets = new Map<number, Record<string, string>>();
  for (const [k, v] of Object.entries(sp)) {
    const m = k.match(PATH_RE);
    if (!m) continue;
    const i = Number(m[1]);
    const field = m[2];
    const value = Array.isArray(v) ? v[0] : v;
    if (typeof value !== "string") continue;
    let bucket = buckets.get(i);
    if (!bucket) {
      bucket = {};
      buckets.set(i, bucket);
    }
    bucket[field] = value;
  }
  const indices = Array.from(buckets.keys()).sort((a, b) => a - b);
  return indices.map<ExtractedLeg>((i) => {
    const b = buckets.get(i) ?? {};
    return {
      leg_index: i,
      exchange: b.exchange ?? "",
      underlying: b.underlying ?? "",
      expiry: b.expiry ?? "",
      strike: b.strike ?? "",
      option_kind: b.option_kind ?? "call",
      side: b.side ?? "long",
      contracts: b.contracts ?? "",
      premium_per_contract: b.premium_per_contract ?? "",
      iv: b.iv ?? "",
      delta: b.delta ?? "",
      gamma: b.gamma ?? "",
      theta: b.theta ?? "",
      vega: b.vega ?? "",
      rho: b.rho ?? "",
    };
  });
}

/**
 * Option wizard step 5 — Review.
 *
 * Hero: net premium (signed, signature amber via tone). Below the hero,
 * computed max profit / max loss / breakeven points and a server-rendered
 * SVG payoff chart. Greeks summary aggregates per-leg deltas/gammas/etc.
 * Card preview matches the v_activity_feed-style card the user will see
 * on /spreads/archive after submit.
 */
export default async function OptionReviewPage(props: {
  searchParams: Search;
}) {
  const t = await getT();
  const STEP_LABELS = [
    t("wizard.option.stepLabels.source"),
    t("wizard.option.stepLabels.kind"),
    t("wizard.option.stepLabels.legs"),
    t("wizard.option.stepLabels.fields"),
    t("wizard.option.stepLabels.review"),
  ] as const;

  const sp = await props.searchParams;
  const legs = extractLegsFromSearch(sp);
  const subtype = getStr(sp, "subtype", "single_leg");
  const isSpread = subtype === "option_spread";
  const spreadStyle = getStr(sp, "spread_style");
  const underlying = getStr(sp, "underlying") || "—";
  const exchange = getStr(sp, "exchange") || "—";
  const isEditing = getStr(sp, "edit") !== "";
  const errorMsg = getStr(sp, "error");

  // Build the payoff-chart inputs as f64s for math + display.
  const chartLegs: PayoffChartLegInput[] = legs.map((l) => ({
    optionKind: (l.option_kind === "put" ? "put" : "call") as "call" | "put",
    side: (l.side === "short" ? "short" : "long") as "long" | "short",
    strike: parseNum(l.strike),
    contracts: parseNum(l.contracts),
    premiumPerContract: parseNum(l.premium_per_contract),
  }));

  const metrics = deriveOptionMetrics(chartLegs);
  // Trader-typed wins over derived (the schema allows trader override).
  const maxProfitTyped = sp.max_profit_usd ? parseNum(getStr(sp, "max_profit_usd")) : null;
  const maxLossTyped = sp.max_loss_usd ? parseNum(getStr(sp, "max_loss_usd")) : null;
  const maxProfit = maxProfitTyped ?? metrics.maxProfitUsd;
  const maxLoss = maxLossTyped ?? metrics.maxLossUsd;

  // Sum greeks across legs, signed by long/short.
  function sumLegMetric(field: keyof ExtractedLeg): number {
    let s = 0;
    for (const leg of legs) {
      const v = parseNum(String(leg[field]));
      const contracts = parseNum(leg.contracts);
      const sign = leg.side === "long" ? 1 : -1;
      s += sign * v * contracts;
    }
    return s;
  }
  const totalDelta = sumLegMetric("delta");
  const totalGamma = sumLegMetric("gamma");
  const totalTheta = sumLegMetric("theta");
  const totalVega = sumLegMetric("vega");

  // Status derivation mirrors db.ts: closed > unwinding > all-expired > open.
  const statusInput = getStr(sp, "status", "open");
  // Date.now is pure-at-request-time inside this async Server Component —
  // the value is captured once before any JSX is emitted, so the React
  // purity rule's "unstable result on re-render" concern doesn't apply.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const allExpired =
    legs.length > 0 &&
    legs.every((l) => {
      const t = new Date(l.expiry).getTime();
      return Number.isFinite(t) && t < now;
    });
  const status: ActivityStatus =
    statusInput === "closed" || statusInput === "unwinding"
      ? (statusInput as ActivityStatus)
      : allExpired
      ? "expired"
      : "open";

  // Earliest expiry → DTE on card.
  const earliestExpiryIso =
    legs.length > 0
      ? legs
          .map((l) => l.expiry)
          .filter(Boolean)
          .sort()[0] ?? null
      : null;
  const dte = earliestExpiryIso
    ? Math.ceil(
        // Reuse the request-scoped `now` captured above (pure within request).
        (new Date(earliestExpiryIso).getTime() - now) / 86_400_000,
      )
    : null;

  // Display name: explicit > derived underlying + style.
  const displayName =
    getStr(sp, "name") ||
    (underlying !== "—"
      ? `${underlying.toUpperCase()} ${
          isSpread && spreadStyle ? spreadStyle.replace(/_/g, " ") : "single leg"
        }`
      : "—");

  // Edit-all link rebuilds the back-nav URL with every scalar + leg field.
  const editParams = new URLSearchParams();
  for (const k of SCALAR_FIELDS) {
    const v = getStr(sp, k);
    if (v) editParams.set(k, v);
  }
  for (const leg of legs) {
    for (const f of LEG_FIELDS) {
      const val = String(leg[f]);
      if (val !== "") editParams.append(`legs[${leg.leg_index}].${f}`, val);
    }
  }
  const editAllHref = `/add/option/fields?${editParams.toString()}`;

  return (
    <WizardShell
      type="option"
      step={5}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={
        isEditing
          ? t("wizard.option.review.titleEdit")
          : t("wizard.option.review.title")
      }
      subtitle={
        isEditing
          ? t("wizard.option.review.subtitleEdit")
          : t("wizard.option.review.subtitle")
      }
    >
      <WizardErrorBanner error={errorMsg || undefined} />

      {/* ── Hero: net premium ──────────────────────────────────────── */}
      <section className="border-y border-border py-10">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {t("wizard.option.review.heroCaption")}
          </p>
          <div className="flex items-baseline gap-3">
            <span
              className="font-serif font-normal leading-none text-signature"
              style={{ fontSize: "clamp(48px, 7vw, 72px)" }}
            >
              {fmtUsd(metrics.netPremiumUsd, true)}
            </span>
            <span className="font-serif text-xl font-normal text-text-tertiary">
              {metrics.netPremiumUsd >= 0
                ? t("wizard.option.review.heroDebit")
                : t("wizard.option.review.heroCredit")}
            </span>
          </div>
          <p className="mt-2 font-mono text-[13px] text-text-secondary">
            {underlying.toUpperCase()} ·{" "}
            {isSpread && spreadStyle
              ? spreadStyle.replace(/_/g, " ")
              : t("wizard.option.review.singleLegLabel")}
            {" · "}
            {t("wizard.option.review.legCount", { count: legs.length })}
            {dte !== null && (
              <>
                {" · "}
                <span
                  className={
                    dte <= 7 && dte >= 0 ? "text-warn" : "text-text-tertiary"
                  }
                >
                  {dte < 0
                    ? t("wizard.option.review.expired")
                    : t("wizard.option.review.dteValue", { dte })}
                </span>
              </>
            )}
          </p>
        </div>
      </section>

      {/* ── Computed metrics panel ─────────────────────────────────── */}
      <section className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-2">
        <div>
          <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            {t("wizard.option.review.sections.metrics")}
          </h2>
          <WizardSummaryRow
            label={t("wizard.option.review.rows.maxProfit")}
            value={
              maxProfit === null ? t("wizard.option.review.unbounded") : fmtUsd(maxProfit)
            }
            tone="up"
          />
          <WizardSummaryRow
            label={t("wizard.option.review.rows.maxLoss")}
            value={
              maxLoss === null ? t("wizard.option.review.unbounded") : fmtUsd(maxLoss)
            }
            tone="down"
          />
          <WizardSummaryRow
            label={t("wizard.option.review.rows.breakevens")}
            value={
              metrics.breakevens.length > 0
                ? metrics.breakevens.map((b) => fmtNumber(b, 2)).join(" / ")
                : "—"
            }
          />
          <WizardSummaryRow
            label={t("wizard.option.review.rows.netPremium")}
            value={fmtUsd(metrics.netPremiumUsd, true)}
            tone={metrics.netPremiumUsd >= 0 ? "down" : "up"}
          />
        </div>
        <div>
          <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            {t("wizard.option.review.sections.greeks")}
          </h2>
          <WizardSummaryRow
            label={t("wizard.option.review.rows.delta")}
            value={fmtNumber(totalDelta, 3)}
          />
          <WizardSummaryRow
            label={t("wizard.option.review.rows.gamma")}
            value={fmtNumber(totalGamma, 4)}
          />
          <WizardSummaryRow
            label={t("wizard.option.review.rows.theta")}
            value={fmtNumber(totalTheta, 2)}
          />
          <WizardSummaryRow
            label={t("wizard.option.review.rows.vega")}
            value={fmtNumber(totalVega, 2)}
          />
        </div>
      </section>

      {/* ── Payoff chart ──────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-3 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.option.review.sections.payoff")}
        </h2>
        <div className="rounded-md border border-border bg-surface p-4">
          <OptionPayoffChart legs={chartLegs} variant="full" height={220} />
        </div>
      </section>

      {/* ── Legs table ────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-3 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.option.review.sections.legs")}
        </h2>
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border-subtle text-left font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">{t("wizard.option.review.legColumns.exchange")}</th>
                <th className="px-3 py-2">{t("wizard.option.review.legColumns.expiry")}</th>
                <th className="px-3 py-2 text-right">
                  {t("wizard.option.review.legColumns.strike")}
                </th>
                <th className="px-3 py-2">{t("wizard.option.review.legColumns.kind")}</th>
                <th className="px-3 py-2">{t("wizard.option.review.legColumns.side")}</th>
                <th className="px-3 py-2 text-right">
                  {t("wizard.option.review.legColumns.contracts")}
                </th>
                <th className="px-3 py-2 text-right">
                  {t("wizard.option.review.legColumns.premium")}
                </th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {legs.map((leg) => (
                <tr
                  key={leg.leg_index}
                  className="border-b border-border-subtle last:border-b-0"
                >
                  <td className="px-3 py-2 text-text-tertiary">{leg.leg_index + 1}</td>
                  <td className="px-3 py-2">{leg.exchange}</td>
                  <td className="px-3 py-2">{fmtDate(leg.expiry)}</td>
                  <td className="px-3 py-2 text-right">
                    {fmtNumber(parseNum(leg.strike), 2)}
                  </td>
                  <td className="px-3 py-2 uppercase">{leg.option_kind}</td>
                  <td
                    className={
                      "px-3 py-2 uppercase " +
                      (leg.side === "long" ? "text-up" : "text-down")
                    }
                  >
                    {leg.side}
                  </td>
                  <td className="px-3 py-2 text-right">{leg.contracts}</td>
                  <td className="px-3 py-2 text-right">
                    {fmtNumber(parseNum(leg.premium_per_contract), 2)}
                  </td>
                </tr>
              ))}
              {legs.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-6 text-center text-text-tertiary"
                  >
                    {t("wizard.option.review.noLegs")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Header / intent summary ───────────────────────────────── */}
      <section className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-2">
        <div>
          <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            {t("wizard.option.review.sections.header")}
          </h2>
          <WizardSummaryRow
            label={t("wizard.option.review.rows.subtype")}
            value={isSpread ? t("wizard.option.kinds.optionSpread.title") : t("wizard.option.kinds.singleLeg.title")}
            editHref={editAllHref}
          />
          {isSpread && (
            <WizardSummaryRow
              label={t("wizard.option.review.rows.spreadStyle")}
              value={spreadStyle ? spreadStyle.replace(/_/g, " ") : "—"}
              editHref={editAllHref}
            />
          )}
          <WizardSummaryRow
            label={t("wizard.option.review.rows.underlying")}
            value={underlying || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.option.review.rows.exchange")}
            value={exchange}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.option.review.rows.openedAt")}
            value={fmtDate(getStr(sp, "opened_at"))}
            editHref={editAllHref}
          />
        </div>
        <div>
          <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            {t("wizard.option.review.sections.intent")}
          </h2>
          <WizardSummaryRow
            label={t("wizard.option.review.rows.targetPrice")}
            value={getStr(sp, "target_price") ? fmtNumber(parseNum(getStr(sp, "target_price")), 2) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.option.review.rows.stopPrice")}
            value={getStr(sp, "stop_price") ? fmtNumber(parseNum(getStr(sp, "stop_price")), 2) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.option.review.rows.ivAtOpen")}
            value={getStr(sp, "iv_at_open") || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.option.review.rows.expectedHoldingDays")}
            value={getStr(sp, "expected_holding_days") || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.option.review.rows.exitPlan")}
            value={getStr(sp, "exit_plan") || "—"}
            mono={false}
            editHref={editAllHref}
          />
        </div>
      </section>

      {/* ── Card preview + status ─────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-3 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.option.review.sections.cardPreview")}
        </h2>
        <WizardCardPreview
          activityType="option"
          name={displayName}
          status={status}
          subtype={{
            optionRealizedPnl: 0,
            optionMaxProfit: maxProfit ?? null,
            symbol: underlying,
            subtitle:
              isSpread && spreadStyle
                ? `Option · ${spreadStyle.replace(/_/g, " ")}`
                : "Option · single_leg",
          }}
        />
      </section>

      {/* ── Submit form ───────────────────────────────────────────── */}
      <form action={logOption} className="mt-10">
        {/* Forward every scalar field. */}
        {SCALAR_FIELDS.map((k) => (
          <input key={k} type="hidden" name={k} value={getStr(sp, k)} />
        ))}
        {/* Forward every leg field, namespaced. */}
        {legs.map((leg) =>
          LEG_FIELDS.map((f) => (
            <input
              key={`legs[${leg.leg_index}].${f}`}
              type="hidden"
              name={`legs[${leg.leg_index}].${f}`}
              value={String(leg[f])}
            />
          )),
        )}

        <div className="flex items-center justify-between border-t border-border pt-6">
          <Link
            href={editAllHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("wizard.option.review.back")}
          </Link>
          <WizardSubmitButton>
            {isEditing
              ? t("wizard.option.review.saveChanges")
              : t("wizard.option.review.logOption")}
          </WizardSubmitButton>
        </div>
      </form>
    </WizardShell>
  );
}
