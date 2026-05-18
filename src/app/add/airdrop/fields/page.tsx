import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import {
  WizardField,
  WizardInput,
  WizardSelect,
  WizardTextarea,
} from "@/components/wizard/wizard-field";
import { WizardRadioRow } from "@/components/wizard/wizard-radio-row";
import { WizardValidationSummary, type WizardValidationIssue } from "@/components/wizard/wizard-validation-summary";
import { requireUser } from "@/lib/auth/server";
import { getActivity } from "@/lib/db/activity";
import { getT } from "@/lib/i18n/server";
import { parseEligibilityReason } from "../db";

// Reads searchParams + cookies — must run per-request, not at build time.
export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

function isoToDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayIsoDate(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Airdrop details — the data-entry step for the wizard.
 *
 * Status branch (drives required vs optional rendering):
 *   - status=pending  → tokensClaimed / claimDate / usdValueAtClaim optional
 *   - status=claimed  → tokensClaimed / claimDate / usdValueAtClaim required;
 *                        claimDate defaults to today
 *
 * Edit mode (`?edit=<uuid>`): pre-fills from the existing airdrop row
 * including all v5 columns. Status defaults to the row's persisted value.
 */
export default async function AirdropFieldsPage(props: {
  searchParams: Search;
}) {
  const t = await getT();
  const sp = await props.searchParams;
  const editId = getStr(sp, "edit");

  const STEP_LABELS = [
    t("wizard.airdrop.fields.stepLabels.intent"),
    t("wizard.airdrop.fields.stepLabels.details"),
    t("wizard.airdrop.fields.stepLabels.review"),
  ] as const;

  // ── Edit-mode pre-fill ─────────────────────────────────────────────
  let dbDefaults: Partial<{
    status: string;
    protocol: string;
    asset: string;
    tokenChain: string;
    snapshotDate: string;
    tokensClaimed: string;
    claimDate: string;
    usdValueAtClaim: string;
    currentPriceUsd: string;
    claimTxHash: string;
    claimWallet: string;
    gasCostUsd: string;
    claimWindowStart: string;
    claimWindowEnd: string;
    eligibilityReason: string;
    eligibilityConfidence: string;
    note: string;
    regimeTags: string;
    customTags: string;
    strategyTag: string;
    taxTaxable: string;
    taxJurisdiction: string;
    serial: string;
  }> = {};
  let editValid = false;

  if (editId && UUID_RE.test(editId)) {
    const { id: userId } = await requireUser();
    const activity = await getActivity(userId, editId);
    if (activity && activity.subtype.type === "airdrop") {
      // The shared AirdropSubtype type still reflects v1 columns. v5 added
      // claim_wallet / gas_cost_usd / claim_window_*. The DB row carries
      // them (camelCase via postgres.camel transform) — cast through the
      // v5 view so this server component reads the new fields without
      // touching the shared type (it lives in the W1-foundation file).
      const a = activity.subtype.row as typeof activity.subtype.row & {
        claimWallet: string | null;
        gasCostUsd: string | null;
        claimWindowStart: string | null;
        claimWindowEnd: string | null;
        qtyReceived: string | null;
      };
      const { confidence, text } = parseEligibilityReason(a.eligibilityReason);
      dbDefaults = {
        status: activity.status,
        protocol: a.protocol,
        asset: a.tokenSymbol,
        tokenChain: a.tokenChain ?? "",
        snapshotDate: isoToDate(a.snapshotDate),
        tokensClaimed: a.qtyReceived ?? "",
        claimDate: isoToDate(a.claimDate),
        usdValueAtClaim: a.valueAtReceiptUsd ?? "",
        currentPriceUsd: a.currentPriceUsd ?? "",
        claimTxHash: a.claimTxHash ?? "",
        claimWallet: a.claimWallet ?? "",
        gasCostUsd: a.gasCostUsd ?? "",
        claimWindowStart: isoToDate(a.claimWindowStart),
        claimWindowEnd: isoToDate(a.claimWindowEnd),
        eligibilityReason: text,
        eligibilityConfidence: confidence ?? "",
        note: text, // legacy alias — `note` slot in the form maps to eligibility text
        regimeTags: activity.regimeTags.join(", "),
        customTags: activity.customTags.join(", "),
        // strategy_tag + tax flags live on the supertype but aren't surfaced
        // by getActivity()'s return shape. Wave 3 will plumb them through;
        // for now the wizard re-renders the user's last-typed value via the
        // searchParams round-trip (works fine for fresh entries and for the
        // round-trip path; the only edge that misses pre-fill is editing an
        // existing row that already has these set — covered in v3).
        strategyTag: "",
        taxTaxable: "",
        taxJurisdiction: "",
        serial: activity.id.slice(0, 4).toUpperCase(),
      };
      editValid = true;
    }
  }

  // Status precedence: explicit URL ?status=… > edit-mode persisted > 'claimed' default.
  const statusUrl = getStr(sp, "status");
  const status: "pending" | "claimed" =
    statusUrl === "pending" || statusUrl === "claimed"
      ? statusUrl
      : dbDefaults.status === "pending"
      ? "pending"
      : "claimed";
  const isPending = status === "pending";

  // Round-trip safety: if a value was already entered then the user navigates
  // back, the URL holds the inputs verbatim and we render them. Falls back to
  // db pre-fill in edit mode, else clean defaults (today for claim_date when
  // status=claimed, blank for pending).
  const defaults = {
    status,
    protocol: getStr(sp, "protocol") || dbDefaults.protocol || "",
    asset: getStr(sp, "asset") || dbDefaults.asset || "",
    tokenChain: getStr(sp, "tokenChain") || dbDefaults.tokenChain || "",
    snapshotDate: getStr(sp, "snapshotDate") || dbDefaults.snapshotDate || "",
    tokensClaimed: getStr(sp, "tokensClaimed") || dbDefaults.tokensClaimed || "",
    claimDate:
      getStr(sp, "claimDate") ||
      dbDefaults.claimDate ||
      (isPending ? "" : todayIsoDate()),
    usdValueAtClaim: getStr(sp, "usdValueAtClaim") || dbDefaults.usdValueAtClaim || "",
    currentPriceUsd: getStr(sp, "currentPriceUsd") || dbDefaults.currentPriceUsd || "",
    claimTxHash: getStr(sp, "claimTxHash") || dbDefaults.claimTxHash || "",
    claimWallet: getStr(sp, "claimWallet") || dbDefaults.claimWallet || "",
    gasCostUsd: getStr(sp, "gasCostUsd") || dbDefaults.gasCostUsd || "",
    claimWindowStart: getStr(sp, "claimWindowStart") || dbDefaults.claimWindowStart || "",
    claimWindowEnd: getStr(sp, "claimWindowEnd") || dbDefaults.claimWindowEnd || "",
    eligibilityReason:
      getStr(sp, "eligibilityReason") ||
      getStr(sp, "note") || // legacy submit value
      dbDefaults.eligibilityReason ||
      "",
    eligibilityConfidence:
      getStr(sp, "eligibilityConfidence") ||
      dbDefaults.eligibilityConfidence ||
      (isPending ? "expected_unconfirmed" : "claimed_confirmed"),
    regimeTags: getStr(sp, "regimeTags") || dbDefaults.regimeTags || "",
    customTags: getStr(sp, "customTags") || dbDefaults.customTags || "",
    strategyTag: getStr(sp, "strategyTag") || dbDefaults.strategyTag || "",
    taxTaxable: getStr(sp, "taxTaxable") || dbDefaults.taxTaxable || "",
    taxJurisdiction: getStr(sp, "taxJurisdiction") || dbDefaults.taxJurisdiction || "",
  };

  const backHref = editValid ? `/airdrops/${editId}` : "/add/airdrop";

  // Server-side validation echo from /review redirect. We don't gate the form
  // on these — they're advisory until submit — but they surface above so the
  // trader sees what's missing without scrolling.
  const errorRaw = getStr(sp, "validation");
  const validationIssues: WizardValidationIssue[] = errorRaw
    ? errorRaw
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          const idx = line.indexOf(":");
          if (idx < 0) return { message: line };
          return { field: line.slice(0, idx).trim(), message: line.slice(idx + 1).trim() };
        })
    : [];

  const statusOptions = [
    {
      value: "pending",
      title: t("wizard.airdrop.fields.status.pending.title"),
      description: t("wizard.airdrop.fields.status.pending.description"),
      tone: "neutral" as const,
    },
    {
      value: "claimed",
      title: t("wizard.airdrop.fields.status.claimed.title"),
      description: t("wizard.airdrop.fields.status.claimed.description"),
      tone: "up" as const,
    },
  ];

  const confidenceOptions = [
    {
      value: "snapshot_listed",
      title: t("wizard.airdrop.fields.confidence.snapshotListed.title"),
      description: t("wizard.airdrop.fields.confidence.snapshotListed.description"),
    },
    {
      value: "expected_unconfirmed",
      title: t("wizard.airdrop.fields.confidence.expectedUnconfirmed.title"),
      description: t("wizard.airdrop.fields.confidence.expectedUnconfirmed.description"),
    },
    {
      value: "claimed_confirmed",
      title: t("wizard.airdrop.fields.confidence.claimedConfirmed.title"),
      description: t("wizard.airdrop.fields.confidence.claimedConfirmed.description"),
    },
  ];

  const CHAIN_OPTIONS = [
    { value: "", label: t("wizard.airdrop.fields.tokenChain.unspecified") },
    { value: "ethereum", label: "ethereum" },
    { value: "solana", label: "solana" },
    { value: "arbitrum", label: "arbitrum" },
    { value: "optimism", label: "optimism" },
    { value: "base", label: "base" },
    { value: "polygon", label: "polygon" },
    { value: "avalanche", label: "avalanche" },
    { value: "cosmos", label: "cosmos" },
    { value: "sui", label: "sui" },
    { value: "aptos", label: "aptos" },
  ];

  return (
    <WizardShell
      type="airdrop"
      step={2}
      totalSteps={3}
      stepLabels={STEP_LABELS}
      title={
        editValid
          ? t("wizard.airdrop.fields.titleEdit")
          : isPending
          ? t("wizard.airdrop.fields.titlePending")
          : t("wizard.airdrop.fields.title")
      }
      subtitle={
        editValid
          ? t("wizard.airdrop.fields.subtitleEdit")
          : isPending
          ? t("wizard.airdrop.fields.subtitlePending")
          : t("wizard.airdrop.fields.subtitle")
      }
    >
      {editValid && (
        <aside
          className="mb-6 rounded-md border border-warn/30 bg-warn/5 px-4 py-2.5 text-[12px] text-warn"
          role="status"
        >
          <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">
            {t("wizard.airdrop.fields.editingBadge")}
          </span>
          {" — "}
          <span className="font-serif italic">
            {t("wizard.airdrop.fields.editingNotePrefix")}
            {dbDefaults.serial}
            {t("wizard.airdrop.fields.editingNoteSuffix")}
          </span>
        </aside>
      )}

      {validationIssues.length > 0 && (
        <div className="mb-6">
          <WizardValidationSummary errors={validationIssues} />
        </div>
      )}

      <form
        id="airdrop-fields-form"
        action="/add/airdrop/review"
        method="get"
        className="flex flex-col gap-7"
      >
        {editValid && <input type="hidden" name="edit" value={editId} />}

        {/* ── Status (intent) ───────────────────────────────────────── */}
        <SectionLabel>{t("wizard.airdrop.fields.section.status")}</SectionLabel>
        <WizardRadioRow
          name="status"
          defaultValue={defaults.status}
          legend={t("wizard.airdrop.fields.status.legend")}
          requiredCue={t("wizard.airdrop.fields.status.requiredCue")}
          required
          options={statusOptions}
          variant="cards"
        />

        {/* ── Protocol + token ─────────────────────────────────────── */}
        <SectionLabel>{t("wizard.airdrop.fields.section.protocolToken")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.airdrop.fields.protocol.label")}
            htmlFor="protocol"
            required
          >
            <WizardInput
              id="protocol"
              name="protocol"
              defaultValue={defaults.protocol}
              placeholder={t("wizard.airdrop.fields.protocol.placeholder")}
              required
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.fields.asset.label")}
            htmlFor="asset"
            helper={t("wizard.airdrop.fields.asset.helper")}
            required
          >
            <WizardInput
              id="asset"
              name="asset"
              defaultValue={defaults.asset}
              placeholder={t("wizard.airdrop.fields.asset.placeholder")}
              required
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.fields.tokenChain.label")}
            htmlFor="tokenChain"
            helper={t("wizard.airdrop.fields.tokenChain.helper")}
          >
            <WizardSelect id="tokenChain" name="tokenChain" defaultValue={defaults.tokenChain}>
              {CHAIN_OPTIONS.map((c) => (
                <option key={c.value || "unspecified"} value={c.value}>
                  {c.label}
                </option>
              ))}
            </WizardSelect>
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.fields.snapshotDate.label")}
            htmlFor="snapshotDate"
            helper={t("wizard.airdrop.fields.snapshotDate.helper")}
          >
            <WizardInput
              id="snapshotDate"
              name="snapshotDate"
              type="date"
              defaultValue={defaults.snapshotDate}
            />
          </WizardField>
        </div>

        {/* ── Eligibility ───────────────────────────────────────────── */}
        <SectionLabel>{t("wizard.airdrop.fields.section.eligibility")}</SectionLabel>
        <WizardRadioRow
          name="eligibilityConfidence"
          defaultValue={defaults.eligibilityConfidence}
          legend={t("wizard.airdrop.fields.confidence.legend")}
          options={confidenceOptions}
          variant="cards"
        />
        <WizardField
          label={t("wizard.airdrop.fields.eligibilityReason.label")}
          htmlFor="eligibilityReason"
          helper={t("wizard.airdrop.fields.eligibilityReason.helper")}
        >
          <WizardTextarea
            id="eligibilityReason"
            name="eligibilityReason"
            rows={3}
            defaultValue={defaults.eligibilityReason}
            placeholder={t("wizard.airdrop.fields.eligibilityReason.placeholder")}
          />
        </WizardField>

        {/* ── Claim window ─────────────────────────────────────────── */}
        <SectionLabel>{t("wizard.airdrop.fields.section.claimWindow")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.airdrop.fields.claimWindowStart.label")}
            htmlFor="claimWindowStart"
            helper={t("wizard.airdrop.fields.claimWindowStart.helper")}
          >
            <WizardInput
              id="claimWindowStart"
              name="claimWindowStart"
              type="date"
              defaultValue={defaults.claimWindowStart}
            />
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.fields.claimWindowEnd.label")}
            htmlFor="claimWindowEnd"
            helper={t("wizard.airdrop.fields.claimWindowEnd.helper")}
          >
            <WizardInput
              id="claimWindowEnd"
              name="claimWindowEnd"
              type="date"
              defaultValue={defaults.claimWindowEnd}
            />
          </WizardField>
        </div>

        {/* ── Claim (conditional required) ─────────────────────────── */}
        <SectionLabel>
          {isPending
            ? t("wizard.airdrop.fields.section.claimPending")
            : t("wizard.airdrop.fields.section.claim")}
        </SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.airdrop.fields.tokensClaimed.label")}
            htmlFor="tokensClaimed"
            helper={
              isPending
                ? t("wizard.airdrop.fields.tokensClaimed.helperPending")
                : t("wizard.airdrop.fields.tokensClaimed.helper")
            }
            required={!isPending}
          >
            <WizardInput
              id="tokensClaimed"
              name="tokensClaimed"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.tokensClaimed}
              placeholder="2200"
              required={!isPending}
            />
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.fields.claimDate.label")}
            htmlFor="claimDate"
            helper={
              isPending
                ? t("wizard.airdrop.fields.claimDate.helperPending")
                : t("wizard.airdrop.fields.claimDate.helper")
            }
            required={!isPending}
          >
            <WizardInput
              id="claimDate"
              name="claimDate"
              type="date"
              defaultValue={defaults.claimDate}
              required={!isPending}
            />
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.fields.usdValueAtClaim.label")}
            htmlFor="usdValueAtClaim"
            helper={
              isPending
                ? t("wizard.airdrop.fields.usdValueAtClaim.helperPending")
                : t("wizard.airdrop.fields.usdValueAtClaim.helper")
            }
            required={!isPending}
          >
            <WizardInput
              id="usdValueAtClaim"
              name="usdValueAtClaim"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.usdValueAtClaim}
              placeholder="3300.00"
              required={!isPending}
            />
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.fields.currentPriceUsd.label")}
            htmlFor="currentPriceUsd"
            helper={t("wizard.airdrop.fields.currentPriceUsd.helper")}
          >
            <WizardInput
              id="currentPriceUsd"
              name="currentPriceUsd"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.currentPriceUsd}
              placeholder="2.10"
            />
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.fields.gasCostUsd.label")}
            htmlFor="gasCostUsd"
            helper={t("wizard.airdrop.fields.gasCostUsd.helper")}
          >
            <WizardInput
              id="gasCostUsd"
              name="gasCostUsd"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.gasCostUsd}
              placeholder="12.50"
            />
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.fields.claimWallet.label")}
            htmlFor="claimWallet"
            helper={t("wizard.airdrop.fields.claimWallet.helper")}
          >
            <WizardInput
              id="claimWallet"
              name="claimWallet"
              defaultValue={defaults.claimWallet}
              placeholder={t("wizard.airdrop.fields.claimWallet.placeholder")}
              autoComplete="off"
              spellCheck={false}
            />
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.fields.claimTxHash.label")}
            htmlFor="claimTxHash"
            helper={t("wizard.airdrop.fields.claimTxHash.helper")}
            className="md:col-span-2"
          >
            <WizardInput
              id="claimTxHash"
              name="claimTxHash"
              defaultValue={defaults.claimTxHash}
              placeholder={t("wizard.airdrop.fields.claimTxHash.placeholder")}
              autoComplete="off"
              spellCheck={false}
            />
          </WizardField>
        </div>

        {/* ── Tags / strategy / tax ───────────────────────────────── */}
        <SectionLabel>{t("wizard.airdrop.fields.section.attribution")}</SectionLabel>
        <WizardField
          label={t("wizard.airdrop.fields.strategyTag.label")}
          htmlFor="strategyTag"
          helper={t("wizard.airdrop.fields.strategyTag.helper")}
        >
          <WizardInput
            id="strategyTag"
            name="strategyTag"
            defaultValue={defaults.strategyTag}
            placeholder={t("wizard.airdrop.fields.strategyTag.placeholder")}
            autoComplete="off"
          />
        </WizardField>
        <WizardField
          label={t("wizard.airdrop.fields.regimeTags.label")}
          htmlFor="regimeTags"
          helper={t("wizard.airdrop.fields.regimeTags.helper")}
        >
          <WizardInput
            id="regimeTags"
            name="regimeTags"
            defaultValue={defaults.regimeTags}
            placeholder="solana-narrative"
            autoComplete="off"
          />
        </WizardField>
        <WizardField
          label={t("wizard.airdrop.fields.customTags.label")}
          htmlFor="customTags"
          helper={t("wizard.airdrop.fields.customTags.helper")}
        >
          <WizardInput
            id="customTags"
            name="customTags"
            defaultValue={defaults.customTags}
            placeholder={t("wizard.airdrop.fields.customTags.placeholder")}
            autoComplete="off"
          />
        </WizardField>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.airdrop.fields.taxTaxable.label")}
            htmlFor="taxTaxable"
            helper={t("wizard.airdrop.fields.taxTaxable.helper")}
          >
            <label className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 font-mono text-[12px] text-text">
              <input
                id="taxTaxable"
                name="taxTaxable"
                type="checkbox"
                value="1"
                defaultChecked={defaults.taxTaxable === "1"}
              />
              <span>{t("wizard.airdrop.fields.taxTaxable.checkboxLabel")}</span>
            </label>
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.fields.taxJurisdiction.label")}
            htmlFor="taxJurisdiction"
            helper={t("wizard.airdrop.fields.taxJurisdiction.helper")}
          >
            <WizardInput
              id="taxJurisdiction"
              name="taxJurisdiction"
              defaultValue={defaults.taxJurisdiction}
              placeholder="AE"
              autoComplete="off"
            />
          </WizardField>
        </div>

        {/* ── Note (legacy free-form, kept for compatibility) ─────── */}
        <WizardField
          label={t("wizard.airdrop.fields.note.label")}
          htmlFor="note"
          helper={t("wizard.airdrop.fields.note.helper")}
        >
          <WizardTextarea
            id="note"
            name="note"
            rows={4}
            defaultValue={defaults.eligibilityReason}
            placeholder={t("wizard.airdrop.fields.note.placeholder")}
          />
        </WizardField>

        {/* ── Nav ────────────────────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("wizard.airdrop.fields.nav.back")}
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            {t("wizard.airdrop.fields.nav.review")}
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
