import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardSummaryRow } from "@/components/wizard/wizard-summary-row";
import { WizardErrorBanner } from "@/components/wizard/wizard-error-banner";
import { logTrade } from "../actions";
import { getT } from "@/lib/i18n/server";

// Field names the form passes through. Stays in sync with /fields/page.tsx.
// `edit` is the UUID of an existing trade when this is an edit-mode submit;
// the server action dispatches to the update path when present.
const TRADE_FIELDS = [
  "exchange",
  "symbol",
  "instrument",
  "side",
  "capital",
  "qty",
  "entryPrice",
  "exitPrice",
  "fees",
  "openedAt",
  "closedAt",
  "note",
  "regimeTags",
  "source",
  "edit",
] as const;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(
  sp: Awaited<Search>,
  key: string,
  fallback = ""
): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

// ── Pure helpers ────────────────────────────────────────────────────────────

function fmtUsd(n: number, signed = false): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}$${abs}`;
}

function parseNum(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function daysBetween(openIso: string, closeIso: string): number {
  if (!openIso || !closeIso) return 0;
  const o = new Date(openIso).getTime();
  const c = new Date(closeIso).getTime();
  if (!Number.isFinite(o) || !Number.isFinite(c) || c <= o) return 0;
  return (c - o) / (1000 * 60 * 60 * 24);
}

function fmtDays(
  d: number,
  t: Awaited<ReturnType<typeof getT>>,
): string {
  if (d === 0) return "—";
  if (d < 1) {
    const hours = d * 24;
    if (hours < 1)
      return t("wizard.trade.review.duration.minutes", {
        value: Math.round(hours * 60),
      });
    return t("wizard.trade.review.duration.hours", {
      value: hours.toFixed(1),
    });
  }
  if (d < 30) return t("wizard.trade.review.duration.days", { value: d.toFixed(1) });
  return t("wizard.trade.review.duration.days", { value: d.toFixed(0) });
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Compute the realized P&L preview from form values. Mirrors the formula
 * the worker will use on the server side once persistence lands:
 *   gross   = qty × (exit − entry) × side_multiplier
 *   net     = gross − fees
 *   apr     = (net / capital) × (365 / days_held) × 100
 *
 * Returns `null` for any field that can't be derived.
 */
function computePreview(
  side: string,
  qty: number,
  entryPrice: number,
  exitPrice: number,
  capital: number,
  fees: number,
  daysHeld: number
): { gross: number; net: number; aprPct: number | null } {
  const dir = side === "short" ? -1 : 1;
  const gross = qty * (exitPrice - entryPrice) * dir;
  const net = gross - fees;
  const aprPct =
    capital > 0 && daysHeld > 0 ? (net / capital) * (365 / daysHeld) * 100 : null;
  return { gross, net, aprPct };
}

export default async function TradeReviewPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;

  const STEP_LABELS = [
    t("wizard.trade.stepLabels.source"),
    t("wizard.trade.stepLabels.pick"),
    t("wizard.trade.stepLabels.details"),
    t("wizard.trade.stepLabels.review"),
  ] as const;

  const v = {
    exchange: getStr(sp, "exchange"),
    symbol: getStr(sp, "symbol"),
    instrument: getStr(sp, "instrument"),
    side: getStr(sp, "side"),
    capital: getStr(sp, "capital"),
    qty: getStr(sp, "qty"),
    entryPrice: getStr(sp, "entryPrice"),
    exitPrice: getStr(sp, "exitPrice"),
    fees: getStr(sp, "fees", "0"),
    openedAt: getStr(sp, "openedAt"),
    closedAt: getStr(sp, "closedAt"),
    note: getStr(sp, "note"),
    regimeTags: getStr(sp, "regimeTags"),
    source: getStr(sp, "source"),
  };

  const capital = parseNum(v.capital);
  const qty = parseNum(v.qty);
  const entry = parseNum(v.entryPrice);
  const exit = parseNum(v.exitPrice);
  const fees = parseNum(v.fees);
  const days = daysBetween(v.openedAt, v.closedAt);

  const { gross, net, aprPct } = computePreview(
    v.side,
    qty,
    entry,
    exit,
    capital,
    fees,
    days
  );

  const editAllHref = `/add/trade/fields?${new URLSearchParams(
    Object.fromEntries(
      TRADE_FIELDS.map((k) => [k, getStr(sp, k)] as const).filter(
        ([, val]) => val !== ""
      )
    )
  ).toString()}`;
  const isEditing = getStr(sp, "edit") !== "";

  const headlineTone = net >= 0 ? "up" : "down";
  // Sign is "+" only for positive, "−" only for negative — zero gets no sign.
  const aprLabel =
    aprPct === null
      ? "—"
      : `${aprPct > 0 ? "+" : aprPct < 0 ? "−" : ""}${Math.abs(aprPct).toFixed(1)}%`;

  return (
    <WizardShell
      type="trade"
      step={4}
      totalSteps={4}
      stepLabels={STEP_LABELS}
      title={isEditing ? t("wizard.trade.review.titleEdit") : t("wizard.trade.review.titleCreate")}
      subtitle={
        isEditing
          ? t("wizard.trade.review.subtitleEdit")
          : t("wizard.trade.review.subtitleCreate")
      }
    >
      <WizardErrorBanner error={getStr(sp, "error") || undefined} />
      {/* ── Hero preview ─────────────────────────────────────────────── */}
      <section className="border-y border-border py-10">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {t("wizard.trade.review.heroCaption")}
          </p>
          <div className="flex items-baseline gap-3">
            <span
              className="font-serif font-normal leading-none text-signature"
              style={{ fontSize: "clamp(48px, 7vw, 72px)" }}
            >
              {aprLabel}
            </span>
            <span className="font-serif text-xl font-normal text-text-tertiary">
              {t("wizard.trade.review.heroUnit")}
            </span>
          </div>
          <p className="mt-2 font-mono text-[13px] text-text-secondary">
            {t("wizard.trade.review.netPrefix")}{" "}
            <span
              className={
                headlineTone === "up"
                  ? "text-up font-medium"
                  : "text-down font-medium"
              }
            >
              {fmtUsd(net, true)}
            </span>{" "}
            {t("wizard.trade.review.onCapital", { capital: fmtUsd(capital) })}
            {days > 0 && (
              <>
                {" · "}
                {t("wizard.trade.review.heldSuffix", { days: fmtDays(days, t) })}
              </>
            )}
          </p>
        </div>
      </section>

      {/* ── Field summary ─────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.trade.review.sections.trade")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.exchange")}
            value={v.exchange || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.symbol")}
            value={v.symbol || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.instrument")}
            value={v.instrument || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.side")}
            value={v.side || "—"}
            editHref={editAllHref}
            tone={v.side === "short" ? "down" : v.side === "long" ? "up" : "neutral"}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.trade.review.sections.numbers")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.capital")}
            value={capital > 0 ? fmtUsd(capital) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.qty")}
            value={qty > 0 ? qty.toLocaleString("en-US", { maximumSignificantDigits: 6 }) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.entryPrice")}
            value={entry > 0 ? fmtUsd(entry) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.exitPrice")}
            value={exit > 0 ? fmtUsd(exit) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.fees")}
            value={fees > 0 ? fmtUsd(fees) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.grossPnl")}
            value={fmtUsd(gross, true)}
            tone={gross >= 0 ? "up" : "down"}
          />
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.netPnl")}
            value={fmtUsd(net, true)}
            tone={net >= 0 ? "up" : "down"}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.trade.review.sections.timing")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.opened")}
            value={fmtDate(v.openedAt)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.closed")}
            value={fmtDate(v.closedAt)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.daysHeld")}
            value={days > 0 ? fmtDays(days, t) : "—"}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.trade.review.sections.thesisTags")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.regimeTags")}
            value={v.regimeTags || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.note")}
            value={v.note || "—"}
            editHref={editAllHref}
            mono={false}
          />
          {v.source && (
            <WizardSummaryRow
              label={t("wizard.trade.review.labels.source")}
              value={
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                  {t("wizard.trade.review.exchangeFill", { source: v.source })}
                </span>
              }
            />
          )}
        </div>
      </section>

      {/* ── Submit ────────────────────────────────────────────────────── */}
      <form action={logTrade} className="mt-10">
        {/* Replay every field through hidden inputs so the server action
            receives the full payload. */}
        {TRADE_FIELDS.map((k) => (
          <input
            key={k}
            type="hidden"
            name={k}
            value={getStr(sp, k)}
          />
        ))}

        <div className="flex items-center justify-between border-t border-border pt-6">
          <Link
            href={editAllHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("wizard.trade.review.back")}
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-5 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            {isEditing ? t("wizard.trade.review.saveChanges") : t("wizard.trade.review.logTrade")}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </form>
    </WizardShell>
  );
}
