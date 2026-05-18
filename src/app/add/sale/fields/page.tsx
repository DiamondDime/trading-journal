import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import {
  WizardField,
  WizardInput,
  WizardSelect,
  WizardTextarea,
} from "@/components/wizard/wizard-field";
import { WizardVestingEditor } from "@/components/wizard/wizard-vesting-editor";
import { requireUser } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { getSaleForEdit } from "../db";

// Reads searchParams + (when editing) the DB — never static. Master plan §0:
// every wizard step that reads searchParams must opt out of static rendering.
export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string")
    return v[0];
  return fallback;
}

function isoToDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoToDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Step 2 — Sale details. Collects every column the wizard owns in the
 * activity + activity_sale schema, including the v5 additions:
 *   - tokenChain (drives the wallet-paste explorer)
 *   - claimWallet (auto-import cost basis verification)
 *   - saleDate (separate from tgeDate — premarket / OTC allocations have
 *     distinct payment vs TGE moments)
 *   - fundraisingRound / allocationMethod / tier / bonusPct (round metadata)
 *   - vesting schedule via the 4-variant editor (replaces the v1
 *     months×cliff approximation; emits days-granular JSON)
 *   - eligibilityReason (structured, separate from free-form note/thesis)
 *   - strategyTag / taxTaxable / taxJurisdiction (activity supertype v5 cols)
 *
 * Edit mode (`?edit=<uuid>`): pre-fill via getSaleForEdit, which loads the
 * full v5 column set (more than the canonical getActivity returns). Hidden
 * `edit` ride-through goes to /review and ultimately the server action's
 * update branch.
 */
export default async function SaleFieldsPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;
  const editId = getStr(sp, "edit");

  const STEP_LABELS = [
    t("wizard.sale.stepLabels.kind"),
    t("wizard.sale.stepLabels.details"),
    t("wizard.sale.stepLabels.review"),
  ] as const;

  // DB defaults are only consulted when editing. URL params (from a /review
  // bounce-back or kind-step ride-through) always win because they reflect
  // the user's most recent typing.
  let dbDefaults: Partial<{
    saleKind: string;
    venue: string;
    asset: string;
    usdPaid: string;
    tokensAllocated: string;
    saleDate: string;
    tgeDate: string;
    currentPriceUsd: string;
    openedAt: string;
    regimeTags: string;
    serial: string;
    tokenChain: string;
    claimWallet: string;
    fundraisingRound: string;
    allocationMethod: string;
    tier: string;
    bonusPct: string;
    vestingScheduleJson: string;
    strategyTag: string;
    taxTaxable: string;
    taxJurisdiction: string;
    eligibilityReason: string;
  }> = {};
  let editValid = false;

  if (editId && UUID_RE.test(editId)) {
    const { id: userId } = await requireUser();
    const row = await getSaleForEdit(userId, editId);
    if (row) {
      dbDefaults = {
        saleKind: row.saleKind,
        venue: row.saleVenue ?? "",
        asset: row.tokenSymbol,
        usdPaid: row.usdPaid,
        tokensAllocated: row.tokensAllocated,
        saleDate: isoToDate(row.saleDate),
        tgeDate: isoToDate(row.saleDate),
        currentPriceUsd: row.currentPriceUsd ?? "",
        openedAt: isoToDateTimeLocal(row.openedAt),
        regimeTags: row.regimeTags.join(", "),
        serial: row.activityId.slice(0, 4).toUpperCase(),
        tokenChain: row.tokenChain ?? "",
        claimWallet: row.claimWallet ?? "",
        fundraisingRound: row.fundraisingRound ?? "",
        allocationMethod: row.allocationMethod ?? "",
        tier: row.tier ?? "",
        bonusPct: row.bonusPct ?? "",
        vestingScheduleJson: row.vestingSchedule
          ? JSON.stringify(row.vestingSchedule)
          : "",
        strategyTag: row.strategyTag ?? "",
        taxTaxable: row.taxTaxable ? "on" : "",
        taxJurisdiction: row.taxJurisdiction ?? "",
        eligibilityReason: row.eligibilityReason ?? "",
      };
      editValid = true;
    }
  }

  const defaults = {
    saleKind: getStr(sp, "saleKind") || dbDefaults.saleKind || "ido",
    venue: getStr(sp, "venue") || dbDefaults.venue || "",
    asset: getStr(sp, "asset") || dbDefaults.asset || "",
    usdPaid: getStr(sp, "usdPaid") || dbDefaults.usdPaid || "",
    tokensAllocated:
      getStr(sp, "tokensAllocated") || dbDefaults.tokensAllocated || "",
    saleDate: getStr(sp, "saleDate") || dbDefaults.saleDate || "",
    tgeDate: getStr(sp, "tgeDate") || dbDefaults.tgeDate || "",
    currentPriceUsd:
      getStr(sp, "currentPriceUsd") || dbDefaults.currentPriceUsd || "",
    openedAt: getStr(sp, "openedAt") || dbDefaults.openedAt || "",
    note: getStr(sp, "note") || "",
    regimeTags: getStr(sp, "regimeTags") || dbDefaults.regimeTags || "",
    tokenChain: getStr(sp, "tokenChain") || dbDefaults.tokenChain || "",
    claimWallet: getStr(sp, "claimWallet") || dbDefaults.claimWallet || "",
    fundraisingRound:
      getStr(sp, "fundraisingRound") || dbDefaults.fundraisingRound || "",
    allocationMethod:
      getStr(sp, "allocationMethod") || dbDefaults.allocationMethod || "",
    tier: getStr(sp, "tier") || dbDefaults.tier || "",
    bonusPct: getStr(sp, "bonusPct") || dbDefaults.bonusPct || "",
    tgeUnlockPct: getStr(sp, "tgeUnlockPct") || "",
    vestingScheduleJson:
      getStr(sp, "vestingScheduleJson") || dbDefaults.vestingScheduleJson || "",
    strategyTag: getStr(sp, "strategyTag") || dbDefaults.strategyTag || "",
    taxTaxable:
      getStr(sp, "taxTaxable") || dbDefaults.taxTaxable || "",
    taxJurisdiction:
      getStr(sp, "taxJurisdiction") || dbDefaults.taxJurisdiction || "",
    eligibilityReason:
      getStr(sp, "eligibilityReason") || dbDefaults.eligibilityReason || "",
  };

  const backHref = editValid
    ? `/sales/${editId}`
    : `/add/sale/kind?saleKind=${encodeURIComponent(defaults.saleKind)}`;

  return (
    <WizardShell
      type="sale"
      step={2}
      totalSteps={3}
      stepLabels={STEP_LABELS}
      title={
        editValid
          ? t("wizard.sale.fields.titleEdit")
          : t("wizard.sale.fields.title")
      }
      subtitle={
        editValid
          ? t("wizard.sale.fields.subtitleEdit")
          : t("wizard.sale.fields.subtitle")
      }
    >
      {editValid && (
        <aside
          className="mb-6 rounded-md border border-warn/30 bg-warn/5 px-4 py-2.5 text-[12px] text-warn"
          role="status"
        >
          <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">
            {t("wizard.sale.fields.editingBadge")}
          </span>
          {" — "}
          <span className="font-serif italic">
            {t("wizard.sale.fields.editingNote", {
              serial: dbDefaults.serial ?? "",
            })}
          </span>
        </aside>
      )}
      <form
        id="sale-fields-form"
        action="/add/sale/review"
        method="get"
        className="flex flex-col gap-7"
      >
        {editValid && <input type="hidden" name="edit" value={editId} />}
        {/* Carry the kind discriminator from step 1 into /review without
            re-rendering it on this page. Users go back to /kind to change it. */}
        <input type="hidden" name="saleKind" value={defaults.saleKind} />

        {/* ── Venue + token ─────────────────────────────────────────── */}
        <SectionLabel>
          {t("wizard.sale.fields.sections.venueToken")}
        </SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.sale.fields.venue.label")}
            htmlFor="venue"
            helper={t("wizard.sale.fields.venue.helper")}
            required
          >
            <WizardInput
              id="venue"
              name="venue"
              defaultValue={defaults.venue}
              placeholder={t("wizard.sale.fields.venue.placeholder")}
              required
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.sale.fields.asset.label")}
            htmlFor="asset"
            helper={t("wizard.sale.fields.asset.helper")}
            required
          >
            <WizardInput
              id="asset"
              name="asset"
              defaultValue={defaults.asset}
              placeholder={t("wizard.sale.fields.asset.placeholder")}
              required
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
          </WizardField>
          <WizardField
            label={t("wizard.sale.fields.tokenChain.label")}
            htmlFor="tokenChain"
            helper={t("wizard.sale.fields.tokenChain.helper")}
          >
            <WizardInput
              id="tokenChain"
              name="tokenChain"
              defaultValue={defaults.tokenChain}
              placeholder={t("wizard.sale.fields.tokenChain.placeholder")}
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.sale.fields.claimWallet.label")}
            htmlFor="claimWallet"
            helper={t("wizard.sale.fields.claimWallet.helper")}
          >
            <WizardInput
              id="claimWallet"
              name="claimWallet"
              defaultValue={defaults.claimWallet}
              placeholder={t("wizard.sale.fields.claimWallet.placeholder")}
              autoComplete="off"
            />
          </WizardField>
        </div>

        {/* ── Round metadata ────────────────────────────────────────── */}
        <SectionLabel>
          {t("wizard.sale.fields.sections.round")}
        </SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.sale.fields.fundraisingRound.label")}
            htmlFor="fundraisingRound"
            helper={t("wizard.sale.fields.fundraisingRound.helper")}
          >
            <WizardSelect
              id="fundraisingRound"
              name="fundraisingRound"
              defaultValue={defaults.fundraisingRound}
            >
              <option value="">
                {t("wizard.sale.fields.fundraisingRound.unset")}
              </option>
              <option value="seed">
                {t("wizard.sale.fields.fundraisingRound.seed")}
              </option>
              <option value="private">
                {t("wizard.sale.fields.fundraisingRound.private")}
              </option>
              <option value="public">
                {t("wizard.sale.fields.fundraisingRound.public")}
              </option>
              <option value="strategic">
                {t("wizard.sale.fields.fundraisingRound.strategic")}
              </option>
              <option value="other">
                {t("wizard.sale.fields.fundraisingRound.other")}
              </option>
            </WizardSelect>
          </WizardField>
          <WizardField
            label={t("wizard.sale.fields.allocationMethod.label")}
            htmlFor="allocationMethod"
            helper={t("wizard.sale.fields.allocationMethod.helper")}
          >
            <WizardSelect
              id="allocationMethod"
              name="allocationMethod"
              defaultValue={defaults.allocationMethod}
            >
              <option value="">
                {t("wizard.sale.fields.allocationMethod.unset")}
              </option>
              <option value="fcfs">
                {t("wizard.sale.fields.allocationMethod.fcfs")}
              </option>
              <option value="lottery">
                {t("wizard.sale.fields.allocationMethod.lottery")}
              </option>
              <option value="staking">
                {t("wizard.sale.fields.allocationMethod.staking")}
              </option>
              <option value="whitelist">
                {t("wizard.sale.fields.allocationMethod.whitelist")}
              </option>
              <option value="other">
                {t("wizard.sale.fields.allocationMethod.other")}
              </option>
            </WizardSelect>
          </WizardField>
          <WizardField
            label={t("wizard.sale.fields.tier.label")}
            htmlFor="tier"
            helper={t("wizard.sale.fields.tier.helper")}
          >
            <WizardInput
              id="tier"
              name="tier"
              defaultValue={defaults.tier}
              placeholder={t("wizard.sale.fields.tier.placeholder")}
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.sale.fields.bonusPct.label")}
            htmlFor="bonusPct"
            helper={t("wizard.sale.fields.bonusPct.helper")}
          >
            <WizardInput
              id="bonusPct"
              name="bonusPct"
              type="number"
              step="0.01"
              min="-100"
              max="500"
              inputMode="decimal"
              defaultValue={defaults.bonusPct}
              placeholder="30"
            />
          </WizardField>
        </div>

        {/* ── Allocation ───────────────────────────────────────────── */}
        <SectionLabel>
          {t("wizard.sale.fields.sections.allocation")}
        </SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.sale.fields.usdPaid.label")}
            htmlFor="usdPaid"
            helper={t("wizard.sale.fields.usdPaid.helper")}
            required
          >
            <WizardInput
              id="usdPaid"
              name="usdPaid"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.usdPaid}
              placeholder="2000.00"
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.sale.fields.tokensAllocated.label")}
            htmlFor="tokensAllocated"
            helper={t("wizard.sale.fields.tokensAllocated.helper")}
            required
          >
            <WizardInput
              id="tokensAllocated"
              name="tokensAllocated"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.tokensAllocated}
              placeholder="1000"
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.sale.fields.saleDate.label")}
            htmlFor="saleDate"
            helper={t("wizard.sale.fields.saleDate.helper")}
          >
            <WizardInput
              id="saleDate"
              name="saleDate"
              type="date"
              defaultValue={defaults.saleDate}
            />
          </WizardField>
          <WizardField
            label={t("wizard.sale.fields.tgeDate.label")}
            htmlFor="tgeDate"
            helper={t("wizard.sale.fields.tgeDate.helper")}
            required
          >
            <WizardInput
              id="tgeDate"
              name="tgeDate"
              type="date"
              defaultValue={defaults.tgeDate}
              required
            />
          </WizardField>
        </div>

        {/* ── Vesting schedule ──────────────────────────────────────── */}
        <SectionLabel>
          {t("wizard.sale.fields.sections.vesting")}
        </SectionLabel>
        <WizardField
          label={t("wizard.sale.fields.tgeUnlockPct.label")}
          htmlFor="tgeUnlockPct"
          helper={t("wizard.sale.fields.tgeUnlockPct.helper")}
          required
        >
          <WizardInput
            id="tgeUnlockPct"
            name="tgeUnlockPct"
            type="number"
            step="1"
            min="0"
            max="100"
            inputMode="numeric"
            defaultValue={defaults.tgeUnlockPct}
            placeholder="20"
            required
          />
        </WizardField>
        <WizardVestingEditor
          name="vestingScheduleJson"
          defaultValue={defaults.vestingScheduleJson}
          labels={{
            variantLabel: t("wizard.sale.fields.vesting.variantLabel"),
            variants: {
              all_at_tge: t("wizard.sale.fields.vesting.variants.allAtTge"),
              tge_plus_linear: t(
                "wizard.sale.fields.vesting.variants.tgePlusLinear",
              ),
              cliff_plus_linear: t(
                "wizard.sale.fields.vesting.variants.cliffPlusLinear",
              ),
              custom: t("wizard.sale.fields.vesting.variants.custom"),
            },
            tgePctLabel: t("wizard.sale.fields.vesting.tgePct"),
            linearDaysLabel: t("wizard.sale.fields.vesting.linearDays"),
            cliffDaysLabel: t("wizard.sale.fields.vesting.cliffDays"),
            customAddRow: t("wizard.sale.fields.vesting.customAddRow"),
            customDate: t("wizard.sale.fields.vesting.customDate"),
            customPct: t("wizard.sale.fields.vesting.customPct"),
            customRunningTotal: t("wizard.sale.fields.vesting.customTotal"),
            customOver100: t("wizard.sale.fields.vesting.customOver100"),
            removeRowAria: t("wizard.sale.fields.vesting.removeRowAria"),
          }}
        />

        {/* ── Mark-to-market ────────────────────────────────────────── */}
        <SectionLabel>{t("wizard.sale.fields.sections.mtm")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.sale.fields.currentPrice.label")}
            htmlFor="currentPriceUsd"
            helper={t("wizard.sale.fields.currentPrice.helper")}
            required
          >
            <WizardInput
              id="currentPriceUsd"
              name="currentPriceUsd"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.currentPriceUsd}
              placeholder="8.40"
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.sale.fields.openedAt.label")}
            htmlFor="openedAt"
            helper={t("wizard.sale.fields.openedAt.helper")}
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
        </div>

        {/* ── Thesis + tags + tax + strategy ─────────────────────────── */}
        <SectionLabel>
          {t("wizard.sale.fields.sections.thesis")}
        </SectionLabel>
        <WizardField
          label={t("wizard.sale.fields.eligibilityReason.label")}
          htmlFor="eligibilityReason"
          helper={t("wizard.sale.fields.eligibilityReason.helper")}
        >
          <WizardInput
            id="eligibilityReason"
            name="eligibilityReason"
            defaultValue={defaults.eligibilityReason}
            placeholder={t(
              "wizard.sale.fields.eligibilityReason.placeholder",
            )}
            autoComplete="off"
          />
        </WizardField>
        <WizardField
          label={t("wizard.sale.fields.note.label")}
          htmlFor="note"
          helper={t("wizard.sale.fields.note.helper")}
        >
          <WizardTextarea
            id="note"
            name="note"
            rows={4}
            defaultValue={defaults.note}
            placeholder={t("wizard.sale.fields.note.placeholder")}
          />
        </WizardField>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.sale.fields.regimeTags.label")}
            htmlFor="regimeTags"
            helper={t("wizard.sale.fields.regimeTags.helper")}
          >
            <WizardInput
              id="regimeTags"
              name="regimeTags"
              defaultValue={defaults.regimeTags}
              placeholder={t("wizard.sale.fields.regimeTags.placeholder")}
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.sale.fields.strategyTag.label")}
            htmlFor="strategyTag"
            helper={t("wizard.sale.fields.strategyTag.helper")}
          >
            <WizardInput
              id="strategyTag"
              name="strategyTag"
              defaultValue={defaults.strategyTag}
              placeholder={t("wizard.sale.fields.strategyTag.placeholder")}
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.sale.fields.taxJurisdiction.label")}
            htmlFor="taxJurisdiction"
            helper={t("wizard.sale.fields.taxJurisdiction.helper")}
          >
            <WizardInput
              id="taxJurisdiction"
              name="taxJurisdiction"
              defaultValue={defaults.taxJurisdiction}
              placeholder={t(
                "wizard.sale.fields.taxJurisdiction.placeholder",
              )}
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.sale.fields.taxTaxable.label")}
            htmlFor="taxTaxable"
            helper={t("wizard.sale.fields.taxTaxable.helper")}
          >
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary has-[input:checked]:border-text has-[input:checked]:bg-subtle has-[input:checked]:text-text">
              <input
                type="checkbox"
                id="taxTaxable"
                name="taxTaxable"
                defaultChecked={defaults.taxTaxable === "on"}
                className="h-3 w-3 accent-text"
              />
              {t("wizard.sale.fields.taxTaxable.toggle")}
            </label>
          </WizardField>
        </div>

        {/* ── Nav ────────────────────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("wizard.sale.fields.back")}
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            {t("wizard.sale.fields.continueToReview")}
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
