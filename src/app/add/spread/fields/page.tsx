import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import {
  WizardField,
  WizardInput,
  WizardTextarea,
} from "@/components/wizard/wizard-field";
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
import { requireUser } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { ManualLegBuilder, type ManualLegInput } from "@/components/spread/manual-leg-builder";
import {
  getPickerOptionsByPositionIds,
  getSpreadForEdit,
  getStrategyTagSuggestions,
  type PickerOptionRow,
} from "../db";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const DB_TO_MATCHER_TYPE: Record<string, MatcherSpreadType> = {
  cash_carry: "cash_carry",
  funding_capture: "funding",
  cross_exchange_perp_arb: "cross_exchange",
  calendar: "calendar",
  dex_cex_arb: "dex_cex",
};

const SPREAD_STATUSES = ["open", "winding_down", "orphaned", "expired", "closed"] as const;

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

function parseLegIds(sp: Awaited<Search>): string[] {
  const raw = [...getAllStr(sp, "legs"), getStr(sp, "legs")]
    .filter((s) => s.length > 0)
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(raw)];
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

function isoToDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function suggestName(legs: PickerOptionRow[], spreadType: string): string {
  if (legs.length === 0) return "";
  const asset = legs[0]?.symbol ?? "";
  const venues = [...new Set(legs.map((l) => l.exchangeCode))].join(" + ");
  return `${asset} ${spreadType || "spread"} · ${venues}`;
}

function suggestNameManual(legs: ManualLegInput[], spreadType: string): string {
  if (legs.length === 0) return "";
  const asset = legs[0]?.symbol ?? "";
  const venues = [...new Set(legs.map((l) => l.exchange).filter(Boolean))].join(" + ");
  return `${asset} ${spreadType || "spread"}${venues ? " · " + venues : ""}`;
}

function earliestOpened(legs: PickerOptionRow[]): string {
  if (legs.length === 0) return "";
  return legs.map((l) => l.openedAt).sort()[0] ?? "";
}

function latestClosed(legs: PickerOptionRow[]): string {
  if (legs.length === 0) return "";
  const closed = legs.map((l) => l.closedAt).filter((x): x is string => !!x);
  if (closed.length === 0) return "";
  return closed.sort().at(-1) ?? "";
}

function deriveDefaultStatus(legs: PickerOptionRow[]): string {
  if (legs.length === 0) return "open";
  const allClosed = legs.every((l) => l.status === "closed");
  if (allClosed) return "closed";
  const someClosed = legs.some((l) => l.status === "closed");
  if (someClosed) return "winding_down";
  return "open";
}

// ── Manual-leg derived values ─────────────────────────────────────────────────

function parseD(s: string | undefined): number {
  if (!s) return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function manualLegPnl(leg: ManualLegInput): number | null {
  const qty = parseD(leg.qty);
  const entry = parseD(leg.entryPrice);
  const exit = parseD(leg.exitPrice);
  const fees = parseD(leg.feesUsd);
  if (!qty || !entry || !exit) return null;
  const dir = leg.side === "long" ? 1 : -1;
  return (exit - entry) * qty * dir - fees;
}

function manualLegsCapital(legs: ManualLegInput[]): string {
  const total = legs.reduce(
    (acc, l) => acc + Math.abs(parseD(l.qty) * parseD(l.entryPrice)),
    0,
  );
  return total > 0 ? total.toFixed(2) : "";
}

function manualLegsPnl(legs: ManualLegInput[]): string {
  let hasAny = false;
  let total = 0;
  for (const l of legs) {
    const p = manualLegPnl(l);
    if (p !== null) {
      hasAny = true;
      total += p;
    }
  }
  return hasAny ? total.toFixed(2) : "";
}

function manualLegsFees(legs: ManualLegInput[]): string {
  const total = legs.reduce((acc, l) => acc + parseD(l.feesUsd), 0);
  return total > 0 ? total.toFixed(2) : "0";
}

function parseManualLegs(json: string): ManualLegInput[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return (parsed as ManualLegInput[]).map((l) => ({
      _id: Math.random().toString(36).slice(2, 10),
      symbol: l.symbol ?? "",
      exchange: l.exchange ?? "",
      side: l.side === "short" ? "short" : "long",
      qty: l.qty ?? "",
      entryPrice: l.entryPrice ?? "",
      exitPrice: l.exitPrice ?? "",
      feesUsd: l.feesUsd ?? "",
      instrumentType:
        l.instrumentType === "spot" || l.instrumentType === "dated_future"
          ? l.instrumentType
          : "perp",
    }));
  } catch {
    return [];
  }
}

/**
 * Per-type field gating. Returns the set of open-intent fields that should
 * be surfaced for the chosen DB spread_type. Mirrors §0 of the master plan:
 *  - cash_carry / basis → expected_basis_convergence_date, borrow_cost
 *  - funding_capture    → close_threshold_apr, close_threshold_periods
 *  - dex_cex_arb        → max_gas_budget_usd, slippage_tolerance_bps
 *  - cross_exchange     → slippage_tolerance_bps
 *  - calendar           → expected_basis_convergence_date
 *
 * target_apr_at_open + expected_holding_days surface on every type since
 * the post-trade review uses them for "did the thesis hold" framing.
 */
function gatesFor(matcherType: string, variant: string | null): {
  showTargetApr: boolean;
  showHoldingDays: boolean;
  showBasisConvergence: boolean;
  showBorrowCost: boolean;
  showCloseThreshold: boolean;
  showGasBudget: boolean;
  showSlippageTolerance: boolean;
} {
  const isCashCarry = matcherType === "cash_carry";
  const isFunding = matcherType === "funding";
  const isCrossEx = matcherType === "cross_exchange";
  const isCalendar = matcherType === "calendar";
  const isDexCex = matcherType === "dex_cex";

  return {
    showTargetApr: true,
    showHoldingDays: true,
    showBasisConvergence:
      (isCashCarry && variant === "basis") || isCalendar,
    showBorrowCost: isCashCarry,
    showCloseThreshold: isFunding,
    showGasBudget: isDexCex,
    showSlippageTolerance: isCrossEx || isDexCex,
  };
}

interface FieldDefaults {
  name: string;
  variant: string;
  variantCanonical: string;
  openedAt: string;
  closedAt: string;
  capital: string;
  netPnl: string;
  fees: string;
  status: string;
  strategyTag: string;
  thesis: string;
  regimeTags: string;
  // open-intent
  targetAprAtOpen: string;
  expectedHoldingDays: string;
  expectedBasisConvergenceDate: string;
  borrowCostAssumedBps: string;
  closeThresholdApr: string;
  closeThresholdPeriods: string;
  maxGasBudgetUsd: string;
  slippageToleranceBps: string;
  // edit-mode metadata
  serial: string;
}

export default async function SpreadFieldsPage(props: { searchParams: Search }) {
  const sp = await props.searchParams;
  const t = await getT();
  const editId = getStr(sp, "edit");

  const STEP_LABELS = [
    t("wizard.spread.stepLabels.source"),
    t("wizard.spread.stepLabels.pickLegs"),
    t("wizard.spread.stepLabels.type"),
    t("wizard.spread.stepLabels.fields"),
    t("wizard.spread.stepLabels.review"),
  ] as const;

  // ── Edit-mode pre-fill from DB ───────────────────────────────────────────
  let dbDefaults: Partial<FieldDefaults> & { spreadType?: string } = {};
  let dbLegs: PickerOptionRow[] = [];
  const dbLegMap = new Map<string, { intendedPrice: string | null; role: string }>();
  let editValid = false;
  const { id: userId } = await requireUser();

  if (editId && UUID_RE.test(editId)) {
    const view = await getSpreadForEdit(userId, editId);
    if (view) {
      dbDefaults = {
        name: view.name,
        variant: view.variant ?? "",
        variantCanonical: view.variant ?? "",
        status: view.status,
        openedAt: isoToDateTimeLocal(view.openedAt),
        closedAt: isoToDateTimeLocal(view.closedAt),
        capital: view.capitalDeployedUsd ?? "",
        netPnl: view.netPnlUsd ?? "",
        fees: view.feesUsd ?? "0",
        thesis: view.exitPlan ?? "",
        regimeTags: view.regimeTags.join(", "),
        strategyTag: view.strategyTag ?? "",
        spreadType: DB_TO_MATCHER_TYPE[view.spreadType] ?? "",
        targetAprAtOpen: view.targetAprAtOpen ?? "",
        expectedHoldingDays:
          view.expectedHoldingDays != null ? String(view.expectedHoldingDays) : "",
        expectedBasisConvergenceDate: view.expectedBasisConvergenceDate ?? "",
        borrowCostAssumedBps: view.borrowCostAssumedBps ?? "",
        closeThresholdApr: view.closeThresholdApr ?? "",
        closeThresholdPeriods:
          view.closeThresholdPeriods != null
            ? String(view.closeThresholdPeriods)
            : "",
        maxGasBudgetUsd: view.maxGasBudgetUsd ?? "",
        slippageToleranceBps: view.slippageToleranceBps ?? "",
        serial: view.activityId.slice(0, 4).toUpperCase(),
      };
      // Carry the joined legs through so the table renders the existing
      // position rows on edit.
      const ids = view.legs.map((l) => l.positionId);
      dbLegs = await getPickerOptionsByPositionIds(userId, ids);
      for (const l of view.legs) {
        dbLegMap.set(l.positionId, {
          intendedPrice: l.intendedPrice ?? null,
          role: l.role,
        });
      }
      editValid = true;
    }
  }

  // ── Source detection ──────────────────────────────────────────────────────
  const source = getStr(sp, "source"); // "manual" on the manual path
  const isManual = source === "manual" && !editValid;

  // ── Manual path: parse leg JSON from hidden input (back-nav round-trip). ──
  const manualLegsJson = getStr(sp, "manualLegsJson");
  const manualLegs: ManualLegInput[] = isManual ? parseManualLegs(manualLegsJson) : [];

  // ── URL-mode legs (picker / auto flow) ────────────────────────────────────
  const legIds = parseLegIds(sp);
  // Empty-string pass-through prevention: if every input cleared and the user
  // bounced back, we still want the form to render. legs only matters for the
  // legs table; the form itself is independent.
  const urlLegs = legIds.length > 0
    ? await getPickerOptionsByPositionIds(userId, legIds)
    : [];
  const legs = editValid ? dbLegs : urlLegs;
  const missing = editValid
    ? []
    : legIds.filter((id) => !urlLegs.some((l) => l.positionId === id));

  const spreadType = getStr(sp, "spreadType") || dbDefaults.spreadType || "";
  const matcher = getStr(sp, "matcher");
  const variantCanonical = getStr(sp, "variantCanonical") || dbDefaults.variantCanonical || "";

  // ── Defaults (manual path derives capital + pnl from entered legs) ────────
  const derivedCapital = isManual ? manualLegsCapital(manualLegs) : "";
  const derivedPnl = isManual ? manualLegsPnl(manualLegs) : "";
  const derivedFees = isManual ? manualLegsFees(manualLegs) : "0";
  const derivedName = isManual ? suggestNameManual(manualLegs, spreadType) : "";

  // ── Defaults ─────────────────────────────────────────────────────────────
  const defaults: FieldDefaults = {
    name:
      getStr(sp, "name") ||
      dbDefaults.name ||
      (isManual ? derivedName : suggestName(legs, spreadType)),
    variant: getStr(sp, "variant") || dbDefaults.variant || "",
    variantCanonical,
    openedAt:
      getStr(sp, "openedAt") || dbDefaults.openedAt || earliestOpened(legs).slice(0, 16),
    closedAt:
      getStr(sp, "closedAt") || dbDefaults.closedAt || latestClosed(legs).slice(0, 16),
    capital: getStr(sp, "capital") || dbDefaults.capital || derivedCapital,
    netPnl: getStr(sp, "netPnl") || dbDefaults.netPnl || derivedPnl,
    fees: getStr(sp, "fees") || dbDefaults.fees || derivedFees,
    status: getStr(sp, "status") || dbDefaults.status || (isManual ? "closed" : deriveDefaultStatus(legs)),
    strategyTag: getStr(sp, "strategyTag") || dbDefaults.strategyTag || "",
    thesis: getStr(sp, "thesis") || dbDefaults.thesis || "",
    regimeTags: getStr(sp, "regimeTags") || dbDefaults.regimeTags || "",
    targetAprAtOpen: getStr(sp, "targetAprAtOpen") || dbDefaults.targetAprAtOpen || "",
    expectedHoldingDays:
      getStr(sp, "expectedHoldingDays") || dbDefaults.expectedHoldingDays || "",
    expectedBasisConvergenceDate:
      getStr(sp, "expectedBasisConvergenceDate") ||
      dbDefaults.expectedBasisConvergenceDate ||
      "",
    borrowCostAssumedBps:
      getStr(sp, "borrowCostAssumedBps") || dbDefaults.borrowCostAssumedBps || "",
    closeThresholdApr:
      getStr(sp, "closeThresholdApr") || dbDefaults.closeThresholdApr || "",
    closeThresholdPeriods:
      getStr(sp, "closeThresholdPeriods") || dbDefaults.closeThresholdPeriods || "",
    maxGasBudgetUsd:
      getStr(sp, "maxGasBudgetUsd") || dbDefaults.maxGasBudgetUsd || "",
    slippageToleranceBps:
      getStr(sp, "slippageToleranceBps") || dbDefaults.slippageToleranceBps || "",
    serial: dbDefaults.serial ?? "",
  };

  const gates = gatesFor(spreadType, defaults.variantCanonical || null);

  // Empty state — user reached /fields without any legs AND isn't editing AND
  // isn't on the manual path (manual path never needs pre-existing legs).
  if (!editValid && !isManual && legs.length === 0 && legIds.length === 0) {
    return (
      <WizardShell
        type="spread"
        step={4}
        totalSteps={5}
        stepLabels={STEP_LABELS}
        title={t("wizard.spread.fields.empty.title")}
        subtitle={t("wizard.spread.fields.empty.subtitle")}
      >
        <div className="rounded-md border border-dashed border-border bg-surface p-8 text-center">
          <p className="font-serif text-[14px] italic text-text-tertiary">
            {t("wizard.spread.fields.empty.body")}
          </p>
          <Link
            href="/add/spread/pick"
            className="mt-4 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text underline-offset-4 hover:underline"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("wizard.spread.fields.empty.backLink")}
          </Link>
        </div>
      </WizardShell>
    );
  }

  // ── Strategy-tag suggestions for autocomplete <datalist> ────────────────
  const strategyTagSuggestions = await getStrategyTagSuggestions(userId);

  const backHref = editValid
    ? `/spreads/${editId}`
    : isManual
      ? `/add/spread/type?${new URLSearchParams({
          source: "manual",
          ...(spreadType ? { spreadType } : {}),
        }).toString()}`
      : `/add/spread/type?${new URLSearchParams({
          legs: legIds.join(","),
          ...(matcher ? { matcher } : {}),
          ...(spreadType ? { spreadType } : {}),
        }).toString()}`;

  // Server-side validation errors carried over via `?fieldErrors=`
  const fieldErrors = getAllStr(sp, "fieldError")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <WizardShell
      type="spread"
      step={4}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={
        editValid
          ? t("wizard.spread.fields.titleEdit")
          : t("wizard.spread.fields.titleNew")
      }
      subtitle={
        editValid
          ? t("wizard.spread.fields.subtitleEdit")
          : t("wizard.spread.fields.subtitleNew")
      }
    >
      {fieldErrors.length > 0 && (
        <WizardValidationSummary
          errors={fieldErrors.map((m) => ({ message: m }))}
          className="mb-6"
        />
      )}

      {editValid && (
        <aside
          className="mb-6 rounded-md border border-warn/30 bg-warn/5 px-4 py-2.5 text-[12px] text-warn"
          role="status"
        >
          <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">
            {t("wizard.spread.fields.editBanner.label")}
          </span>
          {" — "}
          <span className="font-serif italic">
            {t("wizard.spread.fields.editBanner.body", {
              serial: defaults.serial,
            })}
          </span>
        </aside>
      )}

      {/* ── Legs section — branches on manual vs auto path ──────────────── */}
      <section className="mb-10">
        <h2 className="mb-3 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.spread.fields.sections.legs")}
        </h2>

        {isManual ? (
          /* Manual path: interactive leg builder island */
          <ManualLegBuilder
            name="manualLegsJson"
            formId="spread-fields-form"
            defaultValue={manualLegsJson || undefined}
            labels={{
              addLeg: t("wizard.spread.fields.manualLegs.addLeg"),
              removeLeg: t("wizard.spread.fields.manualLegs.removeLeg"),
              legN: t("wizard.spread.fields.manualLegs.legN"),
              symbol: t("wizard.spread.fields.manualLegs.leg.symbol"),
              exchange: t("wizard.spread.fields.manualLegs.leg.exchange"),
              sideLong: t("wizard.spread.fields.manualLegs.leg.sideLong"),
              sideShort: t("wizard.spread.fields.manualLegs.leg.sideShort"),
              qty: t("wizard.spread.fields.manualLegs.leg.qty"),
              entryPrice: t("wizard.spread.fields.manualLegs.leg.entryPrice"),
              exitPrice: t("wizard.spread.fields.manualLegs.leg.exitPrice"),
              feesUsd: t("wizard.spread.fields.manualLegs.leg.feesUsd"),
              instrumentSpot: t("wizard.spread.fields.manualLegs.leg.instrumentSpot"),
              instrumentPerp: t("wizard.spread.fields.manualLegs.leg.instrumentPerp"),
              instrumentDatedFuture: t("wizard.spread.fields.manualLegs.leg.instrumentDatedFuture"),
              computedPnl: t("wizard.spread.fields.manualLegs.computedPnl"),
              totalPnl: t("wizard.spread.fields.manualLegs.totalPnl"),
              totalCapital: t("wizard.spread.fields.manualLegs.totalCapital"),
              atLeastOne: t("wizard.spread.fields.manualLegs.atLeastOne"),
            }}
          />
        ) : (
          /* Auto / edit path: read-only legs table from picker/DB */
          <>
            <div className="overflow-hidden rounded-md border border-border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead
                      scope="col"
                      className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
                    >
                      {t("wizard.spread.fields.legsTable.symbol")}
                    </TableHead>
                    <TableHead
                      scope="col"
                      className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
                    >
                      {t("wizard.spread.fields.legsTable.venue")}
                    </TableHead>
                    <TableHead
                      scope="col"
                      className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
                    >
                      {t("wizard.spread.fields.legsTable.side")}
                    </TableHead>
                    <TableHead
                      scope="col"
                      className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
                    >
                      {t("wizard.spread.fields.legsTable.qty")}
                    </TableHead>
                    <TableHead
                      scope="col"
                      className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
                    >
                      {t("wizard.spread.fields.legsTable.entryExit")}
                    </TableHead>
                    <TableHead
                      scope="col"
                      className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary"
                    >
                      {t("wizard.spread.fields.legsTable.intendedPrice")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {legs.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={6}
                        className="py-6 text-center font-serif text-[12px] italic text-text-tertiary"
                      >
                        {t("wizard.spread.fields.legsTable.noLegs")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    legs.map((l) => {
                      const prior = dbLegMap.get(l.positionId);
                      const defaultIntended =
                        getStr(sp, `legIntended:${l.positionId}`) ||
                        prior?.intendedPrice ||
                        "";
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
                          <TableCell className="text-right">
                            <input
                              form="spread-fields-form"
                              type="number"
                              step="any"
                              inputMode="decimal"
                              name={`legIntended:${l.positionId}`}
                              defaultValue={defaultIntended}
                              placeholder="—"
                              aria-label={t("wizard.spread.fields.legsTable.intendedPriceAria", {
                                symbol: l.symbol,
                              })}
                              className="w-28 rounded-md border border-border bg-surface px-2 py-1 text-right font-mono text-[11px] text-text placeholder:text-text-disabled focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-text"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            {missing.length > 0 && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-down">
                {t.plural("wizard.spread.fields.missingLegs", missing.length, {
                  ids: missing.join(", "),
                })}
              </p>
            )}
            <p className="mt-3 font-serif text-[12px] italic text-text-tertiary">
              {t("wizard.spread.fields.spreadTypeLabel")}{" "}
              <span className="not-italic font-medium text-text">
                {isSpreadType(spreadType)
                  ? t(`wizard.shell.spreadTypeLabels.${spreadType}` as const)
                  : t("wizard.spread.fields.spreadTypeNotPicked")}
              </span>
              {matcher === "auto" && (
                <span className="ml-2 rounded bg-signature/15 px-1.5 py-px font-mono text-[9px] not-italic uppercase tracking-[0.14em] text-signature">
                  {t("wizard.spread.fields.matcherBadge")}
                </span>
              )}
            </p>
            <p className="mt-2 font-serif text-[11px] italic leading-snug text-text-tertiary">
              {t("wizard.spread.fields.intendedPriceHint")}
            </p>
          </>
        )}
      </section>

      {/* ── Form ─────────────────────────────────────────────────────────── */}
      <form
        id="spread-fields-form"
        action="/add/spread/review"
        method="get"
        className="flex flex-col gap-7"
      >
        {/* Pass-through */}
        {editValid && <input type="hidden" name="edit" value={editId} />}
        {isManual ? (
          /* Manual path: carry source tag, no picker leg IDs needed. */
          <input type="hidden" name="source" value="manual" />
        ) : (
          <>
            <input type="hidden" name="legs" value={legIds.join(",")} />
            {matcher && <input type="hidden" name="matcher" value={matcher} />}
          </>
        )}
        {spreadType && (
          <input type="hidden" name="spreadType" value={spreadType} />
        )}
        {/* Auto path: round-trip each leg's positionId + role so /review can
            re-render the per-leg table from URL alone. */}
        {!isManual && legs.map((l) => (
          <input
            key={`pid-${l.positionId}`}
            type="hidden"
            name="legPositionId"
            value={l.positionId}
          />
        ))}
        {!isManual && legs.map((l) => (
          <input
            key={`role-${l.positionId}`}
            type="hidden"
            name="legRole"
            value={dbLegMap.get(l.positionId)?.role ?? l.side}
          />
        ))}
        <input
          type="hidden"
          name="legCount"
          value={isManual ? "" : String(legs.length)}
        />
        <input
          type="hidden"
          name="primaryBase"
          value={
            isManual
              ? (manualLegs[0]?.symbol?.split(/[-/]/)[0] ?? "")
              : (legs[0]?.symbol?.split(/[-/]/)[0] ?? "")
          }
        />

        <SectionLabel>{t("wizard.spread.fields.sections.identity")}</SectionLabel>
        <WizardField
          label={t("wizard.spread.fields.name.label")}
          htmlFor="name"
          helper={t("wizard.spread.fields.name.helper")}
          required
        >
          <WizardInput
            id="name"
            name="name"
            defaultValue={defaults.name}
            placeholder={t("wizard.spread.fields.name.placeholder")}
            required
            autoComplete="off"
          />
        </WizardField>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.spread.fields.variant.label")}
            htmlFor="variant"
            helper={t("wizard.spread.fields.variant.helper")}
          >
            <WizardInput
              id="variant"
              name="variant"
              defaultValue={defaults.variant}
              placeholder={t("wizard.spread.fields.variant.placeholder")}
              autoComplete="off"
            />
          </WizardField>
          {/* Variant radio — visible only on cash_carry/funding_capture
              where the DB CHECK enforces canonical values. */}
          {(spreadType === "cash_carry" || spreadType === "funding") && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                {t("wizard.spread.fields.variantCanonical.legend")}
              </legend>
              <div
                role="radiogroup"
                aria-label={t("wizard.spread.fields.variantCanonical.aria")}
                className="grid grid-cols-2 gap-2"
              >
                {(spreadType === "cash_carry"
                  ? (["funding", "basis"] as const)
                  : (["same_venue", "cross_venue"] as const)
                ).map((v) => (
                  <label
                    key={v}
                    className={cn(
                      "flex cursor-pointer items-center justify-center rounded-md border border-border bg-surface px-2 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:border-border-strong hover:text-text",
                      "has-[input:checked]:border-text has-[input:checked]:bg-subtle has-[input:checked]:text-text",
                    )}
                  >
                    <input
                      type="radio"
                      name="variantCanonical"
                      value={v}
                      defaultChecked={defaults.variantCanonical === v}
                      className="sr-only"
                    />
                    {v.replace("_", " ")}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>

        <SectionLabel>{t("wizard.spread.fields.sections.lifecycle")}</SectionLabel>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
            {t("wizard.spread.fields.status.legend")}
            <span className="ml-1.5 text-text-disabled">
              · {t("wizard.spread.fields.status.requiredSuffix")}
            </span>
          </legend>
          <div
            role="radiogroup"
            aria-label={t("wizard.spread.fields.status.aria")}
            className="grid grid-cols-2 gap-2 md:grid-cols-5"
          >
            {SPREAD_STATUSES.map((s) => (
              <label
                key={s}
                className={cn(
                  "flex cursor-pointer items-center justify-center rounded-md border border-border bg-surface px-2 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:border-border-strong hover:text-text",
                  "has-[input:checked]:border-text has-[input:checked]:bg-subtle has-[input:checked]:text-text",
                )}
              >
                <input
                  type="radio"
                  name="status"
                  value={s}
                  defaultChecked={defaults.status === s}
                  required
                  className="sr-only"
                />
                {s.replace("_", " ")}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.spread.fields.openedAt.label")}
            htmlFor="openedAt"
            required
          >
            <WizardInput
              id="openedAt"
              name="openedAt"
              type="datetime-local"
              defaultValue={defaults.openedAt}
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.spread.fields.closedAt.label")}
            htmlFor="closedAt"
            helper={t("wizard.spread.fields.closedAt.helper")}
          >
            <WizardInput
              id="closedAt"
              name="closedAt"
              type="datetime-local"
              defaultValue={defaults.closedAt}
            />
          </WizardField>
        </div>

        <SectionLabel>{t("wizard.spread.fields.sections.numbers")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <WizardField
            label={t("wizard.spread.fields.capital.label")}
            htmlFor="capital"
            helper={t("wizard.spread.fields.capital.helper")}
            required
          >
            <WizardInput
              id="capital"
              name="capital"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.capital}
              placeholder="47300.00"
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.spread.fields.netPnl.label")}
            htmlFor="netPnl"
            helper={t("wizard.spread.fields.netPnl.helper")}
          >
            <WizardInput
              id="netPnl"
              name="netPnl"
              type="number"
              step="0.01"
              inputMode="decimal"
              defaultValue={defaults.netPnl}
              placeholder="1314.40"
            />
          </WizardField>
          <WizardField
            label={t("wizard.spread.fields.fees.label")}
            htmlFor="fees"
            helper={t("wizard.spread.fields.fees.helper")}
          >
            <WizardInput
              id="fees"
              name="fees"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.fees}
              placeholder="42.00"
            />
          </WizardField>
        </div>

        {/* ── Open-intent — per-type gated ──────────────────────────────── */}
        {(gates.showTargetApr ||
          gates.showHoldingDays ||
          gates.showBasisConvergence ||
          gates.showBorrowCost ||
          gates.showCloseThreshold ||
          gates.showGasBudget ||
          gates.showSlippageTolerance) && (
          <>
            <SectionLabel>
              {t("wizard.spread.fields.sections.openIntent")}
            </SectionLabel>
            <p className="-mt-3 font-serif text-[12px] italic leading-snug text-text-tertiary">
              {t("wizard.spread.fields.openIntentHint")}
            </p>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {gates.showTargetApr && (
                <WizardField
                  label={t("wizard.spread.fields.targetAprAtOpen.label")}
                  htmlFor="targetAprAtOpen"
                  helper={t("wizard.spread.fields.targetAprAtOpen.helper")}
                >
                  <WizardInput
                    id="targetAprAtOpen"
                    name="targetAprAtOpen"
                    type="number"
                    step="0.0001"
                    inputMode="decimal"
                    defaultValue={defaults.targetAprAtOpen}
                    placeholder="0.178"
                  />
                </WizardField>
              )}
              {gates.showHoldingDays && (
                <WizardField
                  label={t("wizard.spread.fields.expectedHoldingDays.label")}
                  htmlFor="expectedHoldingDays"
                  helper={t("wizard.spread.fields.expectedHoldingDays.helper")}
                >
                  <WizardInput
                    id="expectedHoldingDays"
                    name="expectedHoldingDays"
                    type="number"
                    step="1"
                    min="1"
                    inputMode="numeric"
                    defaultValue={defaults.expectedHoldingDays}
                    placeholder="14"
                  />
                </WizardField>
              )}
              {gates.showBasisConvergence && (
                <WizardField
                  label={t("wizard.spread.fields.expectedBasisConvergenceDate.label")}
                  htmlFor="expectedBasisConvergenceDate"
                  helper={t("wizard.spread.fields.expectedBasisConvergenceDate.helper")}
                  required={spreadType === "cash_carry" && defaults.variantCanonical === "basis"}
                >
                  <WizardInput
                    id="expectedBasisConvergenceDate"
                    name="expectedBasisConvergenceDate"
                    type="date"
                    defaultValue={defaults.expectedBasisConvergenceDate || isoToDateInput(defaults.closedAt)}
                  />
                </WizardField>
              )}
              {gates.showBorrowCost && (
                <WizardField
                  label={t("wizard.spread.fields.borrowCostAssumedBps.label")}
                  htmlFor="borrowCostAssumedBps"
                  helper={t("wizard.spread.fields.borrowCostAssumedBps.helper")}
                >
                  <WizardInput
                    id="borrowCostAssumedBps"
                    name="borrowCostAssumedBps"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    defaultValue={defaults.borrowCostAssumedBps}
                    placeholder="35"
                  />
                </WizardField>
              )}
              {gates.showCloseThreshold && (
                <>
                  <WizardField
                    label={t("wizard.spread.fields.closeThresholdApr.label")}
                    htmlFor="closeThresholdApr"
                    helper={t("wizard.spread.fields.closeThresholdApr.helper")}
                  >
                    <WizardInput
                      id="closeThresholdApr"
                      name="closeThresholdApr"
                      type="number"
                      step="0.0001"
                      inputMode="decimal"
                      defaultValue={defaults.closeThresholdApr}
                      placeholder="0.05"
                    />
                  </WizardField>
                  <WizardField
                    label={t("wizard.spread.fields.closeThresholdPeriods.label")}
                    htmlFor="closeThresholdPeriods"
                    helper={t("wizard.spread.fields.closeThresholdPeriods.helper")}
                  >
                    <WizardInput
                      id="closeThresholdPeriods"
                      name="closeThresholdPeriods"
                      type="number"
                      step="1"
                      min="1"
                      inputMode="numeric"
                      defaultValue={defaults.closeThresholdPeriods}
                      placeholder="3"
                    />
                  </WizardField>
                </>
              )}
              {gates.showGasBudget && (
                <WizardField
                  label={t("wizard.spread.fields.maxGasBudgetUsd.label")}
                  htmlFor="maxGasBudgetUsd"
                  helper={t("wizard.spread.fields.maxGasBudgetUsd.helper")}
                >
                  <WizardInput
                    id="maxGasBudgetUsd"
                    name="maxGasBudgetUsd"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    defaultValue={defaults.maxGasBudgetUsd}
                    placeholder="40.00"
                  />
                </WizardField>
              )}
              {gates.showSlippageTolerance && (
                <WizardField
                  label={t("wizard.spread.fields.slippageToleranceBps.label")}
                  htmlFor="slippageToleranceBps"
                  helper={t("wizard.spread.fields.slippageToleranceBps.helper")}
                >
                  <WizardInput
                    id="slippageToleranceBps"
                    name="slippageToleranceBps"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    defaultValue={defaults.slippageToleranceBps}
                    placeholder="8"
                  />
                </WizardField>
              )}
            </div>
          </>
        )}

        <SectionLabel>
          {t("wizard.spread.fields.sections.thesisAndTags")}
        </SectionLabel>
        <WizardField
          label={t("wizard.spread.fields.thesis.label")}
          htmlFor="thesis"
          helper={t("wizard.spread.fields.thesis.helper")}
        >
          <WizardTextarea
            id="thesis"
            name="thesis"
            rows={5}
            defaultValue={defaults.thesis}
            placeholder={t("wizard.spread.fields.thesis.placeholder")}
          />
        </WizardField>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.spread.fields.strategyTag.label")}
            htmlFor="strategyTag"
            helper={t("wizard.spread.fields.strategyTag.helper")}
          >
            <WizardInput
              id="strategyTag"
              name="strategyTag"
              defaultValue={defaults.strategyTag}
              placeholder="basis_book"
              list="strategy-tags"
              autoComplete="off"
            />
            <datalist id="strategy-tags">
              {strategyTagSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </WizardField>
          <WizardField
            label={t("wizard.spread.fields.regimeTags.label")}
            htmlFor="regimeTags"
            helper={t("wizard.spread.fields.regimeTags.helper")}
          >
            <WizardInput
              id="regimeTags"
              name="regimeTags"
              defaultValue={defaults.regimeTags}
              placeholder="funding-positive, contango"
              autoComplete="off"
            />
          </WizardField>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("wizard.spread.fields.back")}
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            {t("wizard.spread.fields.continue")}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </form>
    </WizardShell>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-border-subtle pb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
      {children}
    </h2>
  );
}
