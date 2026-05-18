import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardSummaryRow } from "@/components/wizard/wizard-summary-row";
import { WizardSubmitButton } from "@/components/wizard/wizard-submit-button";
import { WizardCardPreview } from "@/components/wizard/wizard-card-preview";
import { WizardValidationSummary } from "@/components/wizard/wizard-validation-summary";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { logSpread } from "../actions";
import { requireUser } from "@/lib/auth/server";
import { getPickerOptionsByPositionIds, type PickerOptionRow } from "../db";
import type { ActivityStatus } from "@/types/canonical";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

const SPREAD_TYPE_VALUES = [
  "cash_carry",
  "funding",
  "cross_exchange",
  "calendar",
  "dex_cex",
] as const;
type MatcherSpreadType = (typeof SPREAD_TYPE_VALUES)[number];
function isSpreadType(v: string): v is MatcherSpreadType {
  return (SPREAD_TYPE_VALUES as readonly string[]).includes(v);
}

const MATCHER_TO_DB_TYPE: Record<MatcherSpreadType,
  "cash_carry" | "funding_capture" | "cross_exchange_perp_arb" | "calendar" | "dex_cex_arb"
> = {
  cash_carry: "cash_carry",
  funding: "funding_capture",
  cross_exchange: "cross_exchange_perp_arb",
  calendar: "calendar",
  dex_cex: "dex_cex_arb",
};

// Field names round-tripped through the GET-form submit on /fields. Stays in
// sync with that page's input names + the action's decoder.
const SPREAD_FIELDS = [
  "legs",
  "matcher",
  "spreadType",
  "name",
  "variant",
  "variantCanonical",
  "status",
  "openedAt",
  "closedAt",
  "capital",
  "netPnl",
  "fees",
  "thesis",
  "strategyTag",
  "regimeTags",
  "primaryBase",
  "legCount",
  // Open-intent
  "targetAprAtOpen",
  "expectedHoldingDays",
  "expectedBasisConvergenceDate",
  "borrowCostAssumedBps",
  "closeThresholdApr",
  "closeThresholdPeriods",
  "maxGasBudgetUsd",
  "slippageToleranceBps",
  "edit",
] as const;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return fallback;
}

function getAllStr(sp: Awaited<Search>, key: string): string[] {
  const v = sp[key];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
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

function fmtCapital(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPrice(n: string) {
  const v = Number.parseFloat(n);
  if (!Number.isFinite(v)) return n;
  if (v < 1) return v.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtQty(n: string) {
  const v = Number.parseFloat(n);
  if (!Number.isFinite(v)) return n;
  if (v >= 1_000_000) return v.toExponential(2);
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v < 1) return v.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
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

function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || tb <= ta) return 0;
  return (tb - ta) / (1000 * 60 * 60 * 24);
}

function fmtDays(d: number, t: Awaited<ReturnType<typeof getT>>): string {
  if (d === 0) return "—";
  if (d < 1) {
    const hours = d * 24;
    if (hours < 1)
      return t("wizard.spread.review.duration.minutes", {
        value: Math.round(hours * 60),
      });
    return t("wizard.spread.review.duration.hours", {
      value: hours.toFixed(1),
    });
  }
  if (d < 30)
    return t("wizard.spread.review.duration.days", { value: d.toFixed(1) });
  return t("wizard.spread.review.duration.days", { value: d.toFixed(0) });
}

function asStatus(s: string): ActivityStatus {
  if (
    s === "open" ||
    s === "winding_down" ||
    s === "orphaned" ||
    s === "expired" ||
    s === "closed"
  )
    return s;
  return "closed";
}

export default async function SpreadReviewPage(props: { searchParams: Search }) {
  const sp = await props.searchParams;
  const t = await getT();
  const { id: userId } = await requireUser();

  const STEP_LABELS = [
    t("wizard.spread.stepLabels.source"),
    t("wizard.spread.stepLabels.pickLegs"),
    t("wizard.spread.stepLabels.type"),
    t("wizard.spread.stepLabels.fields"),
    t("wizard.spread.stepLabels.review"),
  ] as const;

  // Round-trip legs via positionId list (preferred) — fall back to single-key
  // CSV that older /fields-emitted URLs may still use.
  const legsCsv = getStr(sp, "legs");
  const legPositionIds = [
    ...getAllStr(sp, "legPositionId"),
    ...legsCsv.split(","),
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  const legRoles = getAllStr(sp, "legRole");
  const uniqueLegIds = [...new Set(legPositionIds)];
  const legRows: PickerOptionRow[] =
    uniqueLegIds.length > 0
      ? await getPickerOptionsByPositionIds(userId, uniqueLegIds)
      : [];

  const v = {
    spreadType: getStr(sp, "spreadType"),
    matcher: getStr(sp, "matcher"),
    name: getStr(sp, "name"),
    variant: getStr(sp, "variant"),
    variantCanonical: getStr(sp, "variantCanonical"),
    status: getStr(sp, "status") || "closed",
    openedAt: getStr(sp, "openedAt"),
    closedAt: getStr(sp, "closedAt"),
    capital: getStr(sp, "capital"),
    netPnl: getStr(sp, "netPnl"),
    fees: getStr(sp, "fees") || "0",
    strategyTag: getStr(sp, "strategyTag"),
    thesis: getStr(sp, "thesis"),
    regimeTags: getStr(sp, "regimeTags"),
    targetAprAtOpen: getStr(sp, "targetAprAtOpen"),
    expectedHoldingDays: getStr(sp, "expectedHoldingDays"),
    expectedBasisConvergenceDate: getStr(sp, "expectedBasisConvergenceDate"),
    borrowCostAssumedBps: getStr(sp, "borrowCostAssumedBps"),
    closeThresholdApr: getStr(sp, "closeThresholdApr"),
    closeThresholdPeriods: getStr(sp, "closeThresholdPeriods"),
    maxGasBudgetUsd: getStr(sp, "maxGasBudgetUsd"),
    slippageToleranceBps: getStr(sp, "slippageToleranceBps"),
  };
  const status = asStatus(v.status);

  const capital = parseNum(v.capital);
  const netPnl = parseNum(v.netPnl);
  const fees = parseNum(v.fees);
  const days = daysBetween(v.openedAt, v.closedAt);

  // Build the "Edit all" link with every field round-tripped back to /fields.
  // Important: include empty strings so cleared values stay cleared.
  const editParams = new URLSearchParams();
  for (const k of SPREAD_FIELDS) {
    const val = getStr(sp, k);
    editParams.append(k, val);
  }
  // Carry per-leg metadata too so back-nav doesn't drop intended_price inputs.
  for (const pid of legPositionIds) editParams.append("legPositionId", pid);
  for (const r of legRoles) editParams.append("legRole", r);
  for (const pid of uniqueLegIds) {
    const v = getStr(sp, `legIntended:${pid}`);
    if (v) editParams.append(`legIntended:${pid}`, v);
  }
  const editAllHref = `/add/spread/fields?${editParams.toString()}`;
  const isEditing = getStr(sp, "edit") !== "";

  // Pre-compute card preview inputs from the formula in spread_pnl.
  const dbSpreadType = isSpreadType(v.spreadType)
    ? MATCHER_TO_DB_TYPE[v.spreadType]
    : null;
  const subtitle = (() => {
    const venues = [...new Set(legRows.map((l) => l.exchangeCode))].join(" + ");
    const variantLabel = v.variantCanonical || v.variant;
    if (venues && variantLabel) return `${variantLabel} · ${venues}`;
    return venues || variantLabel || "";
  })();
  const primaryBase = (() => {
    const fromForm = getStr(sp, "primaryBase");
    if (fromForm) return fromForm.toUpperCase();
    if (legRows[0]?.symbol) return legRows[0].symbol.split(/[-/]/)[0].toUpperCase();
    return v.name?.split(/[\s·-]/)[0]?.toUpperCase() ?? "";
  })();

  // Validation surface — the action redirects back with `?error=<...>` when
  // it fails to commit. Split on newlines so multiline errors render.
  const errorLines = (getStr(sp, "error") || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <WizardShell
      type="spread"
      step={5}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={
        isEditing
          ? t("wizard.spread.review.titleEdit")
          : t("wizard.spread.review.titleNew")
      }
      subtitle={
        isEditing
          ? t("wizard.spread.review.subtitleEdit")
          : t("wizard.spread.review.subtitleNew")
      }
    >
      {errorLines.length > 0 && (
        <WizardValidationSummary
          errors={errorLines.map((m) => ({ message: m }))}
          className="mb-6"
        />
      )}

      {/* ── Card preview — exactly what /spreads/archive will render. ──── */}
      <section className="mb-10">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.spread.review.cardPreviewCaption")}
        </p>
        <WizardCardPreview
          activityType="spread"
          name={v.name}
          status={status}
          subtype={{
            capital,
            netPnl,
            daysHeld: days || null,
            symbol: primaryBase || null,
            subtitle: subtitle || null,
            spreadType: dbSpreadType,
          }}
        />
      </section>

      {/* ── Identity ──────────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.spread.review.sections.identity")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.spread.review.rows.name")}
            value={v.name || "—"}
            editHref={editAllHref}
            mono={false}
          />
          <WizardSummaryRow
            label={t("wizard.spread.review.rows.status")}
            value={
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text">
                {status.replace("_", " ")}
              </span>
            }
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.spread.review.rows.variant")}
            value={v.variantCanonical || v.variant || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.spread.review.rows.type")}
            value={
              isSpreadType(v.spreadType)
                ? t(`wizard.shell.spreadTypeLabels.${v.spreadType}` as const)
                : "—"
            }
            editHref={editAllHref}
          />
          {v.strategyTag && (
            <WizardSummaryRow
              label={t("wizard.spread.review.rows.strategyTag")}
              value={v.strategyTag}
              editHref={editAllHref}
            />
          )}
          {v.matcher && (
            <WizardSummaryRow
              label={t("wizard.spread.review.rows.source")}
              value={
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                  {v.matcher === "auto"
                    ? t("wizard.spread.review.sourceValue.matcher")
                    : t("wizard.spread.review.sourceValue.manual")}
                </span>
              }
            />
          )}
        </div>
      </section>

      {/* ── Legs ──────────────────────────────────────────────────────── */}
      {legRows.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            {t("wizard.spread.review.legsHeading", { count: legRows.length })}
          </h2>
          <div className="overflow-hidden rounded-md border border-border bg-surface">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead
                    scope="col"
                    className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
                  >
                    {t("wizard.spread.review.legsTable.symbol")}
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
                  >
                    {t("wizard.spread.review.legsTable.venue")}
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
                  >
                    {t("wizard.spread.review.legsTable.side")}
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
                  >
                    {t("wizard.spread.review.legsTable.qty")}
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
                  >
                    {t("wizard.spread.review.legsTable.entryExit")}
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
                  >
                    {t("wizard.spread.review.legsTable.intended")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {legRows.map((l) => {
                  const intended = getStr(sp, `legIntended:${l.positionId}`);
                  return (
                    <TableRow key={l.positionId} className="hover:bg-transparent">
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-serif text-[13px] font-medium text-text">
                            {l.symbol}
                          </span>
                          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
                            {l.instrumentKind}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-text-secondary">
                        {l.exchangeCode}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "font-mono text-[10px] uppercase tracking-[0.14em]",
                            l.side === "long" ? "text-up" : "text-down",
                          )}
                        >
                          {l.side}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular-nums text-text-secondary">
                        {fmtQty(l.qty)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono text-[11px] tabular-nums text-text">
                          {fmtPrice(l.avgEntryPrice)}
                        </span>
                        {l.avgExitPrice && (
                          <>
                            <span className="mx-1 text-text-tertiary">→</span>
                            <span className="font-mono text-[11px] tabular-nums text-text-secondary">
                              {fmtPrice(l.avgExitPrice)}
                            </span>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular-nums text-text">
                        {intended ? fmtPrice(intended) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* ── Numbers + timing + open-intent ─────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.spread.review.sections.numbers")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.spread.review.rows.capital")}
            value={capital > 0 ? fmtCapital(capital) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.spread.review.rows.netPnl")}
            value={v.netPnl ? fmtUsd(netPnl, true) : "—"}
            tone={v.netPnl ? (netPnl >= 0 ? "up" : "down") : undefined}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.spread.review.rows.fees")}
            value={fees > 0 ? fmtUsd(fees) : "—"}
            editHref={editAllHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.spread.review.sections.timing")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.spread.review.rows.opened")}
            value={fmtDate(v.openedAt)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.spread.review.rows.closed")}
            value={fmtDate(v.closedAt)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.spread.review.rows.daysHeld")}
            value={days > 0 ? fmtDays(days, t) : "—"}
          />
        </div>

        {/* Open-intent rows — surface only the populated ones. */}
        {(v.targetAprAtOpen ||
          v.expectedHoldingDays ||
          v.expectedBasisConvergenceDate ||
          v.borrowCostAssumedBps ||
          v.closeThresholdApr ||
          v.closeThresholdPeriods ||
          v.maxGasBudgetUsd ||
          v.slippageToleranceBps) && (
          <>
            <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("wizard.spread.review.sections.openIntent")}
            </h2>
            <div>
              {v.targetAprAtOpen && (
                <WizardSummaryRow
                  label={t("wizard.spread.review.rows.targetAprAtOpen")}
                  value={`${(parseNum(v.targetAprAtOpen) * 100).toFixed(2)}%`}
                  editHref={editAllHref}
                />
              )}
              {v.expectedHoldingDays && (
                <WizardSummaryRow
                  label={t("wizard.spread.review.rows.expectedHoldingDays")}
                  value={`${v.expectedHoldingDays} d`}
                  editHref={editAllHref}
                />
              )}
              {v.expectedBasisConvergenceDate && (
                <WizardSummaryRow
                  label={t("wizard.spread.review.rows.expectedBasisConvergenceDate")}
                  value={v.expectedBasisConvergenceDate}
                  editHref={editAllHref}
                />
              )}
              {v.borrowCostAssumedBps && (
                <WizardSummaryRow
                  label={t("wizard.spread.review.rows.borrowCostAssumedBps")}
                  value={`${v.borrowCostAssumedBps} bps`}
                  editHref={editAllHref}
                />
              )}
              {v.closeThresholdApr && (
                <WizardSummaryRow
                  label={t("wizard.spread.review.rows.closeThresholdApr")}
                  value={`${(parseNum(v.closeThresholdApr) * 100).toFixed(2)}%`}
                  editHref={editAllHref}
                />
              )}
              {v.closeThresholdPeriods && (
                <WizardSummaryRow
                  label={t("wizard.spread.review.rows.closeThresholdPeriods")}
                  value={`${v.closeThresholdPeriods} periods`}
                  editHref={editAllHref}
                />
              )}
              {v.maxGasBudgetUsd && (
                <WizardSummaryRow
                  label={t("wizard.spread.review.rows.maxGasBudgetUsd")}
                  value={fmtUsd(parseNum(v.maxGasBudgetUsd))}
                  editHref={editAllHref}
                />
              )}
              {v.slippageToleranceBps && (
                <WizardSummaryRow
                  label={t("wizard.spread.review.rows.slippageToleranceBps")}
                  value={`${v.slippageToleranceBps} bps`}
                  editHref={editAllHref}
                />
              )}
            </div>
          </>
        )}

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.spread.review.sections.thesisAndTags")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.spread.review.rows.regimeTags")}
            value={v.regimeTags || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.spread.review.rows.thesis")}
            value={v.thesis || "—"}
            editHref={editAllHref}
            mono={false}
          />
        </div>
      </section>

      {/* ── Post-submit hint: screenshot/satisfaction/tag editor ─────── */}
      <aside className="mt-10 rounded-md border border-dashed border-border bg-surface p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
          {t("wizard.spread.review.postSubmitHint.label")}
        </p>
        <p className="mt-2 font-serif text-[12px] italic leading-snug text-text-secondary">
          {t("wizard.spread.review.postSubmitHint.body")}
        </p>
      </aside>

      {/* ── Submit ────────────────────────────────────────────────────── */}
      <form action={logSpread} className="mt-10">
        {/* Top-level scalar fields */}
        {SPREAD_FIELDS.map((k) => (
          <input key={k} type="hidden" name={k} value={getStr(sp, k)} />
        ))}
        {/* Per-leg arrays — positionId / role / intendedPrice */}
        {legPositionIds.map((pid, i) => (
          <input
            key={`legPid-${i}`}
            type="hidden"
            name="legPositionId"
            value={pid}
          />
        ))}
        {legRoles.map((role, i) => (
          <input
            key={`legRole-${i}`}
            type="hidden"
            name="legRole"
            value={role}
          />
        ))}
        {uniqueLegIds.map((pid) => {
          const intended = getStr(sp, `legIntended:${pid}`);
          return (
            <input
              key={`legIntended-${pid}`}
              type="hidden"
              name="legIntendedPrice"
              value={intended}
            />
          );
        })}

        <div className="flex items-center justify-between border-t border-border pt-6">
          <Link
            href={editAllHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("wizard.spread.review.back")}
          </Link>
          <WizardSubmitButton>
            {isEditing
              ? t("wizard.spread.review.submitEdit")
              : t("wizard.spread.review.submitNew")}
          </WizardSubmitButton>
        </div>
      </form>
    </WizardShell>
  );
}
