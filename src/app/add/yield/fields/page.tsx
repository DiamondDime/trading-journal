import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import {
  WizardField,
  WizardInput,
  WizardSelect,
  WizardTextarea,
} from "@/components/wizard/wizard-field";
import { WizardValidationSummary } from "@/components/wizard/wizard-validation-summary";
import type { WizardValidationIssue } from "@/components/wizard/wizard-validation-summary";
import { requireUser } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { getYieldPositionForEdit } from "../db";

export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUPPORTED_KINDS = [
  "stake",
  "lend",
  "farm",
  "lp",
  "validator",
  "mining",
] as const;
type Kind = (typeof SUPPORTED_KINDS)[number];

function isKind(s: string): s is Kind {
  return (SUPPORTED_KINDS as readonly string[]).includes(s);
}

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  return typeof v === "string" ? v : fallback;
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Decode the validation issue list emitted by the server action error
 * redirect. Encoded as `issues=field|msg;field|msg;...` so the URL stays
 * readable in dev tools and avoids JSON round-trips that breaks special
 * chars.
 */
function decodeIssues(raw: string): WizardValidationIssue[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry): WizardValidationIssue => {
      const [field, ...rest] = entry.split("|");
      const message = rest.join("|");
      return { field: field || undefined, message: message || "Invalid value" };
    });
}

/**
 * Step 3/4 — Fields.
 *
 * The largest step. Branches by `kind` into one of six layouts; each layout
 * shows kind-specific inputs at the top and a common "position-level"
 * block below (asset, amount, opened_at, expected_apy_pct, status hints,
 * tax/strategy fields).
 *
 * In edit mode (`?edit=<uuid>`), the page pre-fills from the DB row and
 * uses the same form fields — the wizard never builds a separate edit
 * shape.
 */
export default async function YieldFieldsPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;
  const rawKind = getStr(sp, "kind", "stake");
  const kind: Kind = isKind(rawKind) ? rawKind : "stake";
  const source = getStr(sp, "source", "manual");
  const editId = getStr(sp, "edit");
  const issues = decodeIssues(getStr(sp, "issues"));

  const STEP_LABELS = [
    t("wizard.yield.stepLabels.source"),
    t("wizard.yield.stepLabels.kind"),
    t("wizard.yield.stepLabels.fields"),
    t("wizard.yield.stepLabels.review"),
  ] as const;

  // ── DB-backed defaults (edit mode) ────────────────────────────────────────
  let dbDefaults: Record<string, string> = {};
  let editValid = false;
  let editKind: Kind | null = null;
  if (editId && UUID_RE.test(editId)) {
    const { id: userId } = await requireUser();
    const row = await getYieldPositionForEdit(userId, editId);
    if (row) {
      editValid = true;
      editKind = isKind(row.kind) ? row.kind : null;
      dbDefaults = {
        protocol: row.protocol,
        venue: row.venue ?? "",
        chain: row.chain ?? "",
        asset: row.asset,
        amount: row.amount,
        amountUsdAtOpen: row.amountUsdAtOpen ?? "",
        expectedApyPct: row.expectedApyPct ?? "",
        rewardsToken: row.rewardsToken ?? "",
        feesProtocolUsd: row.feesProtocolUsd,
        feesGasUsd: row.feesGasUsd,
        openedAt: isoToDateInput(row.openedAt),
        closedAt: isoToDateInput(row.closedAt),
        status: row.status,
        strategyTag: row.strategyTag ?? "",
        taxTaxable: row.taxTaxable ? "true" : "false",
        taxJurisdiction: row.taxJurisdiction ?? "",
        regimeTags: row.regimeTags.join(", "),
        customTags: row.customTags.join(", "),
        name: row.name,
      };
      // kind_meta flattening
      const meta = row.kindMeta;
      if (meta) {
        switch (meta.kind) {
          case "stake":
            dbDefaults.validatorAddress = meta.validatorAddress ?? "";
            dbDefaults.operator = meta.operator ?? "";
            break;
          case "lend":
            dbDefaults.rateKind = meta.rateKind;
            dbDefaults.ltv = meta.ltv != null ? String(meta.ltv) : "";
            break;
          case "farm":
            dbDefaults.pairA = meta.pairA;
            dbDefaults.pairB = meta.pairB;
            dbDefaults.amountA = meta.amountA;
            dbDefaults.amountB = meta.amountB;
            dbDefaults.poolFeeTier = meta.poolFeeTier ?? "";
            dbDefaults.rewardToken = meta.rewardToken;
            break;
          case "lp":
            dbDefaults.pairA = meta.pairA;
            dbDefaults.pairB = meta.pairB;
            dbDefaults.amountA = meta.amountA;
            dbDefaults.amountB = meta.amountB;
            dbDefaults.poolFeeTier = meta.poolFeeTier;
            dbDefaults.rangeLower = meta.rangeLower ?? "";
            dbDefaults.rangeUpper = meta.rangeUpper ?? "";
            dbDefaults.concentrated = meta.concentrated ? "true" : "false";
            break;
          case "validator":
            dbDefaults.validatorAddress = meta.validatorAddress;
            dbDefaults.commissionPct = String(meta.commissionPct);
            break;
          case "mining":
            dbDefaults.hashrateThs = String(meta.hashrateThs);
            dbDefaults.electricityCostUsdKwh = String(meta.electricityCostUsdKwh);
            dbDefaults.pool = meta.pool;
            dbDefaults.expectedDailyRevenueUsd = String(
              meta.expectedDailyRevenueUsd,
            );
            break;
        }
      }
    }
  }

  // ── Merge defaults: URL params > DB > sensible empties ────────────────────
  const effectiveKind: Kind = editValid && editKind ? editKind : kind;
  const v = (key: string, fallback = "") =>
    getStr(sp, key) || dbDefaults[key] || fallback;

  const defaults = {
    protocol: v("protocol"),
    venue: v("venue"),
    chain: v("chain"),
    asset: v("asset"),
    amount: v("amount"),
    amountUsdAtOpen: v("amountUsdAtOpen"),
    expectedApyPct: v("expectedApyPct"),
    rewardsToken: v("rewardsToken"),
    feesProtocolUsd: v("feesProtocolUsd", "0"),
    feesGasUsd: v("feesGasUsd", "0"),
    openedAt: v("openedAt", todayIso()),
    closedAt: v("closedAt"),
    status: v("status", "open"),
    strategyTag: v("strategyTag"),
    taxTaxable: v("taxTaxable", "false"),
    taxJurisdiction: v("taxJurisdiction"),
    regimeTags: v("regimeTags"),
    customTags: v("customTags"),
    name: v("name"),
    // kind-specific
    validatorAddress: v("validatorAddress"),
    operator: v("operator"),
    rateKind: v("rateKind", "variable"),
    ltv: v("ltv"),
    pairA: v("pairA"),
    pairB: v("pairB"),
    amountA: v("amountA"),
    amountB: v("amountB"),
    poolFeeTier: v("poolFeeTier"),
    rangeLower: v("rangeLower"),
    rangeUpper: v("rangeUpper"),
    concentrated: v("concentrated", "false"),
    commissionPct: v("commissionPct"),
    hashrateThs: v("hashrateThs"),
    electricityCostUsdKwh: v("electricityCostUsdKwh"),
    pool: v("pool"),
    expectedDailyRevenueUsd: v("expectedDailyRevenueUsd"),
  };

  const backHref = editValid
    ? `/yield-positions/${editId}`
    : `/add/yield/kind?source=${source}&kind=${effectiveKind}`;

  return (
    <WizardShell
      type="yield_position"
      step={3}
      totalSteps={4}
      stepLabels={STEP_LABELS}
      title={editValid ? "Edit yield details" : "Yield details"}
      subtitle={
        editValid
          ? "Update any field. Status changes propagate to the activity feed."
          : "Fill in the position. Kind-specific fields appear at the top; everything below is common to all yield kinds."
      }
    >
      {editValid && (
        <aside
          className="mb-6 rounded-md border border-warn/30 bg-warn/5 px-4 py-2.5 text-[12px] text-warn"
          role="status"
        >
          <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">
            Editing
          </span>
          {" — "}
          <span className="font-serif italic">
            updating yield position #{editId.slice(0, 4).toUpperCase()}
          </span>
        </aside>
      )}

      <WizardValidationSummary errors={issues} className="mb-6" />

      <form
        id="yield-fields-form"
        action="/add/yield/review"
        method="get"
        className="flex flex-col gap-7"
      >
        {editValid && <input type="hidden" name="edit" value={editId} />}
        <input type="hidden" name="kind" value={effectiveKind} />
        <input type="hidden" name="source" value={source} />

        {/* ── Kind-specific block ────────────────────────────────────────── */}
        <SectionLabel>
          {effectiveKind.charAt(0).toUpperCase() + effectiveKind.slice(1)} details
        </SectionLabel>
        <KindFields kind={effectiveKind} defaults={defaults} t={t} />

        {/* ── Position (common) ──────────────────────────────────────────── */}
        <SectionLabel>Position</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.yield.fields.protocol.label")}
            htmlFor="protocol"
            helper={t("wizard.yield.fields.protocol.helper")}
            required
          >
            <WizardInput
              id="protocol"
              name="protocol"
              defaultValue={defaults.protocol}
              placeholder={t("wizard.yield.fields.protocol.placeholder")}
              required
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.venue.label")}
            htmlFor="venue"
            helper={t("wizard.yield.fields.venue.helper")}
          >
            <WizardInput
              id="venue"
              name="venue"
              defaultValue={defaults.venue}
              placeholder={t("wizard.yield.fields.venue.placeholder")}
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.chain.label")}
            htmlFor="chain"
            helper={t("wizard.yield.fields.chain.helper")}
          >
            <WizardInput
              id="chain"
              name="chain"
              defaultValue={defaults.chain}
              placeholder={t("wizard.yield.fields.chain.placeholder")}
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.asset.label")}
            htmlFor="asset"
            helper={t("wizard.yield.fields.asset.helper")}
            required
          >
            <WizardInput
              id="asset"
              name="asset"
              defaultValue={defaults.asset}
              placeholder={t("wizard.yield.fields.asset.placeholder")}
              required
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.amount.label")}
            htmlFor="amount"
            helper={t("wizard.yield.fields.amount.helper")}
            required
          >
            <WizardInput
              id="amount"
              name="amount"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.amount}
              placeholder={t("wizard.yield.fields.amount.placeholder")}
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.amountUsdAtOpen.label")}
            htmlFor="amountUsdAtOpen"
            helper={t("wizard.yield.fields.amountUsdAtOpen.helper")}
          >
            <WizardInput
              id="amountUsdAtOpen"
              name="amountUsdAtOpen"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.amountUsdAtOpen}
              placeholder={t("wizard.yield.fields.amountUsdAtOpen.placeholder")}
            />
          </WizardField>
        </div>

        {/* ── Yield economics ────────────────────────────────────────────── */}
        <SectionLabel>Yield economics</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.yield.fields.expectedApyPct.label")}
            htmlFor="expectedApyPct"
            helper={t("wizard.yield.fields.expectedApyPct.helper")}
          >
            <WizardInput
              id="expectedApyPct"
              name="expectedApyPct"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.expectedApyPct}
              placeholder={t("wizard.yield.fields.expectedApyPct.placeholder")}
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.rewardsToken.label")}
            htmlFor="rewardsToken"
            helper={t("wizard.yield.fields.rewardsToken.helper")}
          >
            <WizardInput
              id="rewardsToken"
              name="rewardsToken"
              defaultValue={defaults.rewardsToken}
              placeholder={t("wizard.yield.fields.rewardsToken.placeholder")}
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.feesProtocolUsd.label")}
            htmlFor="feesProtocolUsd"
            helper={t("wizard.yield.fields.feesProtocolUsd.helper")}
          >
            <WizardInput
              id="feesProtocolUsd"
              name="feesProtocolUsd"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.feesProtocolUsd}
              placeholder="0"
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.feesGasUsd.label")}
            htmlFor="feesGasUsd"
            helper={t("wizard.yield.fields.feesGasUsd.helper")}
          >
            <WizardInput
              id="feesGasUsd"
              name="feesGasUsd"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.feesGasUsd}
              placeholder="0"
            />
          </WizardField>
        </div>

        {/* ── Lifecycle ──────────────────────────────────────────────────── */}
        <SectionLabel>Lifecycle</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <WizardField label="Opened at" htmlFor="openedAt" required>
            <WizardInput
              id="openedAt"
              name="openedAt"
              type="date"
              defaultValue={defaults.openedAt}
              required
            />
          </WizardField>
          <WizardField
            label="Status"
            htmlFor="status"
            helper="Pick 'open' for a live position, 'unwinding' if you've started withdrawing but haven't fully exited, 'closed' if done."
          >
            <WizardSelect
              id="status"
              name="status"
              defaultValue={defaults.status}
            >
              <option value="open">Open</option>
              <option value="unwinding">Unwinding</option>
              <option value="closed">Closed</option>
            </WizardSelect>
          </WizardField>
          <WizardField
            label="Closed at"
            htmlFor="closedAt"
            helper="Only if status = closed"
          >
            <WizardInput
              id="closedAt"
              name="closedAt"
              type="date"
              defaultValue={defaults.closedAt}
            />
          </WizardField>
        </div>

        {/* ── Strategy + tax + tags ──────────────────────────────────────── */}
        <SectionLabel>Strategy, tax, tags</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label="Strategy tag"
            htmlFor="strategyTag"
            helper="Roll-up grouping (e.g. ETH basis carry Q1)"
          >
            <WizardInput
              id="strategyTag"
              name="strategyTag"
              defaultValue={defaults.strategyTag}
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label="Taxable?"
            htmlFor="taxTaxable"
            helper="Flag if this generates a taxable event in your jurisdiction"
          >
            <WizardSelect
              id="taxTaxable"
              name="taxTaxable"
              defaultValue={defaults.taxTaxable}
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </WizardSelect>
          </WizardField>
          <WizardField
            label="Tax jurisdiction"
            htmlFor="taxJurisdiction"
            helper="Free-form (e.g. US, EU/DE, AE)"
          >
            <WizardInput
              id="taxJurisdiction"
              name="taxJurisdiction"
              defaultValue={defaults.taxJurisdiction}
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label="Regime tags"
            htmlFor="regimeTags"
            helper="Comma-separated (e.g. bull-market, post-merge)"
          >
            <WizardInput
              id="regimeTags"
              name="regimeTags"
              defaultValue={defaults.regimeTags}
              placeholder="post-merge"
              autoComplete="off"
            />
          </WizardField>
        </div>

        <WizardField
          label="Position name"
          htmlFor="name"
          helper="Optional — we derive one from asset/protocol/kind if blank"
        >
          <WizardTextarea
            id="name"
            name="name"
            rows={2}
            defaultValue={defaults.name}
            placeholder="ETH · Lido · stake"
          />
        </WizardField>

        {/* ── Nav ────────────────────────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            Review
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </form>
    </WizardShell>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-border-subtle pb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
      {children}
    </h2>
  );
}

interface KindFieldsProps {
  kind: Kind;
  defaults: Record<string, string>;
  t: Awaited<ReturnType<typeof getT>>;
}

/**
 * Branches the kind-specific UI. Each kind owns its own grid so the field
 * shape mirrors the discriminated `YieldKindMeta` union exactly. The
 * server action's `buildKindMeta` reads only the fields relevant to the
 * picked kind, so stray inputs from a prior selection are safe.
 */
function KindFields({ kind, defaults, t }: KindFieldsProps) {
  switch (kind) {
    case "stake":
      return (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.yield.fields.validatorAddress.label")}
            htmlFor="validatorAddress"
            helper={t("wizard.yield.fields.validatorAddress.helper")}
          >
            <WizardInput
              id="validatorAddress"
              name="validatorAddress"
              defaultValue={defaults.validatorAddress}
              placeholder={t("wizard.yield.fields.validatorAddress.placeholder")}
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.operator.label")}
            htmlFor="operator"
            helper={t("wizard.yield.fields.operator.helper")}
          >
            <WizardInput
              id="operator"
              name="operator"
              defaultValue={defaults.operator}
              placeholder={t("wizard.yield.fields.operator.placeholder")}
              autoComplete="off"
            />
          </WizardField>
        </div>
      );
    case "lend":
      return (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.yield.fields.rateKind.label")}
            htmlFor="rateKind"
            helper={t("wizard.yield.fields.rateKind.helper")}
            required
          >
            <WizardSelect
              id="rateKind"
              name="rateKind"
              defaultValue={defaults.rateKind}
              required
            >
              <option value="variable">Variable</option>
              <option value="fixed">Fixed</option>
            </WizardSelect>
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.ltv.label")}
            htmlFor="ltv"
            helper={t("wizard.yield.fields.ltv.helper")}
          >
            <WizardInput
              id="ltv"
              name="ltv"
              type="number"
              step="0.01"
              min="0"
              max="100"
              inputMode="decimal"
              defaultValue={defaults.ltv}
              placeholder={t("wizard.yield.fields.ltv.placeholder")}
            />
          </WizardField>
        </div>
      );
    case "farm":
      return (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.yield.fields.pairA.label")}
            htmlFor="pairA"
            helper={t("wizard.yield.fields.pairA.helper")}
            required
          >
            <WizardInput
              id="pairA"
              name="pairA"
              defaultValue={defaults.pairA}
              placeholder={t("wizard.yield.fields.pairA.placeholder")}
              required
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.pairB.label")}
            htmlFor="pairB"
            helper={t("wizard.yield.fields.pairB.helper")}
            required
          >
            <WizardInput
              id="pairB"
              name="pairB"
              defaultValue={defaults.pairB}
              placeholder={t("wizard.yield.fields.pairB.placeholder")}
              required
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.amountA.label")}
            htmlFor="amountA"
            helper={t("wizard.yield.fields.amountA.helper")}
            required
          >
            <WizardInput
              id="amountA"
              name="amountA"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.amountA}
              placeholder={t("wizard.yield.fields.amountA.placeholder")}
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.amountB.label")}
            htmlFor="amountB"
            helper={t("wizard.yield.fields.amountB.helper")}
            required
          >
            <WizardInput
              id="amountB"
              name="amountB"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.amountB}
              placeholder={t("wizard.yield.fields.amountB.placeholder")}
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.poolFeeTier.label")}
            htmlFor="poolFeeTier"
            helper={t("wizard.yield.fields.poolFeeTier.helper")}
          >
            <WizardInput
              id="poolFeeTier"
              name="poolFeeTier"
              defaultValue={defaults.poolFeeTier}
              placeholder={t("wizard.yield.fields.poolFeeTier.placeholder")}
              autoComplete="off"
            />
          </WizardField>
          {/* Reward token is part of the farm meta payload — keep its name
              unique vs the position-level rewardsToken (singular) so the
              server action picks up the right slot. */}
          <WizardField
            label="Reward token (farm)"
            htmlFor="rewardToken"
            helper="Token the farm pays out"
            required
          >
            <WizardInput
              id="rewardToken"
              name="rewardToken"
              defaultValue={defaults.rewardToken ?? defaults.rewardsToken ?? ""}
              placeholder="CRV"
              required
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
          </WizardField>
        </div>
      );
    case "lp":
      return (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.yield.fields.pairA.label")}
            htmlFor="pairA"
            helper={t("wizard.yield.fields.pairA.helper")}
            required
          >
            <WizardInput
              id="pairA"
              name="pairA"
              defaultValue={defaults.pairA}
              placeholder={t("wizard.yield.fields.pairA.placeholder")}
              required
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.pairB.label")}
            htmlFor="pairB"
            helper={t("wizard.yield.fields.pairB.helper")}
            required
          >
            <WizardInput
              id="pairB"
              name="pairB"
              defaultValue={defaults.pairB}
              placeholder={t("wizard.yield.fields.pairB.placeholder")}
              required
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.amountA.label")}
            htmlFor="amountA"
            helper={t("wizard.yield.fields.amountA.helper")}
            required
          >
            <WizardInput
              id="amountA"
              name="amountA"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.amountA}
              placeholder={t("wizard.yield.fields.amountA.placeholder")}
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.amountB.label")}
            htmlFor="amountB"
            helper={t("wizard.yield.fields.amountB.helper")}
            required
          >
            <WizardInput
              id="amountB"
              name="amountB"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.amountB}
              placeholder={t("wizard.yield.fields.amountB.placeholder")}
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.poolFeeTier.label")}
            htmlFor="poolFeeTier"
            helper={t("wizard.yield.fields.poolFeeTier.helper")}
            required
          >
            <WizardInput
              id="poolFeeTier"
              name="poolFeeTier"
              defaultValue={defaults.poolFeeTier}
              placeholder={t("wizard.yield.fields.poolFeeTier.placeholder")}
              required
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.concentrated.label")}
            htmlFor="concentrated"
            helper={t("wizard.yield.fields.concentrated.helper")}
          >
            <WizardSelect
              id="concentrated"
              name="concentrated"
              defaultValue={defaults.concentrated}
            >
              <option value="false">Full-range (v2)</option>
              <option value="true">Concentrated (v3)</option>
            </WizardSelect>
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.rangeLower.label")}
            htmlFor="rangeLower"
            helper={t("wizard.yield.fields.rangeLower.helper")}
          >
            <WizardInput
              id="rangeLower"
              name="rangeLower"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.rangeLower}
              placeholder={t("wizard.yield.fields.rangeLower.placeholder")}
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.rangeUpper.label")}
            htmlFor="rangeUpper"
            helper={t("wizard.yield.fields.rangeUpper.helper")}
          >
            <WizardInput
              id="rangeUpper"
              name="rangeUpper"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.rangeUpper}
              placeholder={t("wizard.yield.fields.rangeUpper.placeholder")}
            />
          </WizardField>
        </div>
      );
    case "validator":
      return (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.yield.fields.validatorAddress.label")}
            htmlFor="validatorAddress"
            helper={t("wizard.yield.fields.validatorAddress.helper")}
            required
          >
            <WizardInput
              id="validatorAddress"
              name="validatorAddress"
              defaultValue={defaults.validatorAddress}
              placeholder={t("wizard.yield.fields.validatorAddress.placeholder")}
              required
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.commissionPct.label")}
            htmlFor="commissionPct"
            helper={t("wizard.yield.fields.commissionPct.helper")}
            required
          >
            <WizardInput
              id="commissionPct"
              name="commissionPct"
              type="number"
              step="0.01"
              min="0"
              max="100"
              inputMode="decimal"
              defaultValue={defaults.commissionPct}
              placeholder={t("wizard.yield.fields.commissionPct.placeholder")}
              required
            />
          </WizardField>
        </div>
      );
    case "mining":
      return (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.yield.fields.hashrateThs.label")}
            htmlFor="hashrateThs"
            helper={t("wizard.yield.fields.hashrateThs.helper")}
            required
          >
            <WizardInput
              id="hashrateThs"
              name="hashrateThs"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.hashrateThs}
              placeholder={t("wizard.yield.fields.hashrateThs.placeholder")}
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.electricityCostUsdKwh.label")}
            htmlFor="electricityCostUsdKwh"
            helper={t("wizard.yield.fields.electricityCostUsdKwh.helper")}
            required
          >
            <WizardInput
              id="electricityCostUsdKwh"
              name="electricityCostUsdKwh"
              type="number"
              step="0.001"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.electricityCostUsdKwh}
              placeholder={t(
                "wizard.yield.fields.electricityCostUsdKwh.placeholder",
              )}
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.pool.label")}
            htmlFor="pool"
            helper={t("wizard.yield.fields.pool.helper")}
            required
          >
            <WizardInput
              id="pool"
              name="pool"
              defaultValue={defaults.pool}
              placeholder={t("wizard.yield.fields.pool.placeholder")}
              required
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.yield.fields.expectedDailyRevenueUsd.label")}
            htmlFor="expectedDailyRevenueUsd"
            helper={t("wizard.yield.fields.expectedDailyRevenueUsd.helper")}
            required
          >
            <WizardInput
              id="expectedDailyRevenueUsd"
              name="expectedDailyRevenueUsd"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.expectedDailyRevenueUsd}
              placeholder={t(
                "wizard.yield.fields.expectedDailyRevenueUsd.placeholder",
              )}
              required
            />
          </WizardField>
        </div>
      );
  }
}
