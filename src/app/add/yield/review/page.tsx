import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardSummaryRow } from "@/components/wizard/wizard-summary-row";
import { WizardErrorBanner } from "@/components/wizard/wizard-error-banner";
import { WizardCardPreview } from "@/components/wizard/wizard-card-preview";
import { WizardSubmitButton } from "@/components/wizard/wizard-submit-button";
import { getT } from "@/lib/i18n/server";
import { logYieldPosition } from "../actions";

export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

const ALL_FIELDS = [
  // common
  "kind",
  "source",
  "protocol",
  "venue",
  "chain",
  "asset",
  "amount",
  "amountUsdAtOpen",
  "expectedApyPct",
  "rewardsToken",
  "feesProtocolUsd",
  "feesGasUsd",
  "openedAt",
  "closedAt",
  "status",
  "strategyTag",
  "taxTaxable",
  "taxJurisdiction",
  "regimeTags",
  "customTags",
  "name",
  // stake / validator
  "validatorAddress",
  "operator",
  "commissionPct",
  // lend
  "rateKind",
  "ltv",
  // farm / lp
  "pairA",
  "pairB",
  "amountA",
  "amountB",
  "poolFeeTier",
  "rangeLower",
  "rangeUpper",
  "concentrated",
  "rewardToken",
  // mining
  "hashrateThs",
  "electricityCostUsdKwh",
  "pool",
  "expectedDailyRevenueUsd",
  // edit handle
  "edit",
] as const;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  return typeof v === "string" ? v : fallback;
}

function parseNum(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmtUsd(n: number, signed = false): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}$${abs}`;
}

function fmtPct(n: number, signed = true): string {
  const abs = Math.abs(n).toFixed(2);
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}${abs}%`;
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

/**
 * Step 4/4 — Review.
 *
 * Hero is the expected APY (or realized if status='closed'); secondary
 * line is the expected total yield in USD. A `<WizardCardPreview>` shows
 * the row exactly as it will land on /spreads/archive — same headline,
 * same subtitle, same status badge — so the trader sees the persisted
 * shape before they hit submit.
 *
 * Status badge: hard-coded to whatever the lifecycle step set; the v5
 * activity_status enum allows open / unwinding / closed for yield_position
 * (chk_activity_status_by_type, migration 015 §8).
 */
export default async function YieldReviewPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;
  const STEP_LABELS = [
    t("wizard.yield.stepLabels.kind"),
    t("wizard.yield.stepLabels.fields"),
    t("wizard.yield.stepLabels.review"),
  ] as const;

  const v = {
    kind: getStr(sp, "kind", "stake"),
    source: getStr(sp, "source", "manual"),
    protocol: getStr(sp, "protocol"),
    venue: getStr(sp, "venue"),
    chain: getStr(sp, "chain"),
    asset: getStr(sp, "asset"),
    amount: getStr(sp, "amount"),
    amountUsdAtOpen: getStr(sp, "amountUsdAtOpen"),
    expectedApyPct: getStr(sp, "expectedApyPct"),
    rewardsToken: getStr(sp, "rewardsToken"),
    feesProtocolUsd: getStr(sp, "feesProtocolUsd", "0"),
    feesGasUsd: getStr(sp, "feesGasUsd", "0"),
    openedAt: getStr(sp, "openedAt"),
    closedAt: getStr(sp, "closedAt"),
    status: getStr(sp, "status", "open"),
    strategyTag: getStr(sp, "strategyTag"),
    taxTaxable: getStr(sp, "taxTaxable", "false"),
    taxJurisdiction: getStr(sp, "taxJurisdiction"),
    regimeTags: getStr(sp, "regimeTags"),
    customTags: getStr(sp, "customTags"),
    name: getStr(sp, "name"),
    // kind-specific
    validatorAddress: getStr(sp, "validatorAddress"),
    operator: getStr(sp, "operator"),
    rateKind: getStr(sp, "rateKind"),
    ltv: getStr(sp, "ltv"),
    pairA: getStr(sp, "pairA"),
    pairB: getStr(sp, "pairB"),
    amountA: getStr(sp, "amountA"),
    amountB: getStr(sp, "amountB"),
    poolFeeTier: getStr(sp, "poolFeeTier"),
    rangeLower: getStr(sp, "rangeLower"),
    rangeUpper: getStr(sp, "rangeUpper"),
    concentrated: getStr(sp, "concentrated"),
    commissionPct: getStr(sp, "commissionPct"),
    rewardToken: getStr(sp, "rewardToken"),
    hashrateThs: getStr(sp, "hashrateThs"),
    electricityCostUsdKwh: getStr(sp, "electricityCostUsdKwh"),
    pool: getStr(sp, "pool"),
    expectedDailyRevenueUsd: getStr(sp, "expectedDailyRevenueUsd"),
  };

  const capital = parseNum(v.amountUsdAtOpen);
  const expectedApy = parseNum(v.expectedApyPct);
  const feesProtocol = parseNum(v.feesProtocolUsd);
  const feesGas = parseNum(v.feesGasUsd);
  const fees = feesProtocol + feesGas;
  // Hold-window estimate for the secondary callout.
  const today = new Date();
  const opened = v.openedAt ? new Date(v.openedAt) : today;
  const closed = v.closedAt ? new Date(v.closedAt) : null;
  const daysHeld =
    closed && Number.isFinite(closed.getTime())
      ? Math.max(
          0,
          Math.round((closed.getTime() - opened.getTime()) / 86_400_000),
        )
      : null;
  // Expected total yield = capital * APY/100 * (daysHeld/365) when both
  // numbers are present; otherwise hide.
  const expectedTotalYieldUsd =
    capital > 0 && expectedApy > 0 && daysHeld !== null
      ? capital * (expectedApy / 100) * (daysHeld / 365)
      : null;

  const editAllHref = `/add/yield/fields?${new URLSearchParams(
    Object.fromEntries(
      ALL_FIELDS.map((k) => [k, getStr(sp, k)] as const).filter(
        ([, val]) => val !== "",
      ),
    ),
  ).toString()}`;
  const isEditing = getStr(sp, "edit") !== "";

  // Status is a 1:1 hand-off — the wizard already enforced one of
  // (open|unwinding|closed) in the field step's <WizardSelect>.
  const status =
    v.status === "unwinding"
      ? "unwinding"
      : v.status === "closed"
        ? "closed"
        : "open";

  // ── Per-kind detail rows ──────────────────────────────────────────────────
  const kindRows = renderKindRows(v.kind, v, editAllHref);

  return (
    <WizardShell
      type="yield_position"
      step={3}
      totalSteps={3}
      stepLabels={STEP_LABELS}
      title={isEditing ? "Confirm changes" : "Confirm yield position"}
      subtitle={
        isEditing
          ? "Verify the updated state below, then save."
          : "Review the numbers, status, and tags. Submit to land the row on the activity feed."
      }
    >
      <WizardErrorBanner error={getStr(sp, "error") || undefined} />

      {/* ── Hero APY ─────────────────────────────────────────────────────── */}
      <section className="border-y border-border py-10">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {status === "closed" ? "Realized APY" : "Expected APY"}
          </p>
          <div className="flex items-baseline gap-3">
            <span
              className="font-serif font-normal leading-none text-signature"
              style={{ fontSize: "clamp(48px, 7vw, 72px)" }}
            >
              {expectedApy > 0 ? fmtPct(expectedApy, true) : "—"}
            </span>
            <span className="font-serif text-xl font-normal text-text-tertiary">
              APY
            </span>
          </div>
          <p className="mt-2 font-mono text-[13px] text-text-secondary">
            Expected total yield:{" "}
            <span
              className={
                expectedTotalYieldUsd !== null && expectedTotalYieldUsd >= 0
                  ? "text-up font-medium"
                  : "text-text"
              }
            >
              {expectedTotalYieldUsd !== null
                ? fmtUsd(expectedTotalYieldUsd, true)
                : "—"}
            </span>
            {capital > 0 && (
              <>
                {" · "}
                Capital: {fmtUsd(capital)}
              </>
            )}
            {fees > 0 && (
              <>
                {" · "}
                Fees: {fmtUsd(fees)}
              </>
            )}
          </p>
        </div>
      </section>

      {/* ── Card preview (matches /spreads/archive rendering) ────────────── */}
      <section className="mt-10">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          How it appears on the feed
        </p>
        <WizardCardPreview
          activityType="yield_position"
          status={status}
          name={
            v.name ||
            (v.asset && v.protocol
              ? `${v.asset.toUpperCase()} · ${v.protocol} · ${v.kind}`
              : "Untitled yield position")
          }
          subtype={{
            symbol: v.asset.toUpperCase() || null,
            subtitle: v.protocol ? `${v.protocol} · ${v.kind}` : v.kind,
            yieldApyPct: expectedApy > 0 ? expectedApy : null,
            capital: capital > 0 ? capital : null,
          }}
        />
      </section>

      {/* ── Field summary ───────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Position
        </h2>
        <div>
          <WizardSummaryRow
            label="Kind"
            value={v.kind.charAt(0).toUpperCase() + v.kind.slice(1)}
            editHref={`/add/yield/kind?kind=${v.kind}`}
          />
          <WizardSummaryRow
            label="Protocol"
            value={v.protocol || "—"}
            editHref={editAllHref}
          />
          {v.venue && (
            <WizardSummaryRow
              label="Venue"
              value={v.venue}
              editHref={editAllHref}
            />
          )}
          {v.chain && (
            <WizardSummaryRow
              label="Chain"
              value={v.chain}
              editHref={editAllHref}
            />
          )}
          <WizardSummaryRow
            label="Asset"
            value={v.asset.toUpperCase() || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Amount"
            value={v.amount || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Capital (USD)"
            value={capital > 0 ? fmtUsd(capital) : "—"}
            editHref={editAllHref}
          />
        </div>

        {kindRows && (
          <>
            <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {v.kind.charAt(0).toUpperCase() + v.kind.slice(1)} details
            </h2>
            <div>{kindRows}</div>
          </>
        )}

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Yield economics
        </h2>
        <div>
          <WizardSummaryRow
            label="Expected APY"
            value={expectedApy > 0 ? fmtPct(expectedApy, false) : "—"}
            tone={expectedApy > 0 ? "signature" : "neutral"}
            editHref={editAllHref}
          />
          {expectedTotalYieldUsd !== null && (
            <WizardSummaryRow
              label="Expected yield (USD)"
              value={fmtUsd(expectedTotalYieldUsd, true)}
              tone={expectedTotalYieldUsd >= 0 ? "up" : "down"}
            />
          )}
          {v.rewardsToken && (
            <WizardSummaryRow
              label="Reward token"
              value={v.rewardsToken.toUpperCase()}
              editHref={editAllHref}
            />
          )}
          <WizardSummaryRow
            label="Protocol fees"
            value={fmtUsd(feesProtocol)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Gas fees"
            value={fmtUsd(feesGas)}
            editHref={editAllHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Lifecycle
        </h2>
        <div>
          <WizardSummaryRow
            label="Status"
            value={status}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Opened at"
            value={fmtDate(v.openedAt)}
            editHref={editAllHref}
          />
          {v.closedAt && (
            <WizardSummaryRow
              label="Closed at"
              value={fmtDate(v.closedAt)}
              editHref={editAllHref}
            />
          )}
          {daysHeld !== null && (
            <WizardSummaryRow label="Days held" value={String(daysHeld)} />
          )}
        </div>

        {(v.strategyTag ||
          v.taxTaxable === "true" ||
          v.taxJurisdiction ||
          v.regimeTags) && (
          <>
            <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              Strategy, tax, tags
            </h2>
            <div>
              {v.strategyTag && (
                <WizardSummaryRow
                  label="Strategy"
                  value={v.strategyTag}
                  editHref={editAllHref}
                />
              )}
              <WizardSummaryRow
                label="Taxable"
                value={v.taxTaxable === "true" ? "Yes" : "No"}
                editHref={editAllHref}
              />
              {v.taxJurisdiction && (
                <WizardSummaryRow
                  label="Jurisdiction"
                  value={v.taxJurisdiction}
                  editHref={editAllHref}
                />
              )}
              {v.regimeTags && (
                <WizardSummaryRow
                  label="Regime tags"
                  value={v.regimeTags}
                  editHref={editAllHref}
                />
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Submit ─────────────────────────────────────────────────────────
          useFormStatus inside <WizardSubmitButton> disables the button +
          shows a spinner the moment submission starts — kills the
          double-submit race when /review re-mounts mid-redirect. */}
      <form action={logYieldPosition} className="mt-10">
        {ALL_FIELDS.map((k) => (
          <input key={k} type="hidden" name={k} value={getStr(sp, k)} />
        ))}

        <div className="flex items-center justify-between border-t border-border pt-6">
          <Link
            href={editAllHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </Link>
          <WizardSubmitButton>
            {isEditing ? "Save changes" : "Log yield position"}
          </WizardSubmitButton>
        </div>
      </form>
    </WizardShell>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

/**
 * Render the kind-specific WizardSummaryRows. Returns null when no
 * meaningful data is set for the chosen kind so the review page can skip
 * the empty section.
 */
function renderKindRows(
  kind: string,
  v: Record<string, string>,
  editHref: string,
): React.ReactNode | null {
  switch (kind) {
    case "stake":
      if (!v.validatorAddress && !v.operator) return null;
      return (
        <>
          {v.validatorAddress && (
            <WizardSummaryRow
              label="Validator address"
              value={v.validatorAddress}
              editHref={editHref}
            />
          )}
          {v.operator && (
            <WizardSummaryRow
              label="Operator"
              value={v.operator}
              editHref={editHref}
            />
          )}
        </>
      );
    case "lend":
      if (!v.rateKind && !v.ltv) return null;
      return (
        <>
          {v.rateKind && (
            <WizardSummaryRow
              label="Rate kind"
              value={v.rateKind}
              editHref={editHref}
            />
          )}
          {v.ltv && (
            <WizardSummaryRow
              label="LTV %"
              value={`${v.ltv}%`}
              editHref={editHref}
            />
          )}
        </>
      );
    case "farm":
      if (!v.pairA && !v.pairB) return null;
      return (
        <>
          {v.pairA && (
            <WizardSummaryRow
              label="Pair A"
              value={`${v.amountA || "?"} ${v.pairA.toUpperCase()}`}
              editHref={editHref}
            />
          )}
          {v.pairB && (
            <WizardSummaryRow
              label="Pair B"
              value={`${v.amountB || "?"} ${v.pairB.toUpperCase()}`}
              editHref={editHref}
            />
          )}
          {v.poolFeeTier && (
            <WizardSummaryRow
              label="Pool fee"
              value={v.poolFeeTier}
              editHref={editHref}
            />
          )}
          {v.rewardToken && (
            <WizardSummaryRow
              label="Reward token"
              value={v.rewardToken.toUpperCase()}
              editHref={editHref}
            />
          )}
        </>
      );
    case "lp":
      if (!v.pairA && !v.pairB) return null;
      return (
        <>
          {v.pairA && (
            <WizardSummaryRow
              label="Pair A"
              value={`${v.amountA || "?"} ${v.pairA.toUpperCase()}`}
              editHref={editHref}
            />
          )}
          {v.pairB && (
            <WizardSummaryRow
              label="Pair B"
              value={`${v.amountB || "?"} ${v.pairB.toUpperCase()}`}
              editHref={editHref}
            />
          )}
          <WizardSummaryRow
            label="Pool fee tier"
            value={v.poolFeeTier || "—"}
            editHref={editHref}
          />
          <WizardSummaryRow
            label="Concentrated?"
            value={v.concentrated === "true" ? "Yes (v3)" : "No (v2)"}
            editHref={editHref}
          />
          {v.rangeLower && (
            <WizardSummaryRow
              label="Range lower"
              value={v.rangeLower}
              editHref={editHref}
            />
          )}
          {v.rangeUpper && (
            <WizardSummaryRow
              label="Range upper"
              value={v.rangeUpper}
              editHref={editHref}
            />
          )}
        </>
      );
    case "validator":
      if (!v.validatorAddress && !v.commissionPct) return null;
      return (
        <>
          <WizardSummaryRow
            label="Validator"
            value={v.validatorAddress || "—"}
            editHref={editHref}
          />
          <WizardSummaryRow
            label="Commission"
            value={v.commissionPct ? `${v.commissionPct}%` : "—"}
            editHref={editHref}
          />
        </>
      );
    case "mining":
      if (!v.hashrateThs && !v.pool) return null;
      return (
        <>
          <WizardSummaryRow
            label="Hashrate"
            value={v.hashrateThs ? `${v.hashrateThs} TH/s` : "—"}
            editHref={editHref}
          />
          <WizardSummaryRow
            label="Electricity"
            value={
              v.electricityCostUsdKwh
                ? `$${v.electricityCostUsdKwh}/kWh`
                : "—"
            }
            editHref={editHref}
          />
          <WizardSummaryRow
            label="Pool"
            value={v.pool || "—"}
            editHref={editHref}
          />
          <WizardSummaryRow
            label="Expected revenue / day"
            value={
              v.expectedDailyRevenueUsd
                ? fmtUsd(parseNum(v.expectedDailyRevenueUsd))
                : "—"
            }
            editHref={editHref}
          />
        </>
      );
    default:
      return null;
  }
}
