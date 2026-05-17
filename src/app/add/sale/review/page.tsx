import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardSummaryRow } from "@/components/wizard/wizard-summary-row";
import { WizardErrorBanner } from "@/components/wizard/wizard-error-banner";
import { getT } from "@/lib/i18n/server";
import { logSale } from "../actions";

const SALE_FIELDS = [
  "saleKind",
  "venue",
  "asset",
  "usdPaid",
  "tokensAllocated",
  "tgeDate",
  "tgeUnlockPct",
  "vestingCliffMonths",
  "vestingDurationMonths",
  "currentPriceUsd",
  "openedAt",
  "note",
  "regimeTags",
  "edit",
] as const;

const SALE_KINDS = ["ido", "launchpad", "premarket", "otc"] as const;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
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

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtMultiplier(m: number): string {
  // Sale headlines use a ×N format. Show 2 decimals up to 9.99×, then 1 dp.
  const formatted = m >= 10 ? m.toFixed(1) : m.toFixed(2);
  return `${formatted}×`;
}

function fmtTokens(n: number): string {
  if (n === 0) return "—";
  return n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

export default async function SaleReviewPage(props: { searchParams: Search }) {
  const t = await getT();
  const STEP_LABELS = [
    t("wizard.sale.stepLabels.details"),
    t("wizard.sale.stepLabels.review"),
  ] as const;
  const SALE_KIND_LABELS: Record<string, string> = Object.fromEntries(
    SALE_KINDS.map((k) => [k, t(`wizard.sale.fields.kinds.${k}`)]),
  );
  const sp = await props.searchParams;

  const v = {
    saleKind: getStr(sp, "saleKind"),
    venue: getStr(sp, "venue"),
    asset: getStr(sp, "asset"),
    usdPaid: getStr(sp, "usdPaid"),
    tokensAllocated: getStr(sp, "tokensAllocated"),
    tgeDate: getStr(sp, "tgeDate"),
    tgeUnlockPct: getStr(sp, "tgeUnlockPct", "0"),
    vestingCliffMonths: getStr(sp, "vestingCliffMonths", "0"),
    vestingDurationMonths: getStr(sp, "vestingDurationMonths", "0"),
    currentPriceUsd: getStr(sp, "currentPriceUsd"),
    openedAt: getStr(sp, "openedAt"),
    note: getStr(sp, "note"),
    regimeTags: getStr(sp, "regimeTags"),
  };

  const usdPaid = parseNum(v.usdPaid);
  const tokens = parseNum(v.tokensAllocated);
  const currentPrice = parseNum(v.currentPriceUsd);
  const tgeUnlock = parseNum(v.tgeUnlockPct);
  const cliffMonths = parseNum(v.vestingCliffMonths);
  const durationMonths = parseNum(v.vestingDurationMonths);

  const currentValue = tokens * currentPrice;
  // MTM × = current_value / usd_paid. Guard against div-by-zero — a
  // missing usd_paid renders as "—" instead of Infinity.
  const multiplier = usdPaid > 0 ? currentValue / usdPaid : 0;
  const netPnl = currentValue - usdPaid;
  const headlineTone = multiplier >= 1 ? "up" : "down";

  const editAllHref = `/add/sale/fields?${new URLSearchParams(
    Object.fromEntries(
      SALE_FIELDS.map((k) => [k, getStr(sp, k)] as const).filter(
        ([, val]) => val !== ""
      )
    )
  ).toString()}`;
  const isEditing = getStr(sp, "edit") !== "";

  return (
    <WizardShell
      type="sale"
      step={2}
      totalSteps={2}
      stepLabels={STEP_LABELS}
      title={isEditing ? t("wizard.sale.review.titleEdit") : t("wizard.sale.review.title")}
      subtitle={
        isEditing
          ? t("wizard.sale.review.subtitleEdit")
          : t("wizard.sale.review.subtitle")
      }
    >
      <WizardErrorBanner error={getStr(sp, "error") || undefined} />
      {/* ── Hero preview ─────────────────────────────────────────────── */}
      <section className="border-y border-border py-10">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {t("wizard.sale.review.heroCaption")}
          </p>
          <div className="flex items-baseline gap-3">
            <span
              className="font-serif font-normal leading-none text-signature"
              style={{ fontSize: "clamp(48px, 7vw, 72px)" }}
            >
              {usdPaid > 0 ? fmtMultiplier(multiplier) : "—"}
            </span>
            <span className="font-serif text-xl font-normal text-text-tertiary">
              {t("wizard.sale.review.mtmLabel")}
            </span>
          </div>
          <p className="mt-2 font-mono text-[13px] text-text-secondary">
            {t("wizard.sale.review.netPrefix")}{" "}
            <span
              className={
                headlineTone === "up"
                  ? "text-up font-medium"
                  : "text-down font-medium"
              }
            >
              {fmtUsd(netPnl, true)}
            </span>{" "}
            {t("wizard.sale.review.onPaid", { paid: fmtUsd(usdPaid) })}
            {tokens > 0 && (
              <>
                {" · "}
                {fmtTokens(tokens)} {v.asset || t("wizard.sale.review.tokensFallback")}
              </>
            )}
          </p>
        </div>
      </section>

      {/* ── Field summary ─────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.sale.review.sections.sale")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.kind")}
            value={SALE_KIND_LABELS[v.saleKind] ?? v.saleKind ?? "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.venue")}
            value={v.venue || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.token")}
            value={v.asset || "—"}
            editHref={editAllHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.sale.review.sections.allocation")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.usdPaid")}
            value={usdPaid > 0 ? fmtUsd(usdPaid) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.tokensAllocated")}
            value={fmtTokens(tokens)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.currentPrice")}
            value={currentPrice > 0 ? fmtUsd(currentPrice) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.currentValue")}
            value={currentValue > 0 ? fmtUsd(currentValue) : "—"}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.mtmMultiplier")}
            value={usdPaid > 0 ? fmtMultiplier(multiplier) : "—"}
            tone={multiplier >= 1 ? "up" : "down"}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.netPnl")}
            value={fmtUsd(netPnl, true)}
            tone={netPnl >= 0 ? "up" : "down"}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.sale.review.sections.vesting")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.tgeDate")}
            value={fmtDate(v.tgeDate)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.tgeUnlockPct")}
            value={tgeUnlock > 0 ? `${tgeUnlock}%` : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.vestingCliff")}
            value={
              cliffMonths > 0
                ? t("wizard.sale.review.monthsValue", { months: cliffMonths })
                : t("wizard.sale.review.noneValue")
            }
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.vestingDuration")}
            value={
              durationMonths > 0
                ? t("wizard.sale.review.monthsValue", { months: durationMonths })
                : t("wizard.sale.review.noneValue")
            }
            editHref={editAllHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.sale.review.sections.thesis")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.opened")}
            value={fmtDate(v.openedAt)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.regimeTags")}
            value={v.regimeTags || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.note")}
            value={v.note || "—"}
            editHref={editAllHref}
            mono={false}
          />
        </div>
      </section>

      {/* ── Submit ────────────────────────────────────────────────────── */}
      <form action={logSale} className="mt-10">
        {SALE_FIELDS.map((k) => (
          <input key={k} type="hidden" name={k} value={getStr(sp, k)} />
        ))}

        <div className="flex items-center justify-between border-t border-border pt-6">
          <Link
            href={editAllHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("wizard.sale.review.back")}
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-5 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            {isEditing ? t("wizard.sale.review.saveChanges") : t("wizard.sale.review.logSale")}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </form>
    </WizardShell>
  );
}
