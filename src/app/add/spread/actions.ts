"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server";
import {
  createSpreadV2,
  updateSpreadV2,
  isValidVariantForType,
  type CreateSpreadInput,
  type UpdateSpreadInput,
  type SpreadOpenIntent,
  type SpreadLegInput,
  type ManualSpreadLegInput,
} from "./db";
import type { ActivityStatus, SpreadType, SpreadVariant } from "@/types/canonical";

// ---------------------------------------------------------------------------
// Schema-aware decoding of the FormData payload.
//
// The wizard round-trips every step's value through searchParams (GET form
// submits) so back-nav preserves state. The final /review submits a POST
// FormData blob to this action — every key here matches a hidden <input>
// on /review (and a visible input on /fields).
//
// To survive the empty-string round-trip pattern (cleared inputs are emitted
// as empty strings rather than omitted), we explicitly redirect-back to
// /review with the entire payload encoded including empties. This is the
// fix for the "cleared values resurrect after back navigation" bug.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Matcher → DB spread_type mapping. */
const MATCHER_TO_DB_TYPE = {
  cash_carry: "cash_carry",
  funding: "funding_capture",
  cross_exchange: "cross_exchange_perp_arb",
  calendar: "calendar",
  dex_cex: "dex_cex_arb",
} as const satisfies Record<string, SpreadType>;

function stripNextInternals(entries: [string, FormDataEntryValue][]): [string, FormDataEntryValue][] {
  return entries.filter(([k]) => !k.startsWith("$ACTION_"));
}

function asString(v: FormDataEntryValue | undefined | null): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return "";
}

function parseDecOrNull(s: string): string | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (!DECIMAL_RE.test(trimmed)) return null;
  return trimmed;
}

function parseIntOrNull(s: string): number | null {
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDateOrNull(s: string): string | null {
  if (!s) return null;
  // YYYY-MM-DD is what activity_spread.expected_basis_convergence_date wants.
  // `<input type="date">` already emits this shape.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function parseIsoOrNull(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function parseStatus(s: string): ActivityStatus | null {
  // The spread CHK accepts open/winding_down/orphaned/expired/closed.
  // unwinding/pending/etc. would fail the CHECK, so we narrow here.
  if (
    s === "open" ||
    s === "winding_down" ||
    s === "orphaned" ||
    s === "expired" ||
    s === "closed"
  )
    return s;
  return null;
}

/**
 * Map the wizard's free-text variant input down to a canonical DB value.
 *
 * The wizard surfaces "variant" as a free-text field with a suggested string
 * (e.g. "Funding", "Sep-26 / Dec-26"). For types that have a constrained
 * variant enum (cash_carry, funding_capture), we attempt to recognise the
 * canonical token in the user's input. For other types, variant is NULL.
 */
function mapVariantToCanonical(
  dbSpreadType: SpreadType,
  rawVariant: string,
  explicitVariant: string | null,
): SpreadVariant | null {
  if (explicitVariant) {
    if (
      dbSpreadType === "cash_carry" &&
      (explicitVariant === "funding" || explicitVariant === "basis")
    )
      return explicitVariant;
    if (
      dbSpreadType === "funding_capture" &&
      (explicitVariant === "same_venue" || explicitVariant === "cross_venue")
    )
      return explicitVariant;
  }
  const v = rawVariant.toLowerCase();
  if (dbSpreadType === "cash_carry") {
    if (v.includes("basis")) return "basis";
    if (v.includes("funding")) return "funding";
    return v ? "funding" : null;
  }
  if (dbSpreadType === "funding_capture") {
    if (v.includes("cross")) return "cross_venue";
    return v ? "same_venue" : null;
  }
  return null;
}

interface DecodedLeg {
  positionId: string;
  role: "long" | "short" | string;
  intendedPrice: string | null;
}

/** Raw shape coming out of ManualLegBuilder's JSON serialisation. */
interface RawManualLeg {
  symbol?: string;
  exchange?: string;
  side?: string;
  qty?: string;
  entryPrice?: string;
  exitPrice?: string;
  feesUsd?: string;
  instrumentType?: string;
}

function decodeManualLegs(raw: Record<string, string>): ManualSpreadLegInput[] {
  const json = (raw.manualLegsJson ?? "").trim();
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return (parsed as RawManualLeg[])
    .map((l): ManualSpreadLegInput => ({
      symbol: (l.symbol ?? "").trim(),
      exchangeLabel: (l.exchange ?? "").trim(),
      side: l.side === "short" ? "short" : "long",
      qty: parseDecOrNull(l.qty ?? ""),
      entryPrice: parseDecOrNull(l.entryPrice ?? ""),
      exitPrice: parseDecOrNull(l.exitPrice ?? ""),
      feesUsd: parseDecOrNull(l.feesUsd ?? ""),
      instrumentType:
        l.instrumentType === "spot" || l.instrumentType === "dated_future"
          ? l.instrumentType
          : "perp",
    }))
    .filter((l) => l.symbol.length > 0);
}

/**
 * Decode the per-leg metadata embedded in the FormData. The /review page
 * emits one row per leg via repeated `legPositionId`, `legRole`,
 * `legIntendedPrice` keys (in insertion order). FormData's `getAll` preserves
 * insertion order so we just zip them.
 */
function decodeLegs(form: FormData): DecodedLeg[] {
  const positionIds = form.getAll("legPositionId").filter((v): v is string => typeof v === "string");
  const roles = form.getAll("legRole").filter((v): v is string => typeof v === "string");
  const intendedPrices = form
    .getAll("legIntendedPrice")
    .filter((v): v is string => typeof v === "string");

  const out: DecodedLeg[] = [];
  for (let i = 0; i < positionIds.length; i++) {
    const pid = positionIds[i].trim();
    if (!pid) continue;
    out.push({
      positionId: pid,
      role: roles[i] === "short" ? "short" : "long",
      intendedPrice: parseDecOrNull(intendedPrices[i] ?? ""),
    });
  }
  return out;
}

/**
 * Decoded form payload. Centralises the raw → typed conversion so both the
 * create path and the redirect-back-with-error path share the same shape.
 */
interface DecodedPayload {
  name: string;
  status: ActivityStatus | null;
  spreadTypeMatcher: string;
  dbSpreadType: SpreadType;
  variantRaw: string;
  variantCanonical: SpreadVariant | null;
  openedAt: string | null;
  closedAt: string | null;
  capital: string | null;
  realizedPnl: string | null;
  fees: string;
  netPnl: string | null;
  thesis: string | null;
  regimeTags: string[];
  strategyTag: string | null;
  openIntent: SpreadOpenIntent;
  legs: DecodedLeg[];
  manualLegs: ManualSpreadLegInput[];
  primaryBase: string;
  matcher: string;
  source: string;
}

function decodePayload(raw: Record<string, string>, form: FormData): DecodedPayload {
  const name = (raw.name ?? "").trim();
  const status = parseStatus((raw.status ?? "").trim());
  const spreadTypeMatcher = (raw.spreadType ?? "").trim();
  const dbSpreadType: SpreadType =
    (MATCHER_TO_DB_TYPE[spreadTypeMatcher as keyof typeof MATCHER_TO_DB_TYPE] as SpreadType) ?? "custom";
  const variantRaw = (raw.variant ?? "").trim();
  const variantCanonical = mapVariantToCanonical(
    dbSpreadType,
    variantRaw,
    (raw.variantCanonical ?? "").trim() || null,
  );

  const capital = parseDecOrNull(raw.capital ?? "");
  const fees = parseDecOrNull(raw.fees ?? "") ?? "0";
  const netPnl = parseDecOrNull(raw.netPnl ?? "");
  // Wizard collects net P&L only; realized P&L mirrors net for v1 since the
  // worker hasn't decomposed realized/basis/funding for manual spreads yet.
  const realizedPnl = netPnl;

  const openedAt = parseIsoOrNull(raw.openedAt ?? "");
  const closedAt = parseIsoOrNull(raw.closedAt ?? "");

  const regimeTags = (raw.regimeTags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const thesis = (raw.thesis ?? "").trim() || null;
  const strategyTag = (raw.strategyTag ?? "").trim() || null;

  // Open-intent fields. Each is conditionally surfaced in the UI per spread
  // type — but we always decode whatever the form sent so back-nav preserves
  // everything the user typed.
  const openIntent: SpreadOpenIntent = {
    targetAprAtOpen: parseDecOrNull(raw.targetAprAtOpen ?? ""),
    expectedHoldingDays: parseIntOrNull(raw.expectedHoldingDays ?? ""),
    expectedBasisConvergenceDate: parseDateOrNull(raw.expectedBasisConvergenceDate ?? ""),
    exitPlan: thesis,
    borrowCostAssumedBps: parseDecOrNull(raw.borrowCostAssumedBps ?? ""),
    closeThresholdApr: parseDecOrNull(raw.closeThresholdApr ?? ""),
    closeThresholdPeriods: parseIntOrNull(raw.closeThresholdPeriods ?? ""),
    maxGasBudgetUsd: parseDecOrNull(raw.maxGasBudgetUsd ?? ""),
    slippageToleranceBps: parseDecOrNull(raw.slippageToleranceBps ?? ""),
  };

  const primaryBase = (raw.primaryBase ?? "").trim()
    || (name.split(/[\s·-]/)[0] || "—").toUpperCase();

  return {
    name,
    status,
    spreadTypeMatcher,
    dbSpreadType,
    variantRaw,
    variantCanonical,
    openedAt,
    closedAt,
    capital,
    realizedPnl,
    fees,
    netPnl,
    thesis,
    regimeTags,
    strategyTag,
    openIntent,
    legs: decodeLegs(form),
    manualLegs: decodeManualLegs(raw),
    primaryBase,
    matcher: (raw.matcher ?? "").trim(),
    source: (raw.source ?? "").trim(),
  };
}

function buildErrors(payload: DecodedPayload): string[] {
  const errs: string[] = [];
  if (!payload.name) errs.push("Spread name is required");
  if (!payload.status) errs.push("Status is required (open / winding_down / orphaned / expired / closed)");
  if (
    payload.status === "closed" &&
    (!payload.openedAt || !payload.closedAt)
  ) {
    errs.push("Closed spreads require both opened_at and closed_at");
  }
  if (
    (payload.status === "open" || payload.status === "winding_down") &&
    payload.closedAt !== null
  ) {
    errs.push(`Status "${payload.status}" cannot have a closed_at value`);
  }
  if (payload.openedAt && payload.closedAt && new Date(payload.closedAt) < new Date(payload.openedAt)) {
    errs.push("closed_at must be on or after opened_at");
  }
  if (
    payload.dbSpreadType === "custom" &&
    payload.spreadTypeMatcher
  ) {
    errs.push(`Unknown spread type "${payload.spreadTypeMatcher}"`);
  }
  if (
    payload.variantCanonical &&
    !isValidVariantForType(payload.dbSpreadType, payload.variantCanonical)
  ) {
    errs.push(
      `Variant "${payload.variantCanonical}" is not valid for spread type "${payload.dbSpreadType}"`,
    );
  }
  // Per-type gated open-intent guards. These match the schema's intent rather
  // than a hard CHECK (the columns are nullable) — surfaced here so the
  // post-trade review has the inputs it depends on.
  if (
    payload.dbSpreadType === "cash_carry" &&
    payload.variantCanonical === "basis" &&
    !payload.openIntent.expectedBasisConvergenceDate
  ) {
    errs.push("Basis cash-and-carry: expected basis convergence date is required");
  }
  return errs;
}

/**
 * Server action — the wizard's /review form POSTs here. Inserts a new
 * spread, or updates an existing one when `edit=<uuid>` is present.
 *
 * Validation strategy: decode → validate → either redirect-back-with-errors
 * (preserving every input including empties for round-trip) or perform the
 * DB write inside a transaction. Successful writes revalidate the relevant
 * cache paths and redirect to /spreads/<id>.
 */
export async function logSpread(formData: FormData): Promise<void> {
  let activityId: string | null = null;
  let isEdit = false;
  let redirectErrors: string[] = [];

  const editRaw = formData.get("edit");
  const editId =
    typeof editRaw === "string" && UUID_RE.test(editRaw) ? editRaw : null;

  // Capture cleaned payload BEFORE the auth call so wizard errors keep the
  // user's inputs around for the redirect-back round trip. We intentionally
  // keep empty strings here — so when the redirect lands back on /review,
  // the inputs are re-populated as-emitted (cleared values stay cleared).
  const cleanedRaw: Record<string, string> = Object.fromEntries(
    stripNextInternals([...formData.entries()])
      .filter(([k]) => k !== "edit")
      .map(([k, v]) => [k, asString(v)]),
  );

  try {
    const { id: userId } = await requireUser();
    const payload = decodePayload(cleanedRaw, formData);

    const validation = buildErrors(payload);
    if (validation.length > 0) {
      redirectErrors = validation;
      throw new Error(validation[0]);
    }

    const isManualSource = payload.source === "manual";
    const legCount =
      isManualSource
        ? payload.manualLegs.length
        : payload.legs.length > 0
          ? payload.legs.length
          : Math.max(0, Number.parseInt(cleanedRaw.legCount ?? "", 10) || 0);

    if (editId) {
      isEdit = true;
      const patch: UpdateSpreadInput = {
        name: payload.name,
        status: payload.status as ActivityStatus,
        openedAt: payload.openedAt,
        closedAt: payload.closedAt,
        capitalDeployedUsd: payload.capital,
        realizedPnlUsd: payload.realizedPnl,
        feesUsd: payload.fees,
        netPnlUsd: payload.netPnl,
        regimeTags: payload.regimeTags,
        customTags: [],
        strategyTag: payload.strategyTag,
        spreadType: payload.dbSpreadType,
        variant: payload.variantCanonical,
        primaryBase: payload.primaryBase,
        legCount,
        openIntent: payload.openIntent,
      };
      const ok = await updateSpreadV2(userId, editId, patch);
      if (!ok) throw new Error("Spread not found or not owned by you");
      activityId = editId;
    } else {
      const input: CreateSpreadInput = {
        name: payload.name,
        status: payload.status as ActivityStatus,
        openedAt: payload.openedAt,
        closedAt: payload.closedAt,
        capitalDeployedUsd: payload.capital,
        realizedPnlUsd: payload.realizedPnl,
        feesUsd: payload.fees,
        netPnlUsd: payload.netPnl,
        regimeTags: payload.regimeTags,
        customTags: [],
        strategyTag: payload.strategyTag,
        spreadType: payload.dbSpreadType,
        variant: payload.variantCanonical,
        primaryBase: payload.primaryBase,
        origin: payload.matcher === "auto" ? "auto_matched" : "manual",
        source: "user",
        legCount,
        openIntent: payload.openIntent,
        legs: isManualSource
          ? []
          : payload.legs.map<SpreadLegInput>((l) => ({
              positionId: l.positionId,
              role: l.role,
              intendedPrice: l.intendedPrice,
            })),
        manualLegs: isManualSource ? payload.manualLegs : [],
      };
      const result = await createSpreadV2(userId, input);
      activityId = result.id;
    }
  } catch (e) {
    if (redirectErrors.length === 0) {
      redirectErrors = [e instanceof Error ? e.message : String(e)];
    }
  }

  if (activityId) {
    revalidatePath("/spreads");
    revalidatePath("/spreads/archive");
    revalidatePath(`/spreads/${activityId}`);
    const qs = isEdit ? "from=wizard&action=edited" : "from=wizard";
    redirect(`/spreads/${activityId}?${qs}`);
  } else {
    // Round-trip every value (including empties) so back-nav from the error
    // surface doesn't drop cleared inputs.
    const qs = new URLSearchParams();
    qs.set("error", redirectErrors.join("\n"));
    for (const [k, v] of Object.entries(cleanedRaw)) {
      qs.set(k, v);
    }
    if (editId) qs.set("edit", editId);
    redirect(`/add/spread/review?${qs.toString()}`);
  }
}
