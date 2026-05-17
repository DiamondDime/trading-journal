import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import {
  WizardField,
  WizardInput,
  WizardTextarea,
} from "@/components/wizard/wizard-field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getImportedFillById,
  type ImportedTradeFill,
} from "@/lib/data/exchange-fills-mock";
import { SPREAD_TYPE_LABELS, type MatcherSpreadType } from "@/lib/matcher/spread-matcher";
import { cn } from "@/lib/utils";
import { requireUser } from "@/lib/auth/server";
import { getActivity } from "@/lib/db/activity";
import { getT } from "@/lib/i18n/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Map the canonical DB spread_type → matcher key the wizard URL uses. */
const DB_TO_MATCHER_TYPE: Record<string, string> = {
  cash_carry: "cash_carry",
  funding_capture: "funding",
  cross_exchange_perp_arb: "cross_exchange",
  calendar: "calendar",
  dex_cex_arb: "dex_cex",
};

function isoToDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(
  sp: Awaited<Search>,
  key: string,
  fallback = ""
): string {
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

// Manual builder uses repeated `?legs=…&legs=…`; matcher uses a single
// `?legs=a,b`. Accept both — flatten + split on commas.
function parseLegIds(sp: Awaited<Search>): string[] {
  const raw = [...getAllStr(sp, "legs"), getStr(sp, "legs")]
    .filter((s) => s.length > 0)
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(raw)];
}

const SPREAD_TYPE_VALUES: readonly string[] = [
  "cash_carry",
  "funding",
  "cross_exchange",
  "calendar",
  "dex_cex",
];

function isSpreadType(v: string): v is MatcherSpreadType {
  return SPREAD_TYPE_VALUES.includes(v);
}

function fmtPrice(n: number) {
  if (n < 1) return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtQty(n: number) {
  if (n >= 1_000_000) return n.toExponential(2);
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n < 1) return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function fmtUsd(n: number, signed = false) {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}$${abs}`;
}

function fmtDateInput(iso: string): string {
  // `<input type="datetime-local">` wants `YYYY-MM-DDTHH:mm`. Fill-IDs in our
  // mock are already in that shape; this is here for safety.
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function suggestName(
  legs: ImportedTradeFill[],
  spreadType: string,
  t: Awaited<ReturnType<typeof getT>>
): string {
  if (legs.length === 0) return "";
  const asset = legs[0]?.asset ?? "";
  const venues = [...new Set(legs.map((l) => l.exchange))].join(" + ");
  const typeLabel =
    isSpreadType(spreadType)
      ? SPREAD_TYPE_LABELS[spreadType]
      : t("wizard.spread.fields.nameSuggestFallback");
  return `${asset} ${typeLabel.toLowerCase()} · ${venues}`;
}

function suggestSubtitle(
  spreadType: string,
  t: Awaited<ReturnType<typeof getT>>
): string {
  if (spreadType === "cash_carry") return t("wizard.spread.fields.variantSuggest.cashCarry");
  if (spreadType === "funding") return t("wizard.spread.fields.variantSuggest.funding");
  if (spreadType === "cross_exchange") return t("wizard.spread.fields.variantSuggest.crossExchange");
  if (spreadType === "calendar") return t("wizard.spread.fields.variantSuggest.calendar");
  if (spreadType === "dex_cex") return t("wizard.spread.fields.variantSuggest.dexCex");
  return "";
}

function earliestOpen(legs: ImportedTradeFill[]): string {
  if (legs.length === 0) return "";
  return legs
    .map((l) => l.openedAt)
    .sort()
    .at(0) ?? "";
}

function latestClose(legs: ImportedTradeFill[]): string {
  if (legs.length === 0) return "";
  return legs
    .map((l) => l.closedAt)
    .sort()
    .at(-1) ?? "";
}

function sumCapital(legs: ImportedTradeFill[]): number {
  // Capital deployed on a spread = the single-side notional (legs are hedged
  // against each other; the user's actual outlay is one leg's capital, not
  // their sum). Use the max to be conservative — the user can edit.
  return legs.reduce((m, l) => Math.max(m, l.capital), 0);
}

function sumNetPnl(legs: ImportedTradeFill[]): number {
  return legs.reduce((s, l) => s + l.netPnl, 0);
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

  // Edit-mode pre-fill from DB. Manual spreads have no leg rows (the create
  // action skips them), so the legs table will be empty — that's OK and
  // matches what the user sees on the detail page.
  let dbDefaults: Partial<{
    name: string;
    variant: string;
    openedAt: string;
    closedAt: string;
    capital: string;
    netPnl: string;
    thesis: string;
    regimeTags: string;
    spreadType: string;
    serial: string;
  }> = {};
  let editValid = false;
  if (editId && UUID_RE.test(editId)) {
    const { id: userId } = await requireUser();
    const activity = await getActivity(userId, editId);
    if (activity && activity.subtype.type === "spread") {
      const s = activity.subtype.row;
      dbDefaults = {
        name: activity.name,
        variant: s.variant ?? "",
        openedAt: isoToDateTimeLocal(activity.openedAt),
        closedAt: isoToDateTimeLocal(activity.closedAt),
        capital: activity.capitalDeployedUsd ?? "",
        netPnl: activity.netPnlUsd ?? "",
        thesis: s.exitPlan ?? "",
        regimeTags: activity.regimeTags.join(", "),
        spreadType: DB_TO_MATCHER_TYPE[s.spreadType] ?? "",
        serial: activity.id.slice(0, 4).toUpperCase(),
      };
      editValid = true;
    }
  }

  const legIds = parseLegIds(sp);
  const legs = legIds
    .map((id) => getImportedFillById(id))
    .filter((l): l is ImportedTradeFill => !!l);
  const missing = legIds.filter((id) => !getImportedFillById(id));

  const spreadType = getStr(sp, "spreadType") || dbDefaults.spreadType || "";
  const matcher = getStr(sp, "matcher"); // "auto" | "manual" | ""

  // ── Defaults — pre-filled either from URL (matcher path) or derived ────────
  const defaults = {
    name: getStr(sp, "name") || dbDefaults.name || suggestName(legs, spreadType, t),
    variant: getStr(sp, "variant") || dbDefaults.variant || suggestSubtitle(spreadType, t),
    openedAt:
      getStr(sp, "openedAt") || dbDefaults.openedAt || fmtDateInput(earliestOpen(legs)),
    closedAt:
      getStr(sp, "closedAt") || dbDefaults.closedAt || fmtDateInput(latestClose(legs)),
    capital: getStr(sp, "capital") || dbDefaults.capital || (legs.length ? String(sumCapital(legs)) : ""),
    netPnl: getStr(sp, "netPnl") || dbDefaults.netPnl || (legs.length ? sumNetPnl(legs).toFixed(2) : ""),
    headlineUnit: getStr(sp, "headlineUnit", "APR"),
    headlineValue: getStr(sp, "headlineValue"),
    thesis: getStr(sp, "thesis") || dbDefaults.thesis || "",
    regimeTags: getStr(sp, "regimeTags") || dbDefaults.regimeTags || "",
  };

  // Empty state: manual route arrived without any selected legs. Edit mode
  // skips this since edits operate on existing rows (no legs stored on v1
  // manual spreads).
  if (!editValid && legs.length === 0 && legIds.length === 0) {
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

  const backHref = editValid
    ? `/spreads/${editId}`
    : matcher === "manual"
      ? `/add/spread/type?${new URLSearchParams({
          legs: legIds.join(","),
          matcher,
          ...(spreadType ? { spreadType } : {}),
        }).toString()}`
      : `/add/spread/type?${new URLSearchParams({
          legs: legIds.join(","),
          ...(matcher ? { matcher } : {}),
          ...(spreadType ? { spreadType } : {}),
        }).toString()}`;

  return (
    <WizardShell
      type="spread"
      step={4}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={editValid ? t("wizard.spread.fields.titleEdit") : t("wizard.spread.fields.titleNew")}
      subtitle={
        editValid
          ? t("wizard.spread.fields.subtitleEdit")
          : t("wizard.spread.fields.subtitleNew")
      }
    >
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
              serial: dbDefaults.serial ?? "",
            })}
          </span>
        </aside>
      )}
      {/* ── Legs summary (read-only) ──────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-3 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.spread.fields.sections.legs")}
        </h2>
        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col" className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  {t("wizard.spread.fields.legsTable.symbol")}
                </TableHead>
                <TableHead scope="col" className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  {t("wizard.spread.fields.legsTable.venue")}
                </TableHead>
                <TableHead scope="col" className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  {t("wizard.spread.fields.legsTable.side")}
                </TableHead>
                <TableHead scope="col" className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  {t("wizard.spread.fields.legsTable.qty")}
                </TableHead>
                <TableHead scope="col" className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  {t("wizard.spread.fields.legsTable.entryExit")}
                </TableHead>
                <TableHead scope="col" className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  {t("wizard.spread.fields.legsTable.netPnl")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {legs.map((l) => (
                <TableRow key={l.id} className="hover:bg-transparent">
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-serif text-[13px] font-medium text-text">
                        {l.symbol}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
                        {l.instrument}
                        {l.expiry ? ` · ${l.expiry}` : ""}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-text-secondary">
                    {l.exchange}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "font-mono text-[10px] uppercase tracking-[0.14em]",
                        l.side === "long" ? "text-up" : "text-down"
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
                      {fmtPrice(l.entryPrice)}
                    </span>
                    <span className="mx-1 text-text-tertiary">→</span>
                    <span className="font-mono text-[11px] tabular-nums text-text-secondary">
                      {fmtPrice(l.exitPrice)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={cn(
                        "font-mono text-[11px] font-medium tabular-nums",
                        l.tone === "up" ? "text-up" : "text-down"
                      )}
                    >
                      {fmtUsd(l.netPnl, true)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
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
              ? SPREAD_TYPE_LABELS[spreadType]
              : t("wizard.spread.fields.spreadTypeNotPicked")}
          </span>
          {matcher === "auto" && (
            <span className="ml-2 rounded bg-signature/15 px-1.5 py-px font-mono text-[9px] not-italic uppercase tracking-[0.14em] text-signature">
              {t("wizard.spread.fields.matcherBadge")}
            </span>
          )}
        </p>
        <p className="mt-2 font-serif text-[11px] italic leading-snug text-text-tertiary">
          {t("wizard.spread.fields.v1ManualNote")}
        </p>
      </section>

      {/* ── Form ──────────────────────────────────────────────────────────── */}
      <form
        id="spread-fields-form"
        action="/add/spread/review"
        method="get"
        className="flex flex-col gap-7"
      >
        {/* Pass-through */}
        {editValid && <input type="hidden" name="edit" value={editId} />}
        <input type="hidden" name="legs" value={legIds.join(",")} />
        {matcher && <input type="hidden" name="matcher" value={matcher} />}
        {spreadType && (
          <input type="hidden" name="spreadType" value={spreadType} />
        )}

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

        <SectionLabel>{t("wizard.spread.fields.sections.timing")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField label={t("wizard.spread.fields.openedAt.label")} htmlFor="openedAt" required>
            <WizardInput
              id="openedAt"
              name="openedAt"
              type="datetime-local"
              defaultValue={defaults.openedAt}
              required
            />
          </WizardField>
          <WizardField label={t("wizard.spread.fields.closedAt.label")} htmlFor="closedAt" required>
            <WizardInput
              id="closedAt"
              name="closedAt"
              type="datetime-local"
              defaultValue={defaults.closedAt}
              required
            />
          </WizardField>
        </div>

        <SectionLabel>{t("wizard.spread.fields.sections.numbers")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
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
            required
          >
            <WizardInput
              id="netPnl"
              name="netPnl"
              type="number"
              step="0.01"
              inputMode="decimal"
              defaultValue={defaults.netPnl}
              placeholder="1314.40"
              required
            />
          </WizardField>
        </div>

        <SectionLabel>{t("wizard.spread.fields.sections.headline")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[120px_1fr]">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
              {t("wizard.spread.fields.unit.legend")}
              <span className="ml-1.5 text-text-disabled">{t("wizard.spread.fields.unit.requiredSuffix")}</span>
            </legend>
            <div role="radiogroup" aria-label={t("wizard.spread.fields.unit.ariaLabel")} className="grid grid-cols-2 gap-2">
              {(["APR", "BPS/D"] as const).map((u) => (
                <label
                  key={u}
                  className={cn(
                    "flex cursor-pointer items-center justify-center rounded-md border border-border bg-surface px-2 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:border-border-strong hover:text-text",
                    "has-[input:checked]:border-text has-[input:checked]:bg-subtle has-[input:checked]:text-text"
                  )}
                >
                  <input
                    type="radio"
                    name="headlineUnit"
                    value={u}
                    defaultChecked={defaults.headlineUnit === u}
                    required
                    className="sr-only"
                  />
                  {u}
                </label>
              ))}
            </div>
          </fieldset>
          <WizardField
            label={t("wizard.spread.fields.headlineValue.label")}
            htmlFor="headlineValue"
            helper={t("wizard.spread.fields.headlineValue.helper")}
          >
            <WizardInput
              id="headlineValue"
              name="headlineValue"
              type="number"
              step="any"
              inputMode="decimal"
              defaultValue={defaults.headlineValue}
              placeholder="14.0"
            />
          </WizardField>
        </div>

        <SectionLabel>{t("wizard.spread.fields.sections.thesisAndTags")}</SectionLabel>
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
