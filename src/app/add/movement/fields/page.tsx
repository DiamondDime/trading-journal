import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import {
  WizardField,
  WizardInput,
  WizardTextarea,
} from "@/components/wizard/wizard-field";
import { getT } from "@/lib/i18n/server";
import type { MovementEventKind } from "@/types/canonical";

export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

const VALID_KINDS: ReadonlySet<MovementEventKind> = new Set([
  "bridge",
  "convert",
  "transfer",
  "deposit",
  "withdrawal",
  "nft_trade",
  "loss",
  "other",
]);

function nowIsoForLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Movement wizard step 2 — collect the per-kind fields. The full set of
 * columns from `event_log` is exposed; the kind picked on step 1 only
 * adjusts the helper text via the heading. The trader sees one consistent
 * form; the schema accepts every combination.
 */
export default async function MovementFieldsPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;

  const rawKind = getStr(sp, "kind");
  const kind: MovementEventKind = VALID_KINDS.has(rawKind as MovementEventKind)
    ? (rawKind as MovementEventKind)
    : "other";

  // Edit-mode passthrough — when the user arrives from
  // /movement-events/<id>?edit, this param carries the row id forward so
  // logMovement() can UPDATE instead of INSERT a duplicate.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawEditId = getStr(sp, "editId");
  const editId = UUID_RE.test(rawEditId) ? rawEditId : "";

  const STEP_LABELS = [
    t("wizard.movement.stepLabels.kind"),
    t("wizard.movement.stepLabels.fields"),
    t("wizard.movement.stepLabels.review"),
  ] as const;

  const kindI18nKey = kind === "nft_trade" ? "nftTrade" : kind;
  const kindLabel = t(`wizard.movement.kinds.${kindI18nKey}.title` as const);

  const defaults = {
    occurredAt:        getStr(sp, "occurredAt") || nowIsoForLocalInput(),
    asset:             getStr(sp, "asset"),
    amount:            getStr(sp, "amount"),
    usdValue:          getStr(sp, "usdValue"),
    fromVenue:         getStr(sp, "fromVenue"),
    toVenue:           getStr(sp, "toVenue"),
    txHash:            getStr(sp, "txHash"),
    chain:             getStr(sp, "chain"),
    feeUsd:            getStr(sp, "feeUsd"),
    description:       getStr(sp, "description"),
    relatedActivityId: getStr(sp, "relatedActivityId"),
  };

  // Origin hint — when the user arrives here from the balances drift banner
  // (`?prefill=drift`), surface a small inline note so they know why the asset
  // + amount fields are already populated. URL params are the only signal;
  // no DB lookup, no state. Keep the hint dismissable-by-edit (any change to
  // the form clears it on submit — it's not threaded into review/submit).
  const prefillSource = getStr(sp, "prefill");
  const isDriftPrefill = prefillSource === "drift";

  return (
    <WizardShell
      type="movement"
      step={2}
      totalSteps={3}
      stepLabels={STEP_LABELS}
      title={t("wizard.movement.fields.title", { kind: kindLabel })}
      subtitle={t(`wizard.movement.fields.subtitleByKind.${kindI18nKey}` as const)}
    >
      {isDriftPrefill && (
        <aside
          role="status"
          className="mb-7 rounded-md border border-warn/30 bg-warn/5 px-4 py-2.5 text-[12px] text-warn"
        >
          <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">
            {t("wizard.movement.fields.prefillDrift.label")}
          </span>
          {" — "}
          <span className="font-serif italic">
            {t("wizard.movement.fields.prefillDrift.body")}
          </span>
        </aside>
      )}

      <form
        id="movement-fields-form"
        action="/add/movement/review"
        method="get"
        className="flex flex-col gap-7"
      >
        <input type="hidden" name="kind" value={kind} />
        {editId && <input type="hidden" name="editId" value={editId} />}

        {/* ── When ─────────────────────────────────────────────────────── */}
        <SectionLabel>{t("wizard.movement.fields.section.when")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.movement.fields.occurredAt.label")}
            htmlFor="occurredAt"
            helper={t("wizard.movement.fields.occurredAt.helper")}
            required
          >
            <WizardInput
              id="occurredAt"
              name="occurredAt"
              type="datetime-local"
              defaultValue={defaults.occurredAt}
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.movement.fields.chain.label")}
            htmlFor="chain"
            helper={t("wizard.movement.fields.chain.helper")}
          >
            <WizardInput
              id="chain"
              name="chain"
              defaultValue={defaults.chain}
              placeholder={t("wizard.movement.fields.chain.placeholder")}
              autoComplete="off"
            />
          </WizardField>
        </div>

        {/* ── Asset + amount ───────────────────────────────────────────── */}
        <SectionLabel>{t("wizard.movement.fields.section.asset")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <WizardField
            label={t("wizard.movement.fields.asset.label")}
            htmlFor="asset"
            helper={t("wizard.movement.fields.asset.helper")}
          >
            <WizardInput
              id="asset"
              name="asset"
              defaultValue={defaults.asset}
              placeholder={t("wizard.movement.fields.asset.placeholder")}
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
          </WizardField>
          <WizardField
            label={t("wizard.movement.fields.amount.label")}
            htmlFor="amount"
            helper={t("wizard.movement.fields.amount.helper")}
          >
            <WizardInput
              id="amount"
              name="amount"
              type="number"
              step="any"
              inputMode="decimal"
              defaultValue={defaults.amount}
              placeholder={t("wizard.movement.fields.amount.placeholder")}
            />
          </WizardField>
          <WizardField
            label={t("wizard.movement.fields.usdValue.label")}
            htmlFor="usdValue"
            helper={t("wizard.movement.fields.usdValue.helper")}
          >
            <WizardInput
              id="usdValue"
              name="usdValue"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.usdValue}
              placeholder={t("wizard.movement.fields.usdValue.placeholder")}
            />
          </WizardField>
        </div>

        {/* ── Where ────────────────────────────────────────────────────── */}
        <SectionLabel>{t("wizard.movement.fields.section.route")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.movement.fields.fromVenue.label")}
            htmlFor="fromVenue"
            helper={t("wizard.movement.fields.fromVenue.helper")}
          >
            <WizardInput
              id="fromVenue"
              name="fromVenue"
              defaultValue={defaults.fromVenue}
              placeholder={t("wizard.movement.fields.fromVenue.placeholder")}
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label={t("wizard.movement.fields.toVenue.label")}
            htmlFor="toVenue"
            helper={t("wizard.movement.fields.toVenue.helper")}
          >
            <WizardInput
              id="toVenue"
              name="toVenue"
              defaultValue={defaults.toVenue}
              placeholder={t("wizard.movement.fields.toVenue.placeholder")}
              autoComplete="off"
            />
          </WizardField>
        </div>

        {/* ── Fee + tx hash ────────────────────────────────────────────── */}
        <SectionLabel>{t("wizard.movement.fields.section.txAndFee")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.movement.fields.feeUsd.label")}
            htmlFor="feeUsd"
            helper={t("wizard.movement.fields.feeUsd.helper")}
          >
            <WizardInput
              id="feeUsd"
              name="feeUsd"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaults.feeUsd}
              placeholder={t("wizard.movement.fields.feeUsd.placeholder")}
            />
          </WizardField>
          <WizardField
            label={t("wizard.movement.fields.txHash.label")}
            htmlFor="txHash"
            helper={t("wizard.movement.fields.txHash.helper")}
          >
            <WizardInput
              id="txHash"
              name="txHash"
              defaultValue={defaults.txHash}
              placeholder={t("wizard.movement.fields.txHash.placeholder")}
              autoComplete="off"
              spellCheck={false}
            />
          </WizardField>
        </div>

        {/* ── Description + related activity ───────────────────────────── */}
        <SectionLabel>{t("wizard.movement.fields.section.context")}</SectionLabel>
        <WizardField
          label={t("wizard.movement.fields.description.label")}
          htmlFor="description"
          helper={t("wizard.movement.fields.description.helper")}
        >
          <WizardTextarea
            id="description"
            name="description"
            rows={3}
            defaultValue={defaults.description}
            placeholder={t("wizard.movement.fields.description.placeholder")}
          />
        </WizardField>
        <WizardField
          label={t("wizard.movement.fields.relatedActivity.label")}
          htmlFor="relatedActivityId"
          helper={t("wizard.movement.fields.relatedActivity.helper")}
        >
          <WizardInput
            id="relatedActivityId"
            name="relatedActivityId"
            defaultValue={defaults.relatedActivityId}
            placeholder={t("wizard.movement.fields.relatedActivity.placeholder")}
            autoComplete="off"
            spellCheck={false}
            pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
          />
        </WizardField>

        {/* ── Nav ──────────────────────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
          <Link
            href={`/add/movement/kind?kind=${kind}`}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("common.back")}
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            {t("wizard.movement.fields.nav.review")}
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
