import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WizardPreviewBanner } from "@/components/wizard/wizard-preview-banner";
import { requireUser } from "@/lib/auth/server";
import { getNoteForActivity } from "@/lib/db/notes";
import {
  getSatisfaction,
  listScreenshotsForActivity,
  listTagsForActivity,
} from "@/lib/db/satellite";
import { NotesEditor } from "@/components/activity/notes-editor";
import { ScreenshotsSection } from "@/components/activity/screenshots-section";
import { toScreenshotItems } from "@/components/activity/screenshots-data";
import { TagEditor } from "@/components/activity/tag-editor";
import { SatisfactionToggle } from "@/components/activity/satisfaction-toggle";
import {
  OptionPayoffChart,
  type PayoffChartLegInput,
} from "@/components/activity/option-payoff-chart";
import { getOptionForEdit } from "@/app/add/option/db";
import { closeOptionPosition } from "@/app/add/option/actions";
import { getT, getLocale } from "@/lib/i18n/server";
import { DeleteButton } from "@/components/activity/delete-button";

export const dynamic = "force-dynamic";

function fmtUsd(n: number, signed = false): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}$${abs}`;
}

function fmtNumber(n: number, fraction = 4, intlLocale = "en-US"): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(intlLocale, { maximumFractionDigits: fraction });
}

function fmtDate(iso: string | null, intlLocale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(intlLocale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function parseDec(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export default async function OptionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; action?: string; error?: string }>;
}) {
  const t = await getT();
  const intlLocale = (await getLocale()) === "ru" ? "ru-RU" : "en-US";
  const { id } = await params;
  const sp = await searchParams;

  const { id: userId } = await requireUser();
  const [loaded, note, screenshots, initialTags, satisfaction] = await Promise.all([
    getOptionForEdit(userId, id),
    getNoteForActivity(userId, id),
    listScreenshotsForActivity(userId, id),
    listTagsForActivity(userId, id),
    getSatisfaction(userId, id),
  ]);
  if (!loaded) notFound();
  const { activity, option, legs } = loaded;
  const initialScreenshots = toScreenshotItems(screenshots);

  const netPremium = parseDec(option.netPremiumUsd);
  const realized = parseDec(option.realizedPnlUsd);
  const maxProfit = option.maxProfitUsd ? parseDec(option.maxProfitUsd) : null;
  const maxLoss = option.maxLossUsd ? parseDec(option.maxLossUsd) : null;
  const isClosed = activity.status === "closed" || activity.status === "expired";

  const heroValue = isClosed ? realized : netPremium;
  const heroTone =
    heroValue === 0
      ? "text-text"
      : heroValue > 0
      ? "text-up"
      : "text-down";

  // Aggregate greeks across legs, signed by long/short.
  function sumGreek(field: "delta" | "gamma" | "theta" | "vega"): number {
    let s = 0;
    for (const leg of legs) {
      const v = parseDec(leg[field]);
      const contracts = parseDec(leg.contracts);
      const sign = leg.side === "long" ? 1 : -1;
      s += sign * v * contracts;
    }
    return s;
  }
  const totalDelta = sumGreek("delta");
  const totalGamma = sumGreek("gamma");
  const totalTheta = sumGreek("theta");
  const totalVega = sumGreek("vega");

  // Payoff chart input.
  const chartLegs: PayoffChartLegInput[] = legs.map((l) => ({
    optionKind: l.optionKind,
    side: l.side,
    strike: parseDec(l.strike),
    contracts: parseDec(l.contracts),
    premiumPerContract: parseDec(l.premiumPerContract),
  }));

  const earliestExpiry =
    legs.length > 0
      ? legs.map((l) => l.expiry).sort()[0]
      : null;
  const dte = earliestExpiry
    ? // Date.now is pure-at-request-time inside this async Server Component.
      // eslint-disable-next-line react-hooks/purity
      Math.ceil((new Date(earliestExpiry).getTime() - Date.now()) / 86_400_000)
    : null;

  const serial = `O#${activity.id.slice(0, 4).toUpperCase()}`;
  const statusLabel = t(`status.${activity.status}`);
  const subtypeLabel =
    option.subtype === "option_spread" && option.spreadStyle
      ? t(
          (() => {
            switch (option.spreadStyle) {
              case "vertical":    return "optionSpreadStyle.vertical";
              case "iron_condor": return "optionSpreadStyle.iron_condor";
              case "calendar":    return "optionSpreadStyle.calendar";
              case "strangle":    return "optionSpreadStyle.strangle";
              case "butterfly":   return "optionSpreadStyle.butterfly";
              default:            return "optionSpreadStyle.custom";
            }
          })(),
        )
      : t("wizard.option.kinds.singleLeg.title");

  return (
    <article className="mx-auto max-w-4xl px-6 py-14 md:py-20">
          <WizardPreviewBanner from={sp.from} action={sp.action} />

          <div className="flex items-center justify-between font-mono text-xs text-text-tertiary">
            <span>{serial}</span>
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">
                  {statusLabel}
                </span>
              </span>
              <span>
                {dte !== null
                  ? dte < 0
                    ? t("optionDetail.expired")
                    : t("optionDetail.dteValue", { dte })
                  : "—"}
              </span>
            </span>
          </div>

          <header className="mt-6">
            <div className="flex items-start justify-between gap-6">
              <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-text md:text-5xl">
                {activity.name}
              </h1>
              <Link
                href={`/add/option/fields?edit=${activity.id}`}
                aria-label={t("optionDetail.editAria")}
                className="mt-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-tertiary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Link>
            </div>
            <p className="mt-3 text-base text-text-secondary">
              {option.underlying} · {subtypeLabel} ·{" "}
              {t("optionDetail.legCount", { count: legs.length })} · {option.exchange}
            </p>
            <div className="mt-5">
              <SatisfactionToggle
                activityId={activity.id}
                initialSatisfaction={satisfaction?.satisfaction ?? null}
                initialReason={satisfaction?.reason ?? null}
              />
            </div>
          </header>

          {/* ── Hero ────────────────────────────────────────────── */}
          <section className="mt-14 border-y border-border py-12">
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
                {isClosed
                  ? t("optionDetail.heroCaptionClosed")
                  : t("optionDetail.heroCaptionOpen")}
              </p>
              <div className="flex items-baseline gap-3">
                <span
                  className={`font-serif font-normal leading-none ${
                    isClosed ? heroTone : "text-signature"
                  }`}
                  style={{ fontSize: "clamp(56px, 9vw, 96px)" }}
                >
                  {fmtUsd(heroValue, true)}
                </span>
                <span className="font-serif text-2xl font-normal text-text-tertiary">
                  {isClosed
                    ? t("optionDetail.heroLabelPnl")
                    : t("optionDetail.heroLabelNet")}
                </span>
              </div>
              {!isClosed && maxProfit !== null && maxLoss !== null && (
                <p className="mt-3 font-mono text-sm text-text-secondary">
                  {t("optionDetail.maxProfitLossLine", {
                    maxProfit: fmtUsd(maxProfit),
                    maxLoss: fmtUsd(maxLoss),
                  })}
                </p>
              )}
            </div>

            <div className="mt-8">
              <OptionPayoffChart legs={chartLegs} variant="full" height={260} />
            </div>
          </section>

          {/* ── Greeks ─────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("optionDetail.sections.greeks")}
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <GreekCell label="Δ Delta" value={fmtNumber(totalDelta, 3, intlLocale)} />
              <GreekCell label="Γ Gamma" value={fmtNumber(totalGamma, 4, intlLocale)} />
              <GreekCell label="Θ Theta" value={fmtNumber(totalTheta, 2, intlLocale)} />
              <GreekCell label="V Vega" value={fmtNumber(totalVega, 2, intlLocale)} />
            </div>
          </section>

          {/* ── Legs ───────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("optionDetail.sections.legs")}
            </h2>
            <div className="mt-4 overflow-hidden rounded-md border border-border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>#</TableHead>
                    <TableHead>{t("optionDetail.legColumns.exchange")}</TableHead>
                    <TableHead>{t("optionDetail.legColumns.expiry")}</TableHead>
                    <TableHead className="text-right">
                      {t("optionDetail.legColumns.strike")}
                    </TableHead>
                    <TableHead>{t("optionDetail.legColumns.kind")}</TableHead>
                    <TableHead>{t("optionDetail.legColumns.side")}</TableHead>
                    <TableHead className="text-right">
                      {t("optionDetail.legColumns.contracts")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("optionDetail.legColumns.openPrem")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("optionDetail.legColumns.closePrem")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {legs.map((leg) => (
                    <TableRow key={leg.id} className="hover:bg-transparent">
                      <TableCell className="font-mono text-text-tertiary">
                        {leg.legIndex + 1}
                      </TableCell>
                      <TableCell className="font-mono">{leg.exchange}</TableCell>
                      <TableCell className="font-mono">
                        {fmtDate(leg.expiry, intlLocale)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {fmtNumber(parseDec(leg.strike), 2, intlLocale)}
                      </TableCell>
                      <TableCell className="font-mono uppercase">
                        {leg.optionKind}
                      </TableCell>
                      <TableCell
                        className={
                          "font-mono uppercase " +
                          (leg.side === "long" ? "text-up" : "text-down")
                        }
                      >
                        {leg.side === "long" ? t("side.long") : t("side.short")}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {leg.contracts}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {fmtNumber(parseDec(leg.premiumPerContract), 2, intlLocale)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {leg.closePremiumPerContract
                          ? fmtNumber(parseDec(leg.closePremiumPerContract), 2, intlLocale)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          {/* ── Intent (open-side context) ─────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("optionDetail.sections.intent")}
            </h2>
            <div className="mt-4 overflow-hidden rounded-md border border-border bg-surface">
              <Table>
                <TableBody>
                  <ExecRow label={t("optionDetail.row.entryThesis")} value={option.entryThesis ?? "—"} mono={false} />
                  <ExecRow label={t("optionDetail.row.exitPlan")} value={option.exitPlan ?? "—"} mono={false} />
                  <ExecRow label={t("optionDetail.row.targetPrice")} value={option.targetPrice ? fmtNumber(parseDec(option.targetPrice), 2, intlLocale) : "—"} mono />
                  <ExecRow label={t("optionDetail.row.stopPrice")} value={option.stopPrice ? fmtNumber(parseDec(option.stopPrice), 2, intlLocale) : "—"} mono />
                  <ExecRow label={t("optionDetail.row.ivAtOpen")} value={option.ivAtOpen ?? "—"} mono />
                  <ExecRow label={t("optionDetail.row.maxProfit")} value={maxProfit === null ? "—" : fmtUsd(maxProfit)} mono />
                  <ExecRow label={t("optionDetail.row.maxLoss")} value={maxLoss === null ? "—" : fmtUsd(maxLoss)} mono />
                  <ExecRow label={t("optionDetail.row.openedAt")} value={fmtDate(activity.openedAt, intlLocale)} mono />
                </TableBody>
              </Table>
            </div>
          </section>

          {/* ── Close position action ──────────────────────────── */}
          {!isClosed && (
            <section className="mt-14">
              <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                {t("optionDetail.sections.close")}
              </h2>
              <form
                action={closeOptionPosition}
                className="mt-4 flex flex-col gap-5 rounded-md border border-border bg-surface p-5"
              >
                <input type="hidden" name="activity_id" value={activity.id} />
                <fieldset className="flex flex-col gap-3">
                  <legend className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                    {t("optionDetail.closeReasonLegend")}
                  </legend>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    {(["expired_worthless", "closed_early", "assigned", "exercised"] as const).map(
                      (reason, i) => (
                        <label
                          key={reason}
                          className="flex cursor-pointer items-center justify-center rounded-md border border-border bg-app px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary hover:border-border-strong hover:text-text has-[input:checked]:border-text has-[input:checked]:bg-subtle has-[input:checked]:text-text"
                        >
                          <input
                            type="radio"
                            name="close_reason"
                            value={reason}
                            defaultChecked={i === 1}
                            required
                            className="sr-only"
                          />
                          {t(`optionDetail.closeReasons.${reason}` as const)}
                        </label>
                      ),
                    )}
                  </div>
                </fieldset>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {legs.map((leg) => (
                    <label
                      key={leg.id}
                      className="flex flex-col gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
                    >
                      <span>
                        {t("optionDetail.exitPremiumLabel", { i: leg.legIndex + 1 })}
                      </span>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        name={`exit_premium[${leg.legIndex}]`}
                        placeholder="0"
                        className="w-full rounded-md border border-border bg-app px-3 py-2 font-mono text-[13px] text-text placeholder:text-text-disabled focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-text"
                      />
                    </label>
                  ))}
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-5 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
                  >
                    {t("optionDetail.closePositionButton")}
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* ── Tags ──────────────────────────────────────────── */}
          {(activity.regimeTags.length > 0 || initialTags.length > 0) && (
            <section className="mt-14">
              <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                {t("optionDetail.sections.tags")}
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {activity.regimeTags.map((tag) => (
                  <span
                    key={`regime-${tag}`}
                    className="rounded-md border border-border bg-surface px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-4">
                <TagEditor activityId={activity.id} initialTags={initialTags} />
              </div>
            </section>
          )}

          {/* ── Screenshots ───────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("optionDetail.sections.screenshots")}
            </h2>
            <p className="mt-2 font-mono text-[11px] text-text-tertiary">
              {t("optionDetail.screenshotsCaption")}
            </p>
            <div className="mt-4">
              <ScreenshotsSection activityId={activity.id} initialScreenshots={initialScreenshots} />
            </div>
          </section>

          {/* ── Notes ─────────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("optionDetail.sections.notes")}
            </h2>
            <p className="mt-2 font-mono text-[11px] text-text-tertiary">
              {t("optionDetail.notesCaption")}
            </p>
            <div className="mt-4">
              <NotesEditor
                activityId={activity.id}
                initialBody={note?.body ?? ""}
                initialVersion={note?.updatedAt ?? null}
                initialNoteId={note?.id ?? null}
              />
            </div>
          </section>

          {/* ── Actions ───────────────────────────────────────── */}
          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("optionDetail.sections.actions")}
            </h2>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link
                href={`/add/option/fields?edit=${activity.id}`}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3 w-3" />
                {t("optionDetail.actions.edit")}
              </Link>
              <DeleteButton
                activityId={activity.id}
                activityType="option"
                serial={serial}
              />
            </div>
          </section>
    </article>
  );
}

function ExecRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono: boolean;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="text-text-tertiary">{label}</TableCell>
      <TableCell
        className={
          "text-right " +
          (mono
            ? "font-mono tabular-nums text-text"
            : "font-serif text-text")
        }
      >
        {value}
      </TableCell>
    </TableRow>
  );
}

function GreekCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
        {label}
      </p>
      <p className="mt-2 font-serif text-[20px] tabular-nums text-text">{value}</p>
    </div>
  );
}
