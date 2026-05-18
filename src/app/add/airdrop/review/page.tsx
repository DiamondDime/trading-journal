import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardSummaryRow } from "@/components/wizard/wizard-summary-row";
import { WizardErrorBanner } from "@/components/wizard/wizard-error-banner";
import { WizardCardPreview } from "@/components/wizard/wizard-card-preview";
import { WizardSubmitButton } from "@/components/wizard/wizard-submit-button";
import { getT } from "@/lib/i18n/server";
import { logAirdrop } from "../actions";

// Renders per-request — reads form-stage searchParams to compose the preview.
// force-dynamic prevents Next 16 from prerendering an empty version.
export const dynamic = "force-dynamic";

/** Every form input flows through the review step as a hidden field so
 *  the final submit posts the full payload to the server action. */
const AIRDROP_FIELDS = [
  "status",
  "protocol",
  "asset",
  "tokenChain",
  "snapshotDate",
  "eligibilityReason",
  "eligibilityConfidence",
  "tokensClaimed",
  "claimDate",
  "claimTxHash",
  "claimWallet",
  "gasCostUsd",
  "claimWindowStart",
  "claimWindowEnd",
  "usdValueAtClaim",
  "currentPriceUsd",
  "note",
  "regimeTags",
  "customTags",
  "strategyTag",
  "taxTaxable",
  "taxJurisdiction",
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

/** Days between today and a YYYY-MM-DD date string. Negative = past. */
function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return null;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  d.setUTCHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export default async function AirdropReviewPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;

  const STEP_LABELS = [
    t("wizard.airdrop.review.stepLabels.intent"),
    t("wizard.airdrop.review.stepLabels.details"),
    t("wizard.airdrop.review.stepLabels.review"),
  ] as const;

  const v = {
    status: getStr(sp, "status") === "pending" ? "pending" : "claimed",
    protocol: getStr(sp, "protocol"),
    asset: getStr(sp, "asset"),
    tokenChain: getStr(sp, "tokenChain"),
    snapshotDate: getStr(sp, "snapshotDate"),
    eligibilityReason:
      getStr(sp, "eligibilityReason") || getStr(sp, "note"),
    eligibilityConfidence: getStr(sp, "eligibilityConfidence"),
    tokensClaimed: getStr(sp, "tokensClaimed"),
    claimDate: getStr(sp, "claimDate"),
    claimTxHash: getStr(sp, "claimTxHash"),
    claimWallet: getStr(sp, "claimWallet"),
    gasCostUsd: getStr(sp, "gasCostUsd"),
    claimWindowStart: getStr(sp, "claimWindowStart"),
    claimWindowEnd: getStr(sp, "claimWindowEnd"),
    usdValueAtClaim: getStr(sp, "usdValueAtClaim", "0"),
    currentPriceUsd: getStr(sp, "currentPriceUsd"),
    note: getStr(sp, "note") || getStr(sp, "eligibilityReason"),
    regimeTags: getStr(sp, "regimeTags"),
    customTags: getStr(sp, "customTags"),
    strategyTag: getStr(sp, "strategyTag"),
    taxTaxable: getStr(sp, "taxTaxable"),
    taxJurisdiction: getStr(sp, "taxJurisdiction"),
  };

  const isPending = v.status === "pending";
  const isEditing = getStr(sp, "edit") !== "";

  const tokens = parseNum(v.tokensClaimed);
  const valueAtClaim = parseNum(v.usdValueAtClaim);
  const currentPrice = parseNum(v.currentPriceUsd);
  const gasCost = parseNum(v.gasCostUsd);

  // P&L math (matches db.ts):
  //   - claimed: realized = value_at_claim; net = current_value − gas
  //   - pending: realized = 0; net = 0 − gas (sunk cost only)
  const currentValue = tokens * currentPrice;
  const realized = isPending ? 0 : valueAtClaim;
  const netPnl = (isPending ? 0 : currentValue) - gasCost;

  // MTM denominator:
  //   - claimed: value_at_claim → "tokens worth N× what they were at claim"
  //   - pending: gas_cost → "you've spent $G chasing the drop, current MTM"
  //     Falls back to 1.0× when both denominators are zero so the headline
  //     stays meaningful and doesn't NaN.
  const mtmDenominator = isPending ? gasCost : valueAtClaim;
  const multiplier =
    mtmDenominator > 0
      ? currentValue / mtmDenominator
      : currentValue > 0
      ? Number.POSITIVE_INFINITY
      : 1.0;
  const headlineTone = multiplier >= 1 ? "up" : "down";

  // ── Claim-window countdown ─────────────────────────────────────────
  // Surface when claim_window_end is set and in the future. Hide for
  // already-claimed activities (the window is moot post-claim).
  const claimWindowDaysLeft =
    v.claimWindowEnd && isPending ? daysUntil(v.claimWindowEnd) : null;

  const editAllHref = `/add/airdrop/fields?${new URLSearchParams(
    Object.fromEntries(
      AIRDROP_FIELDS.map((k) => [k, getStr(sp, k)] as const).filter(
        ([, val]) => val !== "",
      ),
    ),
  ).toString()}`;

  // ── Card preview ───────────────────────────────────────────────────
  const cardSubtitle = [
    v.protocol,
    v.tokenChain ? v.tokenChain : null,
    isPending && v.claimWindowEnd
      ? t("wizard.airdrop.review.card.windowSubtitle", { date: fmtDate(v.claimWindowEnd) })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const cardStatus = isPending ? "pending" : "claimed";

  return (
    <WizardShell
      type="airdrop"
      step={3}
      totalSteps={3}
      stepLabels={STEP_LABELS}
      title={
        isEditing
          ? t("wizard.airdrop.review.titleEdit")
          : isPending
          ? t("wizard.airdrop.review.titlePending")
          : t("wizard.airdrop.review.title")
      }
      subtitle={
        isEditing
          ? t("wizard.airdrop.review.subtitleEdit")
          : isPending
          ? t("wizard.airdrop.review.subtitlePending")
          : t("wizard.airdrop.review.subtitle")
      }
    >
      <WizardErrorBanner error={getStr(sp, "error") || undefined} />

      {/* ── Card preview (what the archive will show) ────────────────── */}
      <section className="mt-6">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.airdrop.review.card.heading")}
        </p>
        <WizardCardPreview
          activityType="airdrop"
          status={cardStatus}
          name={v.asset && v.protocol ? `${v.asset.toUpperCase()} · ${v.protocol} airdrop` : ""}
          subtype={{
            symbol: v.asset || null,
            subtitle: cardSubtitle || null,
            airdropMultiplier: mtmDenominator > 0 ? multiplier : null,
          }}
        />
      </section>

      {/* ── Claim-window countdown ───────────────────────────────────── */}
      {claimWindowDaysLeft !== null && (
        <section className="mt-4">
          <div
            className={
              claimWindowDaysLeft <= 7
                ? "rounded-md border border-warn/40 bg-warn/5 px-4 py-3 text-[12px] text-warn"
                : "rounded-md border border-border bg-subtle px-4 py-3 text-[12px] text-text"
            }
            role="status"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] mb-1">
              {t("wizard.airdrop.review.window.heading")}
            </p>
            <p className="font-serif text-[14px]">
              {claimWindowDaysLeft >= 0
                ? t("wizard.airdrop.review.window.countdown", {
                    date: fmtDate(v.claimWindowEnd),
                    days: claimWindowDaysLeft,
                  })
                : t("wizard.airdrop.review.window.expired", {
                    date: fmtDate(v.claimWindowEnd),
                  })}
            </p>
          </div>
        </section>
      )}

      {/* ── Hero preview ─────────────────────────────────────────────── */}
      <section className="mt-8 border-y border-border py-10">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {isPending
              ? t("wizard.airdrop.review.hero.captionPending")
              : t("wizard.airdrop.review.hero.caption")}
          </p>
          <div className="flex items-baseline gap-3">
            <span
              className="font-serif font-normal leading-none text-signature"
              style={{ fontSize: "clamp(48px, 7vw, 72px)" }}
            >
              {mtmDenominator > 0 || currentValue > 0
                ? Number.isFinite(multiplier)
                  ? fmtMultiplier(multiplier)
                  : "∞"
                : "—"}
            </span>
            <span className="font-serif text-xl font-normal text-text-tertiary">
              {isPending
                ? t("wizard.airdrop.review.hero.mtmLabelPending")
                : t("wizard.airdrop.review.hero.mtmLabel")}
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
            {isPending
              ? t("wizard.airdrop.review.hero.realizedSuffixPending")
              : t("wizard.airdrop.review.hero.realizedSuffix")}
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
          {t("wizard.airdrop.review.section.intent")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.status")}
            value={isPending
              ? t("wizard.airdrop.review.row.statusPending")
              : t("wizard.airdrop.review.row.statusClaimed")}
            tone={isPending ? "neutral" : "up"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.eligibilityConfidence")}
            value={renderConfidence(v.eligibilityConfidence, t)}
            editHref={editAllHref}
            mono={false}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
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
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.tokenChain")}
            value={v.tokenChain || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.snapshotDate")}
            value={fmtDate(v.snapshotDate)}
            editHref={editAllHref}
          />
          {v.eligibilityReason && (
            <WizardSummaryRow
              label={t("wizard.airdrop.review.row.eligibilityReason")}
              value={v.eligibilityReason}
              editHref={editAllHref}
              mono={false}
            />
          )}
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {isPending
            ? t("wizard.airdrop.review.section.claimPending")
            : t("wizard.airdrop.review.section.claim")}
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
            label={t("wizard.airdrop.review.row.gasCost")}
            value={gasCost > 0 ? fmtUsd(gasCost) : "—"}
            editHref={editAllHref}
            tone={gasCost > 0 ? "down" : "neutral"}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.claimWallet")}
            value={v.claimWallet || "—"}
            editHref={editAllHref}
            mono
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.claimTxHash")}
            value={v.claimTxHash || "—"}
            editHref={editAllHref}
            mono
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.claimWindowStart")}
            value={fmtDate(v.claimWindowStart)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.claimWindowEnd")}
            value={fmtDate(v.claimWindowEnd)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.currentValue")}
            value={currentValue > 0 ? fmtUsd(currentValue) : "—"}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.mtmMultiplier")}
            value={
              mtmDenominator > 0
                ? fmtMultiplier(multiplier)
                : currentValue > 0
                ? "∞"
                : "—"
            }
            tone={multiplier >= 1 ? "up" : "down"}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.realized")}
            value={fmtUsd(realized, true)}
            tone={realized >= 0 ? "up" : "down"}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.netPnl")}
            value={fmtUsd(netPnl, true)}
            tone={netPnl >= 0 ? "up" : "down"}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.airdrop.review.section.attribution")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.strategyTag")}
            value={v.strategyTag || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.regimeTags")}
            value={v.regimeTags || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.customTags")}
            value={v.customTags || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.taxTaxable")}
            value={
              v.taxTaxable === "1"
                ? t("wizard.airdrop.review.row.taxYes")
                : t("wizard.airdrop.review.row.taxNo")
            }
            editHref={editAllHref}
            mono={false}
          />
          <WizardSummaryRow
            label={t("wizard.airdrop.review.row.taxJurisdiction")}
            value={v.taxJurisdiction || "—"}
            editHref={editAllHref}
          />
          {v.note && (
            <WizardSummaryRow
              label={t("wizard.airdrop.review.row.note")}
              value={v.note}
              editHref={editAllHref}
              mono={false}
            />
          )}
        </div>
      </section>

      {/* ── Satellite-attachment hint ────────────────────────────────── */}
      <section className="mt-10 rounded-md border border-border bg-subtle px-4 py-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
          {t("wizard.airdrop.review.satellite.heading")}
        </p>
        <p className="mt-2 font-serif text-[13px] italic text-text-secondary">
          {t("wizard.airdrop.review.satellite.body")}
        </p>
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
          <WizardSubmitButton>
            {isEditing
              ? t("wizard.airdrop.review.nav.saveChanges")
              : isPending
              ? t("wizard.airdrop.review.nav.logPending")
              : t("wizard.airdrop.review.nav.logAirdrop")}
          </WizardSubmitButton>
        </div>
      </form>
    </WizardShell>
  );
}

function renderConfidence(
  value: string,
  t: Awaited<ReturnType<typeof getT>>,
): string {
  switch (value) {
    case "snapshot_listed":
      return t("wizard.airdrop.fields.confidence.snapshotListed.title");
    case "expected_unconfirmed":
      return t("wizard.airdrop.fields.confidence.expectedUnconfirmed.title");
    case "claimed_confirmed":
      return t("wizard.airdrop.fields.confidence.claimedConfirmed.title");
    default:
      return "—";
  }
}
