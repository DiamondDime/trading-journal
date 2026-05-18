import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioRow } from "@/components/wizard/wizard-radio-row";
import { WizardNav } from "@/components/wizard/wizard-nav";
import {
  WizardField,
  WizardInput,
  WizardTextarea,
} from "@/components/wizard/wizard-field";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/server";
import { getOptionForEdit } from "../db";

export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

function isoToDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Option wizard step 4 — Fields.
 *
 * option_spread surfaces the spread-style picker. Single_leg skips it.
 *
 * Common open-intent + analytics fields apply to both:
 *   - expected_holding_days
 *   - target_underlying_price + stop_underlying_price
 *   - max_loss_usd_accepted (drives max_loss_usd on the activity_option header)
 *   - target_iv_change_bps (IV-target the trader was watching for)
 *   - exit thesis (defaults to "close at 50% of max profit")
 *   - strategy_tag + tax flags + regime tags
 */
export default async function OptionFieldsPage(props: { searchParams: Search }) {
  const t = await getT();
  const STEP_LABELS = [
    t("wizard.option.stepLabels.kind"),
    t("wizard.option.stepLabels.legs"),
    t("wizard.option.stepLabels.fields"),
    t("wizard.option.stepLabels.review"),
  ] as const;

  const sp = await props.searchParams;
  const subtype = getStr(sp, "subtype", "single_leg");
  const editId = getStr(sp, "edit");
  const isSpread = subtype === "option_spread";

  // Edit mode: hydrate the header defaults from DB.
  let dbDefaults: {
    underlying?: string;
    exchange?: string;
    spread_style?: string;
    iv_at_open?: string;
    entry_thesis?: string;
    exit_plan?: string;
    target_price?: string;
    stop_price?: string;
    max_loss_usd?: string;
    max_profit_usd?: string;
    opened_at?: string;
    name?: string;
    regime_tags?: string;
    strategy_tag?: string;
    tax_taxable?: boolean;
    tax_jurisdiction?: string;
  } = {};
  let editValid = false;
  if (editId && UUID_RE.test(editId)) {
    const { id: userId } = await requireUser();
    const loaded = await getOptionForEdit(userId, editId);
    if (loaded) {
      dbDefaults = {
        underlying: loaded.option.underlying,
        exchange: loaded.option.exchange,
        spread_style: loaded.option.spreadStyle ?? "",
        iv_at_open: loaded.option.ivAtOpen ?? "",
        entry_thesis: loaded.option.entryThesis ?? "",
        exit_plan: loaded.option.exitPlan ?? "",
        target_price: loaded.option.targetPrice ?? "",
        stop_price: loaded.option.stopPrice ?? "",
        max_loss_usd: loaded.option.maxLossUsd ?? "",
        max_profit_usd: loaded.option.maxProfitUsd ?? "",
        opened_at: isoToDateTimeLocal(loaded.activity.openedAt),
        name: loaded.activity.name,
        regime_tags: loaded.activity.regimeTags.join(", "),
        strategy_tag: loaded.activity.strategyTag ?? "",
        tax_taxable: loaded.activity.taxTaxable,
        tax_jurisdiction: loaded.activity.taxJurisdiction ?? "",
      };
      editValid = true;
    }
  }

  // Defaults take searchParam first (back-nav from /review), DB second.
  const defaults = {
    underlying:
      getStr(sp, "underlying") || dbDefaults.underlying || "BTC",
    exchange:
      getStr(sp, "exchange") || dbDefaults.exchange || "deribit",
    spread_style:
      getStr(sp, "spread_style") || dbDefaults.spread_style || "vertical",
    iv_at_open:
      getStr(sp, "iv_at_open") || dbDefaults.iv_at_open || "",
    entry_thesis:
      getStr(sp, "entry_thesis") || dbDefaults.entry_thesis || "",
    exit_plan:
      getStr(sp, "exit_plan") ||
      dbDefaults.exit_plan ||
      t("wizard.option.fields.exitPlanDefault"),
    target_price:
      getStr(sp, "target_price") || dbDefaults.target_price || "",
    stop_price: getStr(sp, "stop_price") || dbDefaults.stop_price || "",
    max_loss_usd:
      getStr(sp, "max_loss_usd") || dbDefaults.max_loss_usd || "",
    max_profit_usd:
      getStr(sp, "max_profit_usd") || dbDefaults.max_profit_usd || "",
    expected_holding_days: getStr(sp, "expected_holding_days") || "",
    target_iv_change_bps: getStr(sp, "target_iv_change_bps") || "",
    opened_at:
      getStr(sp, "opened_at") || dbDefaults.opened_at || "",
    name: getStr(sp, "name") || dbDefaults.name || "",
    regime_tags:
      getStr(sp, "regime_tags") || dbDefaults.regime_tags || "",
    strategy_tag:
      getStr(sp, "strategy_tag") || dbDefaults.strategy_tag || "",
    tax_taxable:
      getStr(sp, "tax_taxable", dbDefaults.tax_taxable ? "true" : "") ||
      (dbDefaults.tax_taxable ? "true" : ""),
    tax_jurisdiction:
      getStr(sp, "tax_jurisdiction") || dbDefaults.tax_jurisdiction || "",
    status: getStr(sp, "status") || "open",
  };

  // Forward every searchParam key/value into the form as hidden inputs
  // so legs[i].* survive the GET → /review round trip.
  const passthroughEntries = Object.entries(sp).filter(([k]) =>
    k.startsWith("legs["),
  );

  // Exchange catalog snapshot — we keep it local to avoid hitting the DB
  // on every wizard render (the auto-import path will land later).
  const EXCHANGES = [
    "deribit",
    "binance",
    "bybit",
    "okx",
    "kraken",
    "bitget",
    "gate",
  ];

  return (
    <WizardShell
      type="option"
      step={3}
      totalSteps={4}
      stepLabels={STEP_LABELS}
      title={
        editValid
          ? t("wizard.option.fields.titleEdit")
          : t("wizard.option.fields.title")
      }
      subtitle={
        isSpread
          ? t("wizard.option.fields.subtitleSpread")
          : t("wizard.option.fields.subtitleSingle")
      }
    >
      <form
        id="option-fields-form"
        action="/add/option/review"
        method="get"
        className="flex flex-col gap-7"
      >
        {editId && <input type="hidden" name="edit" value={editId} />}
        <input type="hidden" name="subtype" value={subtype} />
        {/* Forward leg payload from /legs back-nav. */}
        {passthroughEntries.map(([k, v]) => {
          if (Array.isArray(v)) {
            return v.map((val, i) => (
              <input
                key={`${k}-${i}`}
                type="hidden"
                name={k}
                value={String(val)}
              />
            ));
          }
          return (
            <input
              key={k}
              type="hidden"
              name={k}
              value={String(v ?? "")}
            />
          );
        })}

        {/* ── Header ─────────────────────────────────────────────────── */}
        <SectionLabel>{t("wizard.option.fields.sections.header")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.option.fields.underlying.label")}
            htmlFor="opt-underlying"
            helper={t("wizard.option.fields.underlying.helper")}
            required
          >
            <WizardInput
              id="opt-underlying"
              name="underlying"
              defaultValue={defaults.underlying}
              placeholder={t("wizard.option.fields.underlying.placeholder")}
              required
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
          </WizardField>
          <WizardField
            label={t("wizard.option.fields.exchange.label")}
            htmlFor="opt-exchange"
            helper={t("wizard.option.fields.exchange.helper")}
            required
          >
            <select
              id="opt-exchange"
              name="exchange"
              defaultValue={defaults.exchange}
              required
              className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-[13px] text-text focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-text"
            >
              {EXCHANGES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </WizardField>
        </div>

        {/* ── Spread style (option_spread only) ──────────────────────── */}
        {isSpread && (
          <>
            <SectionLabel>
              {t("wizard.option.fields.sections.style")}
            </SectionLabel>
            <WizardRadioRow
              name="spread_style"
              legend={t("wizard.option.fields.styleLegend")}
              requiredCue={t("wizard.option.required")}
              required
              defaultValue={defaults.spread_style}
              variant="cards"
              options={[
                {
                  value: "vertical",
                  title: t("wizard.option.styles.vertical.title"),
                  description: t("wizard.option.styles.vertical.description"),
                },
                {
                  value: "iron_condor",
                  title: t("wizard.option.styles.ironCondor.title"),
                  description: t("wizard.option.styles.ironCondor.description"),
                },
                {
                  value: "calendar",
                  title: t("wizard.option.styles.calendar.title"),
                  description: t("wizard.option.styles.calendar.description"),
                },
                {
                  value: "strangle",
                  title: t("wizard.option.styles.strangle.title"),
                  description: t("wizard.option.styles.strangle.description"),
                },
                {
                  value: "butterfly",
                  title: t("wizard.option.styles.butterfly.title"),
                  description: t("wizard.option.styles.butterfly.description"),
                },
                {
                  value: "custom",
                  title: t("wizard.option.styles.custom.title"),
                  description: t("wizard.option.styles.custom.description"),
                },
              ]}
            />
          </>
        )}

        {/* ── Open-intent (target / stop / IV) ───────────────────────── */}
        <SectionLabel>{t("wizard.option.fields.sections.intent")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.option.fields.targetPrice.label")}
            htmlFor="opt-target-price"
            helper={t("wizard.option.fields.targetPrice.helper")}
          >
            <WizardInput
              id="opt-target-price"
              name="target_price"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.target_price}
              placeholder={t("wizard.option.fields.targetPrice.placeholder")}
            />
          </WizardField>
          <WizardField
            label={t("wizard.option.fields.stopPrice.label")}
            htmlFor="opt-stop-price"
            helper={t("wizard.option.fields.stopPrice.helper")}
          >
            <WizardInput
              id="opt-stop-price"
              name="stop_price"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.stop_price}
              placeholder={t("wizard.option.fields.stopPrice.placeholder")}
            />
          </WizardField>
          <WizardField
            label={t("wizard.option.fields.maxLoss.label")}
            htmlFor="opt-max-loss"
            helper={t("wizard.option.fields.maxLoss.helper")}
          >
            <WizardInput
              id="opt-max-loss"
              name="max_loss_usd"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.max_loss_usd}
              placeholder="2000"
            />
          </WizardField>
          <WizardField
            label={t("wizard.option.fields.maxProfit.label")}
            htmlFor="opt-max-profit"
            helper={t("wizard.option.fields.maxProfit.helper")}
          >
            <WizardInput
              id="opt-max-profit"
              name="max_profit_usd"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.max_profit_usd}
              placeholder="3000"
            />
          </WizardField>
          <WizardField
            label={t("wizard.option.fields.ivAtOpen.label")}
            htmlFor="opt-iv-at-open"
            helper={t("wizard.option.fields.ivAtOpen.helper")}
          >
            <WizardInput
              id="opt-iv-at-open"
              name="iv_at_open"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.iv_at_open}
              placeholder={t("wizard.option.fields.ivAtOpen.placeholder")}
            />
          </WizardField>
          <WizardField
            label={t("wizard.option.fields.targetIvChangeBps.label")}
            htmlFor="opt-target-iv-bps"
            helper={t("wizard.option.fields.targetIvChangeBps.helper")}
          >
            <WizardInput
              id="opt-target-iv-bps"
              name="target_iv_change_bps"
              type="number"
              step="any"
              inputMode="numeric"
              defaultValue={defaults.target_iv_change_bps}
              placeholder="500"
            />
          </WizardField>
          <WizardField
            label={t("wizard.option.fields.expectedHoldingDays.label")}
            htmlFor="opt-holding-days"
            helper={t("wizard.option.fields.expectedHoldingDays.helper")}
          >
            <WizardInput
              id="opt-holding-days"
              name="expected_holding_days"
              type="number"
              step="1"
              min="0"
              inputMode="numeric"
              defaultValue={defaults.expected_holding_days}
              placeholder="14"
            />
          </WizardField>
          <WizardField
            label={t("wizard.option.fields.openedAt.label")}
            htmlFor="opt-opened-at"
            helper={t("wizard.option.fields.openedAt.helper")}
            required
          >
            <WizardInput
              id="opt-opened-at"
              name="opened_at"
              type="datetime-local"
              defaultValue={defaults.opened_at}
              required
            />
          </WizardField>
        </div>

        {/* ── Thesis + exit plan ─────────────────────────────────────── */}
        <SectionLabel>{t("wizard.option.fields.sections.thesis")}</SectionLabel>
        <WizardField
          label={t("wizard.option.fields.entryThesis.label")}
          htmlFor="opt-entry-thesis"
          helper={t("wizard.option.fields.entryThesis.helper")}
        >
          <WizardTextarea
            id="opt-entry-thesis"
            name="entry_thesis"
            rows={3}
            defaultValue={defaults.entry_thesis}
            placeholder={t("wizard.option.fields.entryThesis.placeholder")}
          />
        </WizardField>
        <WizardField
          label={t("wizard.option.fields.exitPlan.label")}
          htmlFor="opt-exit-plan"
          helper={t("wizard.option.fields.exitPlan.helper")}
        >
          <WizardTextarea
            id="opt-exit-plan"
            name="exit_plan"
            rows={3}
            defaultValue={defaults.exit_plan}
            placeholder={t("wizard.option.fields.exitPlan.placeholder")}
          />
        </WizardField>

        {/* ── Strategy + tax ─────────────────────────────────────────── */}
        <SectionLabel>{t("wizard.option.fields.sections.strategy")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.option.fields.name.label")}
            htmlFor="opt-name"
            helper={t("wizard.option.fields.name.helper")}
          >
            <WizardInput
              id="opt-name"
              name="name"
              defaultValue={defaults.name}
              placeholder={t("wizard.option.fields.name.placeholder")}
            />
          </WizardField>
          <WizardField
            label={t("wizard.option.fields.strategyTag.label")}
            htmlFor="opt-strategy-tag"
            helper={t("wizard.option.fields.strategyTag.helper")}
          >
            <WizardInput
              id="opt-strategy-tag"
              name="strategy_tag"
              defaultValue={defaults.strategy_tag}
              placeholder={t("wizard.option.fields.strategyTag.placeholder")}
            />
          </WizardField>
          <WizardField
            label={t("wizard.option.fields.regimeTags.label")}
            htmlFor="opt-regime-tags"
            helper={t("wizard.option.fields.regimeTags.helper")}
          >
            <WizardInput
              id="opt-regime-tags"
              name="regime_tags"
              defaultValue={defaults.regime_tags}
              placeholder={t("wizard.option.fields.regimeTags.placeholder")}
            />
          </WizardField>
          <WizardField
            label={t("wizard.option.fields.taxJurisdiction.label")}
            htmlFor="opt-tax-jurisdiction"
            helper={t("wizard.option.fields.taxJurisdiction.helper")}
          >
            <WizardInput
              id="opt-tax-jurisdiction"
              name="tax_jurisdiction"
              defaultValue={defaults.tax_jurisdiction}
              placeholder={t("wizard.option.fields.taxJurisdiction.placeholder")}
            />
          </WizardField>
          <WizardField
            label={t("wizard.option.fields.taxTaxable.label")}
            htmlFor="opt-tax-taxable"
            helper={t("wizard.option.fields.taxTaxable.helper")}
          >
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 font-mono text-[12px] text-text-secondary hover:border-border-strong">
              <input
                type="checkbox"
                id="opt-tax-taxable"
                name="tax_taxable"
                defaultChecked={defaults.tax_taxable === "true"}
                value="true"
                className="h-3 w-3 accent-text"
              />
              <span>{t("wizard.option.fields.taxTaxable.checkboxLabel")}</span>
            </label>
          </WizardField>
        </div>

        <WizardNav
          backHref={`/add/option/legs?subtype=${subtype}${editId ? `&edit=${editId}` : ""}`}
          continueFormId="option-fields-form"
        />
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
