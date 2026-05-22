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
import { cn } from "@/lib/utils";
import { requireUser } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { getTradeForEdit, mapExchangeCodeToLabel } from "../db";
import { TradeStatusFields } from "./_status-fields";

export const dynamic = "force-dynamic";

// Exchange labels the picker / mapping layer accepts. Coinbase removed — the
// catalog has no Coinbase entry and the old silent-map-to-kraken behaviour
// fabricated trade venue data. Add new entries here in lockstep with
// EXCHANGE_LABEL_TO_CODE in ../db.ts.
const EXCHANGES = [
  "Binance",
  "Bybit",
  "Hyperliquid",
  "OKX",
  "Deribit",
  "Phemex",
  "Bitget",
  "MEXC",
  "KuCoin",
  "Kraken",
  "Gate",
  "BingX",
] as const;
const INSTRUMENTS = ["perp", "spot", "future"] as const;
const SIDES = ["long", "short"] as const;
const KINDS = ["spot", "perp", "dated_future", "option", "otc", "nft"] as const;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

/** datetime-local <input> wants `YYYY-MM-DDTHH:mm` in local time. */
function isoToDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Step 4 of the trade wizard. Captures every column the v5 schema exposes:
 *   - status toggle  (open / closed / liquidated)
 *   - perp-only      (leverage, margin_mode, funding_paid/received, borrow_cost)
 *   - otc-only       (counterparty, settlement, escrow, premium/discount bps)
 *   - nft-only       (collection, token id, marketplace, royalty %)
 *   - common         (target_price, stop_price, exit_plan, entry_thesis, exit_note)
 *   - cost           (fees_entry / fees_exit — sum into fees_usd server-side)
 *   - rollups        (strategy_tag)
 *
 * The form is a native GET that targets /review. Conditional fieldsets are
 * rendered server-side based on `kind` so we stay client-JS-free.
 */
export default async function TradeFieldsPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;
  const editId = getStr(sp, "edit");

  const STEP_LABELS = [
    t("wizard.trade.stepLabels.source"),
    t("wizard.trade.stepLabels.kind"),
    t("wizard.trade.stepLabels.pick"),
    t("wizard.trade.stepLabels.details"),
    t("wizard.trade.stepLabels.review"),
  ] as const;

  const requiredCue = t("wizard.trade.fields.requiredCue");

  const instrumentLabels: Record<(typeof INSTRUMENTS)[number], string> = {
    perp: t("wizard.trade.fields.instrument.perp"),
    spot: t("wizard.trade.fields.instrument.spot"),
    future: t("wizard.trade.fields.instrument.future"),
  };
  const sideLabels: Record<(typeof SIDES)[number], string> = {
    long: t("wizard.trade.fields.side.long"),
    short: t("wizard.trade.fields.side.short"),
  };

  // Seed from edit-mode DB row when present.
  let dbDefaults: Partial<{
    exchange: string;
    symbol: string;
    instrument: string;
    side: string;
    capital: string;
    qty: string;
    entryPrice: string;
    exitPrice: string;
    fees: string;
    feesEntry: string;
    feesExit: string;
    openedAt: string;
    closedAt: string;
    note: string;
    entryThesis: string;
    exitPlan: string;
    exitNote: string;
    regimeTags: string;
    serial: string;
    kind: string;
    leverage: string;
    marginMode: string;
    fundingPaidUsd: string;
    fundingReceivedUsd: string;
    borrowCostUsd: string;
    targetPrice: string;
    stopPrice: string;
    strategyTag: string;
    status: string;
  }> = {};
  let editValid = false;

  if (editId && UUID_RE.test(editId)) {
    const { id: userId } = await requireUser();
    const row = await getTradeForEdit(userId, editId);
    if (row) {
      // mapExchangeCodeToLabel returns null for codes the wizard doesn't
      // list (e.g. a worker-imported `aster` row when Aster isn't in the
      // picker). Surface the raw code wrapped in a sentinel so the form's
      // <select> shows something the user can react to instead of silently
      // selecting Binance.
      const rawLabel = mapExchangeCodeToLabel(row.exchange);
      const exchangeLabel = rawLabel ?? `— ${row.exchange} (not in picker) —`;
      const instrumentLabel =
        row.instrumentKind === "dated_future" ? "future" : row.instrumentKind;
      dbDefaults = {
        exchange: exchangeLabel,
        symbol: row.symbol,
        instrument: instrumentLabel,
        side: row.side,
        capital: row.capitalDeployedUsd ?? "",
        qty: row.qty,
        entryPrice: row.avgEntryPrice,
        exitPrice: row.avgExitPrice ?? "",
        fees: row.feesUsd,
        feesEntry: row.feesEntryUsd ?? "",
        feesExit: row.feesExitUsd ?? "",
        openedAt: isoToDateTimeLocal(row.openedAt),
        closedAt: isoToDateTimeLocal(row.closedAt),
        note: row.entryThesis ?? "",
        entryThesis: row.entryThesis ?? "",
        exitPlan: row.exitPlan ?? "",
        exitNote: "",
        regimeTags: row.regimeTags.join(", "),
        serial: editId.slice(0, 4).toUpperCase(),
        kind: row.kind,
        leverage: row.leverage ?? "",
        marginMode: row.marginMode ?? "",
        fundingPaidUsd: row.fundingPaidUsd ?? "",
        fundingReceivedUsd: row.fundingReceivedUsd ?? "",
        borrowCostUsd: row.borrowCostUsd ?? "",
        targetPrice: row.targetPrice ?? "",
        stopPrice: row.stopPrice ?? "",
        strategyTag: row.strategyTag ?? "",
        status: row.status,
      };
      editValid = true;
    }
  }

  const kindRaw = getStr(sp, "kind") || dbDefaults.kind || "spot";
  const kind = (KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "spot";
  // Trade status — URL (back-from-review) > edit-mode DB row > closed default.
  // Open trades carry no exit price or close date; the status control hides
  // those fields and the schema makes them optional for an open position.
  const STATUSES = ["open", "closed", "liquidated"] as const;
  const statusRaw = getStr(sp, "status") || dbDefaults.status || "closed";
  const statusDefault: (typeof STATUSES)[number] = (
    STATUSES as readonly string[]
  ).includes(statusRaw)
    ? (statusRaw as (typeof STATUSES)[number])
    : "closed";

  // URL > DB > empty. URL overrides DB so back-from-review keeps user edits.
  const defaults = {
    exchange: getStr(sp, "exchange") || dbDefaults.exchange || "Binance",
    symbol: getStr(sp, "symbol") || dbDefaults.symbol || "",
    instrument: getStr(sp, "instrument") || dbDefaults.instrument || inferInstrumentFromKind(kind),
    side: getStr(sp, "side") || dbDefaults.side || "long",
    capital: getStr(sp, "capital") || dbDefaults.capital || "",
    entryPrice: getStr(sp, "entryPrice") || dbDefaults.entryPrice || "",
    exitPrice: getStr(sp, "exitPrice") || dbDefaults.exitPrice || "",
    qty: getStr(sp, "qty") || dbDefaults.qty || "",
    fees: getStr(sp, "fees") || dbDefaults.fees || "",
    feesEntry: getStr(sp, "feesEntry") || dbDefaults.feesEntry || "",
    feesExit: getStr(sp, "feesExit") || dbDefaults.feesExit || "",
    openedAt: getStr(sp, "openedAt") || dbDefaults.openedAt || "",
    closedAt: getStr(sp, "closedAt") || dbDefaults.closedAt || "",
    entryThesis: getStr(sp, "entryThesis") || dbDefaults.entryThesis || getStr(sp, "note") || dbDefaults.note || "",
    exitPlan: getStr(sp, "exitPlan") || dbDefaults.exitPlan || "",
    exitNote: getStr(sp, "exitNote") || dbDefaults.exitNote || "",
    regimeTags: getStr(sp, "regimeTags") || dbDefaults.regimeTags || "",
    source: getStr(sp, "source"),
    positionId: getStr(sp, "positionId"),
    // Per-kind columns
    leverage: getStr(sp, "leverage") || dbDefaults.leverage || "",
    marginMode: getStr(sp, "marginMode") || dbDefaults.marginMode || "",
    fundingPaidUsd: getStr(sp, "fundingPaidUsd") || dbDefaults.fundingPaidUsd || "",
    fundingReceivedUsd: getStr(sp, "fundingReceivedUsd") || dbDefaults.fundingReceivedUsd || "",
    borrowCostUsd: getStr(sp, "borrowCostUsd") || dbDefaults.borrowCostUsd || "",
    targetPrice: getStr(sp, "targetPrice") || dbDefaults.targetPrice || "",
    stopPrice: getStr(sp, "stopPrice") || dbDefaults.stopPrice || "",
    // OTC
    counterparty: getStr(sp, "counterparty"),
    settlementDate: getStr(sp, "settlementDate"),
    escrowMethod: getStr(sp, "escrowMethod"),
    premiumOrDiscountBps: getStr(sp, "premiumOrDiscountBps"),
    // NFT
    collection: getStr(sp, "collection"),
    tokenId: getStr(sp, "tokenId"),
    marketplace: getStr(sp, "marketplace"),
    royaltyPct: getStr(sp, "royaltyPct"),
    // Rollups
    strategyTag: getStr(sp, "strategyTag") || dbDefaults.strategyTag || "",
  };

  const backHref = editValid
    ? `/trades/${editId}`
    : defaults.source === "manual"
      ? `/add/trade/kind?source=manual&kind=${encodeURIComponent(kind)}`
      : kind === "otc" || kind === "nft" || kind === "option"
        ? `/add/trade/kind?source=${defaults.source || "auto"}&kind=${encodeURIComponent(kind)}`
        : `/add/trade/pick?source=auto&kind=${encodeURIComponent(kind)}`;

  // Inline validation surface — populated when the action redirects back with
  // `?error=...`. Shown above the form so the user sees it before scrolling.
  const validationErrors = getStr(sp, "error")
    ? [{ message: getStr(sp, "error") }]
    : [];

  // "Convert to spread leg" exit ramp. Posts the current draft (just the
  // fields a spread-leg cares about) to the spread wizard's fields step. The
  // spread wizard reads these prefilled legs and inserts them into its leg
  // list. Plain GET keeps it free of client JS.

  return (
    <WizardShell
      type="trade"
      step={4}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={editValid ? t("wizard.trade.fields.titleEdit") : t("wizard.trade.fields.titleCreate")}
      subtitle={
        editValid
          ? t("wizard.trade.fields.subtitleEdit")
          : defaults.positionId
            ? t("wizard.trade.fields.subtitleFromFill")
            : t("wizard.trade.fields.subtitleManual")
      }
    >
      {editValid && (
        <aside
          className="mb-6 rounded-md border border-warn/30 bg-warn/5 px-4 py-2.5 text-[12px] text-warn"
          role="status"
        >
          <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">
            {t("wizard.trade.fields.editingBadge")}
          </span>
          {" — "}
          <span className="font-serif italic">
            {t("wizard.trade.fields.editingDetail", { serial: dbDefaults.serial ?? "" })}
          </span>
        </aside>
      )}

      {validationErrors.length > 0 && (
        <WizardValidationSummary
          errors={validationErrors}
          className="mb-6"
          title={t("wizard.trade.fields.validationTitle")}
        />
      )}

      <form
        id="trade-fields-form"
        action="/add/trade/review"
        method="get"
        className="flex flex-col gap-7"
      >
        {/* Hidden pass-through fields */}
        {editValid && <input type="hidden" name="edit" value={editId} />}
        {defaults.positionId && (
          <input type="hidden" name="positionId" value={defaults.positionId} />
        )}
        {defaults.source && (
          <input type="hidden" name="source" value={defaults.source} />
        )}
        <input type="hidden" name="kind" value={kind} />

        {/* ── Venue + symbol ─────────────────────────────────────────── */}
        <SectionLabel>{t("wizard.trade.fields.sections.venue")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField label={t("wizard.trade.fields.labels.exchange")} htmlFor="exchange" required>
            <WizardSelect id="exchange" name="exchange" defaultValue={defaults.exchange} required>
              {EXCHANGES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </WizardSelect>
          </WizardField>
          <WizardField
            label={t("wizard.trade.fields.labels.symbol")}
            htmlFor="symbol"
            helper={t("wizard.trade.fields.helpers.symbol")}
            required
          >
            <WizardInput
              id="symbol"
              name="symbol"
              defaultValue={defaults.symbol}
              placeholder="BTC-PERP"
              required
              autoComplete="off"
            />
          </WizardField>
        </div>

        {/* ── Instrument + side ──────────────────────────────────────── */}
        <SectionLabel>{t("wizard.trade.fields.sections.shape")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <RadioRow
            legend={t("wizard.trade.fields.labels.instrument")}
            name="instrument"
            requiredCue={requiredCue}
            options={INSTRUMENTS.map((i) => ({ value: i, label: instrumentLabels[i] }))}
            defaultValue={defaults.instrument}
          />
          <RadioRow
            legend={t("wizard.trade.fields.labels.side")}
            name="side"
            requiredCue={requiredCue}
            options={SIDES.map((s) => ({
              value: s,
              label: sideLabels[s],
              tone: s === "long" ? "up" : "down",
            }))}
            defaultValue={defaults.side}
          />
        </div>

        {/* ── Numbers ────────────────────────────────────────────────── */}
        <SectionLabel>{t("wizard.trade.fields.sections.numbers")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.trade.fields.labels.capital")}
            htmlFor="capital"
            helper={t("wizard.trade.fields.helpers.usd")}
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
              placeholder="24800.00"
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.trade.fields.labels.qty")}
            htmlFor="qty"
            helper={t("wizard.trade.fields.helpers.qty")}
            required
          >
            <WizardInput
              id="qty"
              name="qty"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.qty}
              placeholder="0.50"
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.trade.fields.labels.entryPrice")}
            htmlFor="entryPrice"
            helper={t("wizard.trade.fields.helpers.usd")}
            required
          >
            <WizardInput
              id="entryPrice"
              name="entryPrice"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.entryPrice}
              placeholder="64200.00"
              required
            />
          </WizardField>

          {/* Fees decomposition. Two boxes keeps the cost-attribution clean
              for the review's stacked-bar render. Either-or vs the old total
              is fine — when both are 0 the server falls back to `fees`. */}
          <WizardField
            label={t("wizard.trade.fields.labels.feesEntry")}
            htmlFor="feesEntry"
            helper={t("wizard.trade.fields.helpers.feesEntry")}
          >
            <WizardInput
              id="feesEntry"
              name="feesEntry"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.feesEntry}
              placeholder="6.25"
            />
          </WizardField>
          <WizardField
            label={t("wizard.trade.fields.labels.feesExit")}
            htmlFor="feesExit"
            helper={t("wizard.trade.fields.helpers.feesExit")}
          >
            <WizardInput
              id="feesExit"
              name="feesExit"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.feesExit}
              placeholder="6.25"
            />
          </WizardField>
          {/* Legacy single "fees" passthrough — only rendered (and used) when
              the form was prefilled with it (auto path from picker). Lets the
              server merge it into fees_entry without forcing users to split
              an already-imported total. */}
          {defaults.fees && !defaults.feesEntry && !defaults.feesExit && (
            <input type="hidden" name="fees" value={defaults.fees} />
          )}
        </div>
        {/* ── Status & lifecycle ─────────────────────────────────────── */}
        <SectionLabel>{t("wizard.trade.fields.sections.lifecycle")}</SectionLabel>
        <TradeStatusFields
          defaultStatus={statusDefault}
          defaultOpenedAt={defaults.openedAt}
          defaultClosedAt={defaults.closedAt}
          defaultExitPrice={defaults.exitPrice}
        />

        {/* ── Open-intent ────────────────────────────────────────────── */}
        <SectionLabel>{t("wizard.trade.fields.sections.intent")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.trade.fields.labels.targetPrice")}
            htmlFor="targetPrice"
            helper={t("wizard.trade.fields.helpers.targetPrice")}
          >
            <WizardInput
              id="targetPrice"
              name="targetPrice"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.targetPrice}
              placeholder="72000.00"
            />
          </WizardField>
          <WizardField
            label={t("wizard.trade.fields.labels.stopPrice")}
            htmlFor="stopPrice"
            helper={t("wizard.trade.fields.helpers.stopPrice")}
          >
            <WizardInput
              id="stopPrice"
              name="stopPrice"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.stopPrice}
              placeholder="61500.00"
            />
          </WizardField>
        </div>
        <WizardField
          label={t("wizard.trade.fields.labels.exitPlan")}
          htmlFor="exitPlan"
          helper={t("wizard.trade.fields.helpers.exitPlan")}
        >
          <WizardTextarea
            id="exitPlan"
            name="exitPlan"
            rows={3}
            defaultValue={defaults.exitPlan}
            placeholder={t("wizard.trade.fields.placeholders.exitPlan")}
          />
        </WizardField>

        {/* ── Perp-only ──────────────────────────────────────────────── */}
        {kind === "perp" && (
          <>
            <SectionLabel>{t("wizard.trade.fields.sections.perp")}</SectionLabel>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <WizardField
                label={t("wizard.trade.fields.labels.leverage")}
                htmlFor="leverage"
                helper={t("wizard.trade.fields.helpers.leverage")}
              >
                <WizardInput
                  id="leverage"
                  name="leverage"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  defaultValue={defaults.leverage}
                  placeholder="3.00"
                />
              </WizardField>
              <RadioRow
                legend={t("wizard.trade.fields.labels.marginMode")}
                name="marginMode"
                options={[
                  { value: "cross", label: t("wizard.trade.fields.marginMode.cross") },
                  { value: "isolated", label: t("wizard.trade.fields.marginMode.isolated") },
                ]}
                defaultValue={defaults.marginMode}
              />
              <WizardField
                label={t("wizard.trade.fields.labels.fundingPaid")}
                htmlFor="fundingPaidUsd"
                helper={t("wizard.trade.fields.helpers.usd")}
              >
                <WizardInput
                  id="fundingPaidUsd"
                  name="fundingPaidUsd"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  defaultValue={defaults.fundingPaidUsd}
                  placeholder="12.40"
                />
              </WizardField>
              <WizardField
                label={t("wizard.trade.fields.labels.fundingReceived")}
                htmlFor="fundingReceivedUsd"
                helper={t("wizard.trade.fields.helpers.usd")}
              >
                <WizardInput
                  id="fundingReceivedUsd"
                  name="fundingReceivedUsd"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  defaultValue={defaults.fundingReceivedUsd}
                  placeholder="0.00"
                />
              </WizardField>
              <WizardField
                label={t("wizard.trade.fields.labels.borrowCost")}
                htmlFor="borrowCostUsd"
                helper={t("wizard.trade.fields.helpers.usd")}
              >
                <WizardInput
                  id="borrowCostUsd"
                  name="borrowCostUsd"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  defaultValue={defaults.borrowCostUsd}
                  placeholder="0.00"
                />
              </WizardField>
            </div>
          </>
        )}

        {/* ── OTC-only ───────────────────────────────────────────────── */}
        {kind === "otc" && (
          <>
            <SectionLabel>{t("wizard.trade.fields.sections.otc")}</SectionLabel>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <WizardField
                label={t("wizard.trade.fields.labels.counterparty")}
                htmlFor="counterparty"
                helper={t("wizard.trade.fields.helpers.counterparty")}
              >
                <WizardInput
                  id="counterparty"
                  name="counterparty"
                  defaultValue={defaults.counterparty}
                  placeholder="Cumberland"
                  autoComplete="off"
                />
              </WizardField>
              <WizardField
                label={t("wizard.trade.fields.labels.settlementDate")}
                htmlFor="settlementDate"
              >
                <WizardInput
                  id="settlementDate"
                  name="settlementDate"
                  type="date"
                  defaultValue={defaults.settlementDate}
                />
              </WizardField>
              <WizardField
                label={t("wizard.trade.fields.labels.escrowMethod")}
                htmlFor="escrowMethod"
              >
                <WizardSelect
                  id="escrowMethod"
                  name="escrowMethod"
                  defaultValue={defaults.escrowMethod}
                >
                  <option value="">—</option>
                  <option value="direct">{t("wizard.trade.fields.escrow.direct")}</option>
                  <option value="custodian">{t("wizard.trade.fields.escrow.custodian")}</option>
                  <option value="multisig">{t("wizard.trade.fields.escrow.multisig")}</option>
                  <option value="other">{t("wizard.trade.fields.escrow.other")}</option>
                </WizardSelect>
              </WizardField>
              <WizardField
                label={t("wizard.trade.fields.labels.premiumOrDiscountBps")}
                htmlFor="premiumOrDiscountBps"
                helper={t("wizard.trade.fields.helpers.premiumOrDiscountBps")}
              >
                <WizardInput
                  id="premiumOrDiscountBps"
                  name="premiumOrDiscountBps"
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  defaultValue={defaults.premiumOrDiscountBps}
                  placeholder="-25"
                />
              </WizardField>
            </div>
          </>
        )}

        {/* ── NFT-only ───────────────────────────────────────────────── */}
        {kind === "nft" && (
          <>
            <SectionLabel>{t("wizard.trade.fields.sections.nft")}</SectionLabel>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <WizardField
                label={t("wizard.trade.fields.labels.collection")}
                htmlFor="collection"
                helper={t("wizard.trade.fields.helpers.collection")}
              >
                <WizardInput
                  id="collection"
                  name="collection"
                  defaultValue={defaults.collection}
                  placeholder="Pudgy Penguins"
                  autoComplete="off"
                />
              </WizardField>
              <WizardField label={t("wizard.trade.fields.labels.tokenId")} htmlFor="tokenId">
                <WizardInput
                  id="tokenId"
                  name="tokenId"
                  defaultValue={defaults.tokenId}
                  placeholder="3947"
                  autoComplete="off"
                />
              </WizardField>
              <WizardField label={t("wizard.trade.fields.labels.marketplace")} htmlFor="marketplace">
                <WizardSelect
                  id="marketplace"
                  name="marketplace"
                  defaultValue={defaults.marketplace}
                >
                  <option value="">—</option>
                  <option value="opensea">OpenSea</option>
                  <option value="blur">Blur</option>
                  <option value="magic_eden">Magic Eden</option>
                  <option value="tensor">Tensor</option>
                  <option value="other">{t("wizard.trade.fields.escrow.other")}</option>
                </WizardSelect>
              </WizardField>
              <WizardField
                label={t("wizard.trade.fields.labels.royaltyPct")}
                htmlFor="royaltyPct"
                helper={t("wizard.trade.fields.helpers.royaltyPct")}
              >
                <WizardInput
                  id="royaltyPct"
                  name="royaltyPct"
                  type="number"
                  step="0.1"
                  min="0"
                  inputMode="decimal"
                  defaultValue={defaults.royaltyPct}
                  placeholder="5.0"
                />
              </WizardField>
            </div>
          </>
        )}

        {/* ── Thesis / exit note / tags ──────────────────────────────── */}
        <SectionLabel>{t("wizard.trade.fields.sections.thesisTags")}</SectionLabel>
        <WizardField
          label={t("wizard.trade.fields.labels.entryThesis")}
          htmlFor="entryThesis"
          helper={t("wizard.trade.fields.helpers.entryThesis")}
        >
          <WizardTextarea
            id="entryThesis"
            name="entryThesis"
            rows={4}
            defaultValue={defaults.entryThesis}
            placeholder={t("wizard.trade.fields.placeholders.entryThesis")}
          />
        </WizardField>
        <WizardField
          label={t("wizard.trade.fields.labels.exitNote")}
          htmlFor="exitNote"
          helper={t("wizard.trade.fields.helpers.exitNote")}
        >
          <WizardTextarea
            id="exitNote"
            name="exitNote"
            rows={3}
            defaultValue={defaults.exitNote}
            placeholder={t("wizard.trade.fields.placeholders.exitNote")}
          />
        </WizardField>
        <WizardField
          label={t("wizard.trade.fields.labels.regimeTags")}
          htmlFor="regimeTags"
          helper={t("wizard.trade.fields.helpers.regimeTags")}
        >
          <WizardInput
            id="regimeTags"
            name="regimeTags"
            defaultValue={defaults.regimeTags}
            placeholder="risk-on, funding-positive"
            autoComplete="off"
          />
        </WizardField>

        {/* ── Strategy rollups ──────────────────────────────────────── */}
        <SectionLabel>{t("wizard.trade.fields.sections.rollups")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.trade.fields.labels.strategyTag")}
            htmlFor="strategyTag"
            helper={t("wizard.trade.fields.helpers.strategyTag")}
          >
            <WizardInput
              id="strategyTag"
              name="strategyTag"
              defaultValue={defaults.strategyTag}
              placeholder="ETH basis carry Q1"
              autoComplete="off"
            />
          </WizardField>
        </div>

        {/* ── Footer: nav ────────────────────────────────────────────── */}
        <div className="mt-6 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <Link
              href={backHref}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
            >
              <ArrowLeft className="h-3 w-3" />
              {t("wizard.trade.fields.back")}
            </Link>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
            >
              {t("wizard.trade.fields.review")}
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
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

function inferInstrumentFromKind(kind: string): string {
  if (kind === "perp") return "perp";
  if (kind === "dated_future") return "future";
  if (kind === "spot" || kind === "nft" || kind === "otc") return "spot";
  return "perp";
}

function RadioRow({
  legend,
  name,
  options,
  defaultValue,
  requiredCue,
}: {
  legend: string;
  name: string;
  options: { value: string; label: string; tone?: "up" | "down" | "neutral" }[];
  defaultValue: string;
  requiredCue?: string;
}) {
  const id = `radio-${name}`;
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend
        id={id}
        className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
      >
        {legend}
        {requiredCue && <span className="ml-1.5 text-text-disabled">{requiredCue}</span>}
      </legend>
      <div
        role="radiogroup"
        aria-labelledby={id}
        className="grid grid-cols-3 gap-2"
      >
        {options.map((opt) => (
          <label
            key={opt.value}
            className={cn(
              "flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
              "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
              "has-[input:checked]:border-text has-[input:checked]:bg-subtle has-[input:checked]:text-text",
              opt.tone === "up" &&
                "has-[input:checked]:border-up has-[input:checked]:bg-up/10 has-[input:checked]:text-up",
              opt.tone === "down" &&
                "has-[input:checked]:border-down has-[input:checked]:bg-down/10 has-[input:checked]:text-down",
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              defaultChecked={defaultValue === opt.value}
              required={Boolean(requiredCue)}
              className="sr-only"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

