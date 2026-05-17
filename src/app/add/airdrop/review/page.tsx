import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardSummaryRow } from "@/components/wizard/wizard-summary-row";
import { WizardErrorBanner } from "@/components/wizard/wizard-error-banner";
import { getT } from "@/lib/i18n/server";
import { logAirdrop } from "../actions";

const AIRDROP_FIELDS = [
  "protocol",
  "asset",
  "tokensClaimed",
  "claimDate",
  "usdValueAtClaim",
  "currentPriceUsd",
  "note",
  "regimeTags",
  "edit",
] as const;

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
  const formatted = m >= 10 ? m.toFixed(1) : m.toFixed(2);
  return `${formatted}×`;
}

function fmtTokens(n: number): string {
  if (n === 0) return "—";
  return n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

export default async function AirdropReviewPage(props: {
  searchParams: Search;
}) {
  const t = await getT();
  const sp = await props.searchParams;

  const STEP_LABELS = [
    t("wizard.airdrop.review.stepLabels.details"),
    t("wizard.airdrop.review.stepLabels.review"),
  ] as const;

  const v = {
    protocol: getStr(sp, "protocol"),
    asset: getStr(sp, "asset"),
    tokensClaimed: getStr(sp, "tokensClaimed"),
    claimDate: getStr(sp, "claimDate"),
    usdValueAtClaim: getStr(sp, "usdValueAtClaim", "0"),
    currentPriceUsd: getStr(sp, "currentPriceUsd"),
    note: getStr(sp, "note"),
    regimeTags: getStr(sp, "regimeTags"),
  };

  const tokens = parseNum(v.tokensClaimed);
  const valueAtClaim = parseNum(v.usdValueAtClaim);
  const currentPrice = parseNum(v.currentPriceUsd);

  const currentValue = tokens * currentPrice;
  // Cost basis is $0 for airdrops; the multiplier compares current value
  // to the value at the moment of claim. If we never captured that
  // baseline, default to 1.0× so the headline stays meaningful.
  const multiplier = valueAtClaim > 0 ? currentValue / valueAtClaim : 1.0;
  // Net P&L for an airdrop is the full current value — there's no cost
  // basis to subtract.
  const netPnl = currentValue;
  const headlineTone = multiplier >= 1 ? "up" : "down";

  const editAllHref = `/add/airdrop/fields?${new URLSearchParams(
    Object.fromEntries(
      AIRDROP_FIELDS.map((k) => [k, getStr(sp, k)] as const).filter(
        ([, val]) => val !== ""
      )
    )
  ).toString()}`;
  const isEditing = getStr(sp, "edit") !== "";

  return (
    <WizardShell
      type="airdrop"
      step={2}
      totalSteps={2}
      stepLabels={STEP_LABELS}
      title={
        isEditing
          ? t("wizard.airdrop.review.titleEdit")
          : t("wizard.airdrop.review.title")
      }
      subtitle={
        isEditing
          ? t("wizard.airdrop.review.subtitleEdit")
          : t("wizard.airdrop.review.subtitle")
      }
    >
      <WizardErrorBanner error={getStr(sp, "error") || undefined} />
      {/* ── Hero preview ─────────────────────────────────────────────── */}
      <section className="border-y border-border py-10">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {t("wizard.airdrop.review.hero.caption")}
          </p>
          <div className="flex items-baseline gap-3">
            <span
              className="font-serif font-normal leading-none text-signature"
              style={{ fontSize: "clamp(48px, 7vw, 72px)" }}
            >
              {tokens > 0 && currentPrice > 0 ? fmtMultiplier(multiplier) : "—"}
            </span>
            <span className="font-serif text-xl font-normal text-text-tertiary">
              {t("wizard.airdrop.review.hero.mtmLabel")}
            </span>
          </div>
          <p className="mt-2 font-mono text-[13px] text-text-secondary">
            {t("wizard.airdrop.review.hero.netPrefix")}{" "}
            <span
              className={
                headlineTone === "up"
                  ? "text-up font-medium"
                  : "text-down font-medium"
              }
            >
              {fmtUsd(netPnl, true)}
            </span>{" "}
            {t("wizard.airdrop.review.hero.realizedSuffix")}
            {tokens > 0 && (
              <>
                {" · "}
                {fmtTokens(tokens)}{" "}
                {v.asset || t("wizard.airdrop.review.hero.tokensFallback")}
              </>
            )}
          </p>
        </div>
      </section>

      {/* ── Field summary ─────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.airdrop.review.section.airdrop")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.protocol")}
            value={v.protocol || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.token")}
            value={v.asset || "—"}
            editHref={editAllHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.airdrop.review.section.claim")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.tokensClaimed")}
            value={fmtTokens(tokens)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.claimDate")}
            value={fmtDate(v.claimDate)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.valueAtClaim")}
            value={valueAtClaim > 0 ? fmtUsd(valueAtClaim) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.currentPrice")}
            value={currentPrice > 0 ? fmtUsd(currentPrice) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.currentValue")}
            value={currentValue > 0 ? fmtUsd(currentValue) : "—"}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.mtmMultiplier")}
            value={tokens > 0 && currentPrice > 0 ? fmtMultiplier(multiplier) : "—"}
            tone={multiplier >= 1 ? "up" : "down"}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.netPnl")}
            value={fmtUsd(netPnl, true)}
            tone={netPnl >= 0 ? "up" : "down"}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.airdrop.review.section.thesisTags")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.regimeTags")}
            value={v.regimeTags || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.note")}
            value={v.note || "—"}
            editHref={editAllHref}
            mono={false}
          />
        </div>
      </section>

      {/* ── Submit ────────────────────────────────────────────────────── */}
      <form action={logAirdrop} className="mt-10">
        {AIRDROP_FIELDS.map((k) => (
          <input key={k} type="hidden" name={k} value={getStr(sp, k)} />
        ))}

        <div className="flex items-center justify-between border-t border-border pt-6">
          <Link
            href={editAllHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("wizard.airdrop.review.nav.back")}
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-5 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            {isEditing
              ? t("wizard.airdrop.review.nav.saveChanges")
              : t("wizard.airdrop.review.nav.logAirdrop")}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </form>
    </WizardShell>
  );
}
