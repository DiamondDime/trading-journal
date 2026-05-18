import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardSummaryRow } from "@/components/wizard/wizard-summary-row";
import { WizardErrorBanner } from "@/components/wizard/wizard-error-banner";
import { WizardCardPreview } from "@/components/wizard/wizard-card-preview";
import { WizardSubmitButton } from "@/components/wizard/wizard-submit-button";
import { WizardValidationSummary } from "@/components/wizard/wizard-validation-summary";
import { getT } from "@/lib/i18n/server";
import type { VestingSchedule, ActivityStatus } from "@/types/canonical";
import { logSale } from "../actions";

// Reads searchParams per-request — never static. Master plan §0 punch-list:
// every wizard step that reads searchParams must opt out of static rendering.
export const dynamic = "force-dynamic";

// All field names this step hands back to the server action via hidden
// inputs. Any field added to /fields must be appended here or it won't
// round-trip on submit.
const SALE_FIELDS = [
  "saleKind",
  "venue",
  "asset",
  "tokenChain",
  "claimWallet",
  "usdPaid",
  "tokensAllocated",
  "saleDate",
  "tgeDate",
  "tgeUnlockPct",
  "vestingScheduleJson",
  "currentPriceUsd",
  "openedAt",
  "note",
  "regimeTags",
  "fundraisingRound",
  "allocationMethod",
  "tier",
  "bonusPct",
  "strategyTag",
  "taxTaxable",
  "taxJurisdiction",
  "eligibilityReason",
  "edit",
] as const;

// Mirrors the v5 sale_kind enum exactly. The `i18n` field maps the snake_case
// enum to the camelCase key under wizard.sale.kind.* so the template-literal
// t() call below resolves to a known MessageKey at compile time.
const SALE_KINDS = [
  { value: "ido",            i18n: "ido"            },
  { value: "launchpad",      i18n: "launchpad"      },
  { value: "premarket",      i18n: "premarket"      },
  { value: "otc",            i18n: "otc"            },
  { value: "ieo",            i18n: "ieo"            },
  { value: "private_round",  i18n: "privateRound"   },
  { value: "otc_allocation", i18n: "otcAllocation"  },
  { value: "vesting_claim",  i18n: "vestingClaim"   },
] as const;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string")
    return v[0];
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


/**
 * Parse the editor-emitted vesting JSON. Returns null when missing or
 * malformed — the review page renders a "no schedule" notice in that case.
 */
function parseSchedule(raw: string): VestingSchedule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VestingSchedule;
    if (
      parsed &&
      typeof parsed === "object" &&
      "kind" in parsed &&
      ["all_at_tge", "tge_plus_linear", "cliff_plus_linear", "custom"].includes(
        parsed.kind,
      )
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Project the vesting schedule onto a (day, cumulativePct) curve relative
 * to TGE. Used both by the SVG chart and the "next unlock" computation.
 * - all_at_tge:         (0, 100)
 * - tge_plus_linear:    (0, tge_pct) → (linear_days, 100)
 * - cliff_plus_linear:  (0, tge_pct) → (cliff_days, tge_pct) →
 *                       (cliff_days + linear_days, 100)
 * - custom:             user-defined date/pct points sorted ascending,
 *                       cumulative.
 *
 * Days are measured from TGE date. Returned points are sorted by day and
 * cumulative percentage is monotone non-decreasing.
 */
function buildUnlockCurve(
  schedule: VestingSchedule | null,
  tgeDateIso: string,
): { day: number; pct: number; date: Date | null }[] {
  const tge = new Date(tgeDateIso);
  const tgeMs = Number.isFinite(tge.getTime()) ? tge.getTime() : null;
  const at = (day: number) =>
    tgeMs !== null ? new Date(tgeMs + day * 86_400_000) : null;
  if (!schedule) return [];
  switch (schedule.kind) {
    case "all_at_tge":
      return [{ day: 0, pct: 100, date: at(0) }];
    case "tge_plus_linear":
      return [
        { day: 0, pct: schedule.tge_pct, date: at(0) },
        { day: schedule.linear_days, pct: 100, date: at(schedule.linear_days) },
      ];
    case "cliff_plus_linear": {
      const tgePct = schedule.tge_pct ?? 0;
      return [
        { day: 0, pct: tgePct, date: at(0) },
        { day: schedule.cliff_days, pct: tgePct, date: at(schedule.cliff_days) },
        {
          day: schedule.cliff_days + schedule.linear_days,
          pct: 100,
          date: at(schedule.cliff_days + schedule.linear_days),
        },
      ];
    }
    case "custom": {
      // Sort entries by date, accumulate. Each entry's day is its delta from
      // TGE in days; if TGE is unknown we fall back to (0, 0) and just
      // accumulate the percentages.
      const entries = [...schedule.entries].sort(
        (a, b) =>
          new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
      let cum = 0;
      return entries.map((e) => {
        cum += e.pct;
        const d = new Date(e.date);
        const day = tgeMs !== null && Number.isFinite(d.getTime())
          ? Math.round((d.getTime() - tgeMs) / 86_400_000)
          : 0;
        return { day, pct: Math.min(cum, 100), date: d };
      });
    }
  }
}

/**
 * Find the next unlock event after "today" (or after TGE if TGE is in the
 * future). Returns the date and the delta in pct between this point and the
 * previous one — that's what the review card surfaces.
 */
function nextUnlock(
  points: { day: number; pct: number; date: Date | null }[],
): { date: Date; deltaPct: number } | null {
  if (points.length === 0) return null;
  const now = Date.now();
  // Find the first point whose absolute date is in the future. Skip points
  // without a resolvable date (custom entries with bad timestamps).
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (!p.date) continue;
    if (p.date.getTime() <= now) continue;
    const prevPct = i > 0 ? points[i - 1].pct : 0;
    return {
      date: p.date,
      deltaPct: Math.max(0, p.pct - prevPct),
    };
  }
  return null;
}

/**
 * Render the vesting timeline as a cumulative unlock curve. Pure server-
 * rendered SVG — no client JS — same pattern as the Sparkline primitive
 * used elsewhere in the journal.
 */
function VestingTimelineChart({
  points,
  width = 640,
  height = 120,
  ariaLabel,
}: {
  points: { day: number; pct: number }[];
  width?: number;
  height?: number;
  ariaLabel: string;
}) {
  if (points.length === 0) return null;
  const pad = { top: 12, right: 16, bottom: 24, left: 32 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxDay = Math.max(...points.map((p) => p.day), 1);
  const xs = (day: number) => pad.left + (day / maxDay) * innerW;
  const ys = (pct: number) => pad.top + (1 - pct / 100) * innerH;

  // Build the polyline path. Two consecutive points with the same Y form a
  // flat (cliff) segment; the chart renders that as a horizontal line.
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xs(p.day)} ${ys(p.pct)}`)
    .join(" ");

  // Vertical axis ticks at 0 / 50 / 100% and horizontal ticks at start / mid
  // / end of the schedule.
  const yTicks = [0, 50, 100];
  const xTicks = [0, Math.round(maxDay / 2), maxDay];

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      className="font-mono"
    >
      {/* Vertical grid + axis labels */}
      {yTicks.map((y) => (
        <g key={`y-${y}`}>
          <line
            x1={pad.left}
            x2={pad.left + innerW}
            y1={ys(y)}
            y2={ys(y)}
            stroke="currentColor"
            strokeOpacity={y === 0 || y === 100 ? 0.25 : 0.12}
            strokeWidth={1}
          />
          <text
            x={pad.left - 8}
            y={ys(y) + 3}
            textAnchor="end"
            className="fill-current text-[9px] text-text-tertiary"
          >
            {y}%
          </text>
        </g>
      ))}
      {/* Horizontal grid + day labels */}
      {xTicks.map((d) => (
        <g key={`x-${d}`}>
          <line
            x1={xs(d)}
            x2={xs(d)}
            y1={pad.top}
            y2={pad.top + innerH}
            stroke="currentColor"
            strokeOpacity={d === 0 || d === maxDay ? 0.25 : 0.12}
            strokeWidth={1}
          />
          <text
            x={xs(d)}
            y={height - 6}
            textAnchor="middle"
            className="fill-current text-[9px] text-text-tertiary"
          >
            {d === 0 ? "TGE" : `+${d}d`}
          </text>
        </g>
      ))}
      {/* Unlock curve */}
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-signature"
      />
      {/* Vertices */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={xs(p.day)}
          cy={ys(p.pct)}
          r={2.5}
          className="fill-current text-signature"
        />
      ))}
    </svg>
  );
}

// Helper for the review's status badge mapping. Mirrors deriveSaleStatus in
// db.ts (kept here as a pure function so /review can render the badge
// without crossing the action boundary).
function deriveStatus(
  tgeUnlockPct: number,
  tgeDateIso: string,
): ActivityStatus {
  const tgeMs = new Date(tgeDateIso).getTime();
  if (!Number.isFinite(tgeMs)) return "pending";
  if (tgeMs > Date.now()) return "pending";
  if (tgeUnlockPct >= 100) return "vesting";
  return "vesting";
}

export default async function SaleReviewPage(props: { searchParams: Search }) {
  const t = await getT();
  const STEP_LABELS = [
    t("wizard.sale.stepLabels.kind"),
    t("wizard.sale.stepLabels.details"),
    t("wizard.sale.stepLabels.review"),
  ] as const;
  const SALE_KIND_LABELS: Record<string, string> = Object.fromEntries(
    SALE_KINDS.map(
      (k) =>
        [k.value, t(`wizard.sale.kind.${k.i18n}.title` as const)] as const,
    ),
  );
  const sp = await props.searchParams;

  const v = {
    saleKind: getStr(sp, "saleKind"),
    venue: getStr(sp, "venue"),
    asset: getStr(sp, "asset"),
    tokenChain: getStr(sp, "tokenChain"),
    claimWallet: getStr(sp, "claimWallet"),
    usdPaid: getStr(sp, "usdPaid"),
    tokensAllocated: getStr(sp, "tokensAllocated"),
    saleDate: getStr(sp, "saleDate"),
    tgeDate: getStr(sp, "tgeDate"),
    tgeUnlockPct: getStr(sp, "tgeUnlockPct", "0"),
    vestingScheduleJson: getStr(sp, "vestingScheduleJson"),
    currentPriceUsd: getStr(sp, "currentPriceUsd"),
    openedAt: getStr(sp, "openedAt"),
    note: getStr(sp, "note"),
    regimeTags: getStr(sp, "regimeTags"),
    fundraisingRound: getStr(sp, "fundraisingRound"),
    allocationMethod: getStr(sp, "allocationMethod"),
    tier: getStr(sp, "tier"),
    bonusPct: getStr(sp, "bonusPct"),
    strategyTag: getStr(sp, "strategyTag"),
    taxTaxable: getStr(sp, "taxTaxable"),
    taxJurisdiction: getStr(sp, "taxJurisdiction"),
    eligibilityReason: getStr(sp, "eligibilityReason"),
  };

  const usdPaid = parseNum(v.usdPaid);
  const tokens = parseNum(v.tokensAllocated);
  const currentPrice = parseNum(v.currentPriceUsd);
  const tgeUnlock = parseNum(v.tgeUnlockPct);

  const currentValue = tokens * currentPrice;
  // MTM × = current_value / usd_paid. Guard against div-by-zero — a
  // missing usd_paid renders as "—" instead of Infinity.
  const multiplier = usdPaid > 0 ? currentValue / usdPaid : 0;
  const netPnl = currentValue - usdPaid;
  const headlineTone = multiplier >= 1 ? "up" : "down";

  // Schedule + unlock projections
  const schedule = parseSchedule(v.vestingScheduleJson);
  const unlockCurve = buildUnlockCurve(schedule, v.tgeDate);
  const nextEvent = nextUnlock(unlockCurve);
  const status = deriveStatus(tgeUnlock, v.tgeDate);

  // Validation summary — surface issues client/Zod parsing won't catch
  // before submit. URL errors from a failed action attempt land via the
  // separate WizardErrorBanner; this list is for inputs the user can fix
  // without leaving the page.
  const validationIssues: { field: string; message: string }[] = [];
  if (!v.saleKind) {
    validationIssues.push({
      field: "saleKind",
      message: t("wizard.sale.review.validation.kindMissing"),
    });
  }
  if (!v.venue) {
    validationIssues.push({
      field: "venue",
      message: t("wizard.sale.review.validation.venueMissing"),
    });
  }
  if (!v.asset) {
    validationIssues.push({
      field: "asset",
      message: t("wizard.sale.review.validation.assetMissing"),
    });
  }
  if (usdPaid <= 0) {
    validationIssues.push({
      field: "usdPaid",
      message: t("wizard.sale.review.validation.usdPaidPositive"),
    });
  }
  if (tokens <= 0) {
    validationIssues.push({
      field: "tokensAllocated",
      message: t("wizard.sale.review.validation.tokensPositive"),
    });
  }
  if (!v.tgeDate) {
    validationIssues.push({
      field: "tgeDate",
      message: t("wizard.sale.review.validation.tgeDateMissing"),
    });
  }

  const editAllHref = `/add/sale/fields?${new URLSearchParams(
    Object.fromEntries(
      SALE_FIELDS.map((k) => [k, getStr(sp, k)] as const).filter(
        ([, val]) => val !== "",
      ),
    ),
  ).toString()}`;
  const isEditing = getStr(sp, "edit") !== "";

  const previewName = v.asset
    ? `${v.asset.toUpperCase()} — ${v.venue || "—"} ${
        v.saleKind ? SALE_KIND_LABELS[v.saleKind] : ""
      }`.trim()
    : t("wizard.sale.review.previewFallbackName");

  return (
    <WizardShell
      type="sale"
      step={3}
      totalSteps={3}
      stepLabels={STEP_LABELS}
      title={
        isEditing
          ? t("wizard.sale.review.titleEdit")
          : t("wizard.sale.review.title")
      }
      subtitle={
        isEditing
          ? t("wizard.sale.review.subtitleEdit")
          : t("wizard.sale.review.subtitle")
      }
    >
      <WizardErrorBanner error={getStr(sp, "error") || undefined} />

      {validationIssues.length > 0 && (
        <WizardValidationSummary
          errors={validationIssues}
          title={t("wizard.sale.review.validation.title")}
          tone="warning"
          className="mb-6"
        />
      )}

      {/* ── Card preview ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.sale.review.cardPreviewCaption")}
        </p>
        <WizardCardPreview
          activityType="sale"
          status={status}
          name={previewName}
          subtype={{
            saleMultiplier: usdPaid > 0 ? multiplier : 0,
            capital: usdPaid,
            netPnl,
            symbol: v.asset || null,
            subtitle: v.saleKind
              ? SALE_KIND_LABELS[v.saleKind] ?? null
              : null,
          }}
        />
      </section>

      {/* ── Hero MTM ─────────────────────────────────────────────────── */}
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
                {fmtTokens(tokens)}{" "}
                {v.asset || t("wizard.sale.review.tokensFallback")}
              </>
            )}
          </p>
        </div>
      </section>

      {/* ── Vesting timeline ─────────────────────────────────────────── */}
      {schedule && unlockCurve.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            {t("wizard.sale.review.sections.vestingTimeline")}
          </h2>
          <div className="rounded-md border border-border bg-surface p-4 text-text-secondary">
            <VestingTimelineChart
              points={unlockCurve.map((p) => ({ day: p.day, pct: p.pct }))}
              ariaLabel={t("wizard.sale.review.vestingTimelineAria")}
            />
            {nextEvent && (
              <p className="mt-3 font-mono text-[11px] text-text-secondary">
                <span className="uppercase tracking-[0.14em] text-text-tertiary">
                  {t("wizard.sale.review.nextUnlockLabel")}
                </span>
                {" "}
                {t("wizard.sale.review.nextUnlockValue", {
                  date: fmtDate(nextEvent.date.toISOString()),
                  pct: nextEvent.deltaPct.toFixed(1),
                })}
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── Field summary ─────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.sale.review.sections.sale")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.kind")}
            value={SALE_KIND_LABELS[v.saleKind] ?? v.saleKind ?? "—"}
            editHref="/add/sale/kind"
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
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.tokenChain")}
            value={v.tokenChain || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.claimWallet")}
            value={v.claimWallet || "—"}
            editHref={editAllHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.sale.review.sections.round")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.fundraisingRound")}
            value={v.fundraisingRound || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.allocationMethod")}
            value={v.allocationMethod || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.tier")}
            value={v.tier || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.bonusPct")}
            value={v.bonusPct ? `${v.bonusPct}%` : "—"}
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
            label={t("wizard.sale.review.rows.saleDate")}
            value={fmtDate(v.saleDate || v.tgeDate)}
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
            label={t("wizard.sale.review.rows.scheduleVariant")}
            value={
              schedule
                ? t(`wizard.sale.review.scheduleVariants.${schedule.kind}` as const)
                : t("wizard.sale.review.noneValue")
            }
            editHref={editAllHref}
          />
          {schedule?.kind === "tge_plus_linear" && (
            <WizardSummaryRow
              label={t("wizard.sale.review.rows.linearDays")}
              value={t("wizard.sale.review.daysValue", {
                days: schedule.linear_days,
              })}
              editHref={editAllHref}
            />
          )}
          {schedule?.kind === "cliff_plus_linear" && (
            <>
              <WizardSummaryRow
                label={t("wizard.sale.review.rows.cliffDays")}
                value={t("wizard.sale.review.daysValue", {
                  days: schedule.cliff_days,
                })}
                editHref={editAllHref}
              />
              <WizardSummaryRow
                label={t("wizard.sale.review.rows.linearDays")}
                value={t("wizard.sale.review.daysValue", {
                  days: schedule.linear_days,
                })}
                editHref={editAllHref}
              />
            </>
          )}
          {schedule?.kind === "custom" && (
            <WizardSummaryRow
              label={t("wizard.sale.review.rows.customEntries")}
              value={t("wizard.sale.review.customEntriesValue", {
                count: schedule.entries.length,
              })}
              editHref={editAllHref}
            />
          )}
          {nextEvent && (
            <WizardSummaryRow
              label={t("wizard.sale.review.rows.nextUnlock")}
              value={t("wizard.sale.review.nextUnlockValue", {
                date: fmtDate(nextEvent.date.toISOString()),
                pct: nextEvent.deltaPct.toFixed(1),
              })}
              tone="signature"
            />
          )}
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
            label={t("wizard.sale.review.rows.eligibilityReason")}
            value={v.eligibilityReason || "—"}
            editHref={editAllHref}
            mono={false}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.regimeTags")}
            value={v.regimeTags || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.strategyTag")}
            value={v.strategyTag || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.taxTaxable")}
            value={
              v.taxTaxable === "on"
                ? t("wizard.sale.review.taxYes")
                : t("wizard.sale.review.taxNo")
            }
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.sale.review.rows.taxJurisdiction")}
            value={v.taxJurisdiction || "—"}
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
          <WizardSubmitButton>
            {isEditing
              ? t("wizard.sale.review.saveChanges")
              : t("wizard.sale.review.logSale")}
          </WizardSubmitButton>
        </div>
      </form>
    </WizardShell>
  );
}
