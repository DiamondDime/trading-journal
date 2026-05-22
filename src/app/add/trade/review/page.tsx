import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardSummaryRow } from "@/components/wizard/wizard-summary-row";
import { WizardErrorBanner } from "@/components/wizard/wizard-error-banner";
import { WizardCardPreview } from "@/components/wizard/wizard-card-preview";
import { WizardSubmitButton } from "@/components/wizard/wizard-submit-button";
import { logTrade } from "../actions";
import { getT, getLocale } from "@/lib/i18n/server";
import type { ActivityStatus, TradeKind } from "@/types/canonical";
import { WizardTagInput } from "@/components/activity/wizard-tag-input";
import { listTagsForActivity } from "@/lib/db/satellite";
import { requireUser } from "@/lib/auth/server";
import {
  getStr,
  parseNum,
  parseTagsParam,
  fmtUsd as fmtUsdShared,
  fmtDateTime,
} from "@/app/add/_lib/review-helpers";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Field names the form passes through. Mirrors /fields/page.tsx hidden + named
// inputs. Order is irrelevant — these become hidden inputs on the submit form.
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
  "feesEntry",
  "feesExit",
  "openedAt",
  "closedAt",
  "regimeTags",
  "source",
  "edit",
  "positionId",
  "kind",
  "status",
  "leverage",
  "marginMode",
  "fundingPaidUsd",
  "fundingReceivedUsd",
  "borrowCostUsd",
  "targetPrice",
  "stopPrice",
  "exitPlan",
  "entryThesis",
  "exitNote",
  // OTC
  "counterparty",
  "settlementDate",
  "escrowMethod",
  "premiumOrDiscountBps",
  // NFT
  "collection",
  "tokenId",
  "marketplace",
  "royaltyPct",
  // Rollups
  "strategyTag",
] as const;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

// ── Pure helpers ────────────────────────────────────────────────────────────

function daysBetween(openIso: string, closeIso: string): number {
  if (!openIso || !closeIso) return 0;
  const o = new Date(openIso).getTime();
  const c = new Date(closeIso).getTime();
  if (!Number.isFinite(o) || !Number.isFinite(c) || c <= o) return 0;
  return (c - o) / (1000 * 60 * 60 * 24);
}

function fmtDays(d: number, t: Awaited<ReturnType<typeof getT>>): string {
  if (d === 0) return "—";
  if (d < 1) {
    const hours = d * 24;
    if (hours < 1) {
      return t("wizard.trade.review.duration.minutes", { value: Math.round(hours * 60) });
    }
    return t("wizard.trade.review.duration.hours", { value: hours.toFixed(1) });
  }
  if (d < 30) return t("wizard.trade.review.duration.days", { value: d.toFixed(1) });
  return t("wizard.trade.review.duration.days", { value: d.toFixed(0) });
}

function deriveTradeName(symbol: string, side: string, kind: string): string {
  const base = symbol.split(/[-/_]/)[0] || symbol;
  return `${base} ${side} · ${kind}`;
}

// NFT marketplace brand labels. These are proper nouns, not translatable
// copy — the fields-page <select> hardcodes the same display strings. `other`
// falls through to the i18n "other" string at the callsite.
const MARKETPLACE_LABELS: Record<string, string> = {
  opensea: "OpenSea",
  blur: "Blur",
  magic_eden: "Magic Eden",
  tensor: "Tensor",
};

/**
 * Realized P&L preview. Mirrors createTradeFromWizard's server-side formula
 * so the card preview matches what lands in the DB on submit.
 */
function computePreview(
  side: string,
  qty: number,
  entryPrice: number,
  exitPrice: number,
  capital: number,
  fees: number,
  daysHeld: number,
  isOpen: boolean,
): { gross: number; net: number; aprPct: number | null } {
  if (isOpen) return { gross: 0, net: 0, aprPct: null };
  const dir = side === "short" ? -1 : 1;
  const gross = qty * (exitPrice - entryPrice) * dir;
  const net = gross - fees;
  const aprPct =
    capital > 0 && daysHeld > 0 ? (net / capital) * (365 / daysHeld) * 100 : null;
  return { gross, net, aprPct };
}

const KIND_VALUES: readonly TradeKind[] = ["spot", "perp", "dated_future", "option", "otc", "nft"];
function isTradeKind(v: string): v is TradeKind {
  return (KIND_VALUES as readonly string[]).includes(v);
}

const STATUS_VALUES: readonly ActivityStatus[] = [
  "pending", "open", "winding_down", "unwinding", "orphaned",
  "vesting", "claimed", "liquidated", "expired", "closed",
];
function isActivityStatus(v: string): v is ActivityStatus {
  return (STATUS_VALUES as readonly string[]).includes(v);
}

export default async function TradeReviewPage(props: { searchParams: Search }) {
  const t = await getT();
  const locale = await getLocale();
  const intl = locale === "ru" ? "ru-RU" : "en-US";
  const fmtUsd = (n: number, signed = false) => fmtUsdShared(n, locale, signed);
  const fmtDate = (iso: string) => fmtDateTime(iso, locale);
  const sp = await props.searchParams;
  const { id: userId } = await requireUser();

  const STEP_LABELS = [
    t("wizard.trade.stepLabels.source"),
    t("wizard.trade.stepLabels.kind"),
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
    feesEntry: getStr(sp, "feesEntry"),
    feesExit: getStr(sp, "feesExit"),
    openedAt: getStr(sp, "openedAt"),
    closedAt: getStr(sp, "closedAt"),
    entryThesis: getStr(sp, "entryThesis"),
    exitPlan: getStr(sp, "exitPlan"),
    exitNote: getStr(sp, "exitNote"),
    regimeTags: getStr(sp, "regimeTags"),
    positionId: getStr(sp, "positionId"),
    status: getStr(sp, "status", "closed"),
    leverage: getStr(sp, "leverage"),
    marginMode: getStr(sp, "marginMode"),
    fundingPaidUsd: getStr(sp, "fundingPaidUsd"),
    fundingReceivedUsd: getStr(sp, "fundingReceivedUsd"),
    borrowCostUsd: getStr(sp, "borrowCostUsd"),
    targetPrice: getStr(sp, "targetPrice"),
    stopPrice: getStr(sp, "stopPrice"),
    counterparty: getStr(sp, "counterparty"),
    settlementDate: getStr(sp, "settlementDate"),
    escrowMethod: getStr(sp, "escrowMethod"),
    premiumOrDiscountBps: getStr(sp, "premiumOrDiscountBps"),
    collection: getStr(sp, "collection"),
    tokenId: getStr(sp, "tokenId"),
    marketplace: getStr(sp, "marketplace"),
    royaltyPct: getStr(sp, "royaltyPct"),
    strategyTag: getStr(sp, "strategyTag"),
  };

  const kindRaw = getStr(sp, "kind", "spot");
  const kind: TradeKind = isTradeKind(kindRaw) ? kindRaw : "spot";

  const status: ActivityStatus = isActivityStatus(v.status) ? v.status : "closed";
  const isOpen = status === "open";

  const capital = parseNum(v.capital);
  const qty = parseNum(v.qty);
  const entry = parseNum(v.entryPrice);
  const exit = parseNum(v.exitPrice);
  const feesEntry = parseNum(v.feesEntry);
  const feesExit = parseNum(v.feesExit);
  const feesTotal = feesEntry || feesExit ? feesEntry + feesExit : parseNum(v.fees);
  const days = isOpen ? 0 : daysBetween(v.openedAt, v.closedAt);

  const { gross, net, aprPct } = computePreview(
    v.side, qty, entry, exit, capital, feesTotal, days, isOpen,
  );

  const editAllHref = `/add/trade/fields?${new URLSearchParams(
    Object.fromEntries(
      TRADE_FIELDS.map((k) => [k, getStr(sp, k)] as const).filter(([, val]) => val !== ""),
    ),
  ).toString()}`;
  const editIdRaw = getStr(sp, "edit");
  const isEditing = editIdRaw !== "";

  // Free-form tags pre-fill: edit mode reads existing activity_tag rows; a
  // failed-submit round-trip rehydrates from the `tags` JSON query param.
  const defaultTags =
    isEditing && UUID_RE.test(editIdRaw)
      ? await listTagsForActivity(userId, editIdRaw)
      : parseTagsParam(getStr(sp, "tags"));

  const headlineTone: "up" | "down" | "neutral" = isOpen
    ? "neutral"
    : net > 0
      ? "up"
      : net < 0
        ? "down"
        : "neutral";
  const aprLabel =
    aprPct === null
      ? "—"
      : `${aprPct > 0 ? "+" : aprPct < 0 ? "−" : ""}${Math.abs(aprPct).toFixed(1)}%`;

  const tradeName = v.symbol ? deriveTradeName(v.symbol, v.side || "long", kind) : "";

  return (
    <WizardShell
      type="trade"
      step={5}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={isEditing ? t("wizard.trade.review.titleEdit") : t("wizard.trade.review.titleCreate")}
      subtitle={
        isEditing ? t("wizard.trade.review.subtitleEdit") : t("wizard.trade.review.subtitleCreate")
      }
    >
      <WizardErrorBanner error={getStr(sp, "error") || undefined} />

      {/* ── Card preview ──────────────────────────────────────────────── */}
      <section className="mt-2">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.trade.review.cardPreviewCaption")}
        </p>
        <WizardCardPreview
          activityType="trade"
          name={tradeName || t("wizard.trade.review.cardNamePlaceholder")}
          status={status}
          subtype={{
            capital,
            netPnl: isOpen ? null : net,
            daysHeld: days,
            symbol: v.symbol,
            subtitle: `${v.exchange || "—"} · ${kind}`,
            tradeKind: kind,
          }}
        />
      </section>

      {/* ── Hero preview ─────────────────────────────────────────────── */}
      <section className="mt-8 border-y border-border py-10">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {isOpen
              ? t("wizard.trade.review.heroCaptionOpen")
              : t("wizard.trade.review.heroCaption")}
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
          {!isOpen && (
            <p className="mt-2 font-mono text-[13px] text-text-secondary">
              {t("wizard.trade.review.netPrefix")}{" "}
              <span
                className={
                  headlineTone === "up"
                    ? "text-up font-medium"
                    : headlineTone === "down"
                      ? "text-down font-medium"
                      : "text-text font-medium"
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
          )}
        </div>
      </section>

      {/* ── Field summary ─────────────────────────────────────────────── */}
      <section className="mt-10">
        <SummaryHeading>{t("wizard.trade.review.sections.trade")}</SummaryHeading>
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.kind")}
          value={t(`tradeKind.${kind}` as const)}
          editHref={editAllHref}
        />
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.status")}
          value={t(`status.${status}` as const)}
          editHref={editAllHref}
        />
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
          value={
            v.instrument === "perp" ||
            v.instrument === "spot" ||
            v.instrument === "future"
              ? t(`wizard.trade.fields.instrument.${v.instrument}` as const)
              : v.instrument || "—"
          }
          editHref={editAllHref}
        />
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.side")}
          value={
            v.side === "long"
              ? t("side.long")
              : v.side === "short"
              ? t("side.short")
              : "—"
          }
          editHref={editAllHref}
          tone={v.side === "short" ? "down" : v.side === "long" ? "up" : "neutral"}
        />

        <SummaryHeading className="mt-8">
          {t("wizard.trade.review.sections.numbers")}
        </SummaryHeading>
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.capital")}
          value={capital > 0 ? fmtUsd(capital) : "—"}
          editHref={editAllHref}
        />
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.qty")}
          value={qty > 0 ? qty.toLocaleString(intl, { maximumSignificantDigits: 6 }) : "—"}
          editHref={editAllHref}
        />
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.entryPrice")}
          value={entry > 0 ? fmtUsd(entry) : "—"}
          editHref={editAllHref}
        />
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.exitPrice")}
          value={isOpen ? t("wizard.trade.review.openPlaceholder") : exit > 0 ? fmtUsd(exit) : "—"}
          editHref={editAllHref}
        />
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.feesEntry")}
          value={feesEntry > 0 ? fmtUsd(feesEntry) : "—"}
          editHref={editAllHref}
        />
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.feesExit")}
          value={feesExit > 0 ? fmtUsd(feesExit) : "—"}
          editHref={editAllHref}
        />
        {!isOpen && (
          <>
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
          </>
        )}

        <SummaryHeading className="mt-8">
          {t("wizard.trade.review.sections.intent")}
        </SummaryHeading>
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.targetPrice")}
          value={v.targetPrice ? fmtUsd(parseNum(v.targetPrice)) : "—"}
          editHref={editAllHref}
        />
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.stopPrice")}
          value={v.stopPrice ? fmtUsd(parseNum(v.stopPrice)) : "—"}
          editHref={editAllHref}
        />
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.exitPlan")}
          value={v.exitPlan || "—"}
          editHref={editAllHref}
          mono={false}
        />

        {kind === "perp" && (
          <>
            <SummaryHeading className="mt-8">
              {t("wizard.trade.review.sections.perp")}
            </SummaryHeading>
            <WizardSummaryRow
              label={t("wizard.trade.review.labels.leverage")}
              value={v.leverage ? `${parseNum(v.leverage).toFixed(2)}×` : "—"}
              editHref={editAllHref}
            />
            <WizardSummaryRow
              label={t("wizard.trade.review.labels.marginMode")}
              value={
                v.marginMode === "cross" || v.marginMode === "isolated"
                  ? t(`wizard.trade.fields.marginMode.${v.marginMode}` as const)
                  : v.marginMode || "—"
              }
              editHref={editAllHref}
            />
            <WizardSummaryRow
              label={t("wizard.trade.review.labels.fundingPaid")}
              value={v.fundingPaidUsd ? fmtUsd(parseNum(v.fundingPaidUsd)) : "—"}
              editHref={editAllHref}
            />
            <WizardSummaryRow
              label={t("wizard.trade.review.labels.fundingReceived")}
              value={v.fundingReceivedUsd ? fmtUsd(parseNum(v.fundingReceivedUsd)) : "—"}
              editHref={editAllHref}
            />
            <WizardSummaryRow
              label={t("wizard.trade.review.labels.borrowCost")}
              value={v.borrowCostUsd ? fmtUsd(parseNum(v.borrowCostUsd)) : "—"}
              editHref={editAllHref}
            />
          </>
        )}

        {kind === "otc" && (
          <>
            <SummaryHeading className="mt-8">
              {t("wizard.trade.review.sections.otc")}
            </SummaryHeading>
            <WizardSummaryRow
              label={t("wizard.trade.review.labels.counterparty")}
              value={v.counterparty || "—"}
              editHref={editAllHref}
            />
            <WizardSummaryRow
              label={t("wizard.trade.review.labels.settlementDate")}
              value={v.settlementDate || "—"}
              editHref={editAllHref}
            />
            <WizardSummaryRow
              label={t("wizard.trade.review.labels.escrowMethod")}
              value={
                v.escrowMethod === "direct" ||
                v.escrowMethod === "custodian" ||
                v.escrowMethod === "multisig" ||
                v.escrowMethod === "other"
                  ? t(`wizard.trade.fields.escrow.${v.escrowMethod}` as const)
                  : v.escrowMethod || "—"
              }
              editHref={editAllHref}
            />
            <WizardSummaryRow
              label={t("wizard.trade.review.labels.premiumOrDiscountBps")}
              value={v.premiumOrDiscountBps ? `${v.premiumOrDiscountBps} bps` : "—"}
              editHref={editAllHref}
            />
          </>
        )}

        {kind === "nft" && (
          <>
            <SummaryHeading className="mt-8">
              {t("wizard.trade.review.sections.nft")}
            </SummaryHeading>
            <WizardSummaryRow
              label={t("wizard.trade.review.labels.collection")}
              value={v.collection || "—"}
              editHref={editAllHref}
            />
            <WizardSummaryRow
              label={t("wizard.trade.review.labels.tokenId")}
              value={v.tokenId || "—"}
              editHref={editAllHref}
            />
            <WizardSummaryRow
              label={t("wizard.trade.review.labels.marketplace")}
              value={
                MARKETPLACE_LABELS[v.marketplace] ??
                (v.marketplace === "other"
                  ? t("wizard.trade.fields.escrow.other")
                  : v.marketplace || "—")
              }
              editHref={editAllHref}
            />
            <WizardSummaryRow
              label={t("wizard.trade.review.labels.royaltyPct")}
              value={v.royaltyPct ? `${v.royaltyPct}%` : "—"}
              editHref={editAllHref}
            />
          </>
        )}

        <SummaryHeading className="mt-8">
          {t("wizard.trade.review.sections.timing")}
        </SummaryHeading>
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.opened")}
          value={fmtDate(v.openedAt)}
          editHref={editAllHref}
        />
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.closed")}
          value={isOpen ? t("wizard.trade.review.openPlaceholder") : fmtDate(v.closedAt)}
          editHref={editAllHref}
        />
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.daysHeld")}
          value={days > 0 ? fmtDays(days, t) : "—"}
        />

        <SummaryHeading className="mt-8">
          {t("wizard.trade.review.sections.thesisTags")}
        </SummaryHeading>
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.entryThesis")}
          value={v.entryThesis || "—"}
          editHref={editAllHref}
          mono={false}
        />
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.exitNote")}
          value={v.exitNote || "—"}
          editHref={editAllHref}
          mono={false}
        />
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.regimeTags")}
          value={v.regimeTags || "—"}
          editHref={editAllHref}
        />

        <SummaryHeading className="mt-8">
          {t("wizard.trade.review.sections.rollups")}
        </SummaryHeading>
        <WizardSummaryRow
          label={t("wizard.trade.review.labels.strategyTag")}
          value={v.strategyTag || "—"}
          editHref={editAllHref}
        />

        {v.positionId && (
          <WizardSummaryRow
            label={t("wizard.trade.review.labels.source")}
            value={
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                {t("wizard.trade.review.positionLink", { positionId: v.positionId.slice(0, 8) })}
              </span>
            }
          />
        )}
      </section>

      {/* ── Submit ────────────────────────────────────────────────────── */}
      <form action={logTrade} className="mt-10">
        {/* Replay every field through hidden inputs so the server action
            receives the full payload. */}
        {TRADE_FIELDS.map((k) => (
          <input key={k} type="hidden" name={k} value={getStr(sp, k)} />
        ))}

        {/* ── Tags ──────────────────────────────────────────────────────── */}
        <div className="mb-8">
          <SummaryHeading>{t("fields.tags")}</SummaryHeading>
          <p className="mb-3 -mt-1 font-serif text-[12px] italic leading-snug text-text-tertiary">
            {t("activity.tags.idleEmpty")}
          </p>
          <WizardTagInput defaultTags={defaultTags} />
        </div>

        <div className="flex items-center justify-between border-t border-border pt-6">
          <Link
            href={editAllHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("wizard.trade.review.back")}
          </Link>
          <WizardSubmitButton>
            {isEditing ? t("wizard.trade.review.saveChanges") : t("wizard.trade.review.logTrade")}
          </WizardSubmitButton>
        </div>
      </form>
    </WizardShell>
  );
}

function SummaryHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary ${className ?? ""}`}
    >
      {children}
    </h2>
  );
}
