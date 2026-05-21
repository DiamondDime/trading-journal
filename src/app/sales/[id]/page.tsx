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
import { fmtCapital, fmtUsd } from "@/lib/data/archive-data";
import { WizardPreviewBanner } from "@/components/wizard/wizard-preview-banner";
import { requireUser } from "@/lib/auth/server";
import { getActivity } from "@/lib/db/activity";
import { getNoteForActivity } from "@/lib/db/notes";
import {
  getSatisfaction,
  listScreenshotsForActivity,
  listTagsForActivity,
} from "@/lib/db/satellite";
import { DeleteButton } from "@/components/activity/delete-button";
import { SetReminderButton } from "@/components/reminders/set-reminder-button";
import { NotesEditor } from "@/components/activity/notes-editor";
import { ScreenshotsSection } from "@/components/activity/screenshots-section";
import { toScreenshotItems } from "@/components/activity/screenshots-data";
import { TagEditor } from "@/components/activity/tag-editor";
import { SatisfactionToggle } from "@/components/activity/satisfaction-toggle";
import { getT, getLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

function fmtPrice(n: number, intlLocale: string) {
  if (n < 1) {
    return n.toLocaleString(intlLocale, { maximumSignificantDigits: 4 });
  }
  return n.toLocaleString(intlLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtTokens(n: number, intlLocale: string) {
  return n.toLocaleString(intlLocale, { maximumFractionDigits: 0 });
}

function fmtDate(iso: string | null, intlLocale: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(intlLocale, { month: "short", day: "numeric", year: "numeric" });
}

function fmtMultiplier(m: number) {
  if (!Number.isFinite(m)) return "—";
  return m >= 10 ? `${m.toFixed(1)}×` : `${m.toFixed(2)}×`;
}

function vestingDescription(schedule: Record<string, unknown> | null): {
  tgePct: number; cliffMonths: number; durationMonths: number;
} {
  if (!schedule) return { tgePct: 0, cliffMonths: 0, durationMonths: 0 };
  const kind = String(schedule.kind ?? "");
  if (kind === "all_at_tge") return { tgePct: 100, cliffMonths: 0, durationMonths: 0 };
  if (kind === "tge_plus_linear") {
    return {
      tgePct: Number(schedule.tge_pct ?? 0),
      cliffMonths: 0,
      durationMonths: Math.round(Number(schedule.linear_days ?? 0) / 30),
    };
  }
  if (kind === "cliff_plus_linear") {
    return {
      tgePct: Number(schedule.tge_pct ?? 0),
      cliffMonths: Math.round(Number(schedule.cliff_days ?? 0) / 30),
      durationMonths: Math.round(Number(schedule.linear_days ?? 0) / 30),
    };
  }
  return { tgePct: 0, cliffMonths: 0, durationMonths: 0 };
}

export default async function SaleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; action?: string }>;
}) {
  const t = await getT();
  const intlLocale = (await getLocale()) === "ru" ? "ru-RU" : "en-US";
  const { id } = await params;
  const sp = await searchParams;
  const { id: userId } = await requireUser();
  const [
    activity,
    note,
    screenshots,
    initialTags,
    satisfaction,
  ] = await Promise.all([
    getActivity(userId, id),
    getNoteForActivity(userId, id),
    listScreenshotsForActivity(userId, id),
    listTagsForActivity(userId, id),
    getSatisfaction(userId, id),
  ]);
  if (!activity || activity.subtype.type !== "sale") {
    notFound();
  }
  const initialScreenshots = toScreenshotItems(screenshots);

  const s = activity.subtype.row;
  const usdPaid = Number(s.usdPaid);
  const tokens = Number(s.tokensAllocated);
  const currentPrice = Number(s.currentPriceUsd ?? 0);
  const currentValue = tokens * currentPrice;
  const multiplier = usdPaid > 0 ? currentValue / usdPaid : 0;
  const netPnl = Number(activity.netPnlUsd ?? 0);
  const headlineTone = multiplier >= 1 ? "text-up" : "text-down";
  // Sale kind: dict has ido|launchpad|premarket|otc. Fall back to the raw
  // value if the DB ever exposes a kind we don't have a label for, rather
  // than the broken "saleDetail.kind.X" debug-key.
  const SALE_KINDS = ["ido", "launchpad", "premarket", "otc"] as const;
  const saleKindLabel = (SALE_KINDS as readonly string[]).includes(s.saleKind)
    ? t(`saleDetail.kind.${s.saleKind as (typeof SALE_KINDS)[number]}`)
    : s.saleKind;
  const { tgePct, cliffMonths, durationMonths } = vestingDescription(s.vestingSchedule);
  // Status uses the top-level status.* dict (covers all 9 ActivityStatus
  // enum values: open, closed, pending, vesting, claimed, winding_down,
  // orphaned, liquidated, expired). The local saleDetail.status only had
  // 4 keys which produced a broken raw-key fallback for sales surfaced as
  // e.g. expired or winding_down.
  const statusLabel = t(`status.${activity.status}`);
  const serial = `S#${activity.id.slice(0, 4).toUpperCase()}`;
  // Clamp negative durations — TGE / vesting can sit in the future, in which
  // case the elapsed-since-open value is negative. Show "0h" rather than a
  // confusing "-3d".
  const rawHeldMs =
    activity.openedAt && activity.closedAt
      ? new Date(activity.closedAt).getTime() - new Date(activity.openedAt).getTime()
      : // Date.now is pure-at-request-time inside this async Server Component.
        // eslint-disable-next-line react-hooks/purity
        Date.now() - new Date(activity.openedAt ?? activity.createdAt).getTime();
  const daysHeldMs = Math.max(0, rawHeldMs);
  const daysLabel =
    daysHeldMs < 86_400_000
      ? `${Math.round(daysHeldMs / 3_600_000)}${t("tradeDetail.units.hour")}`
      : `${Math.round(daysHeldMs / 86_400_000)}${t("tradeDetail.units.day")}`;
  const closedLabel = activity.closedAt ? fmtDate(activity.closedAt, intlLocale) : "—";

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
              <span>{closedLabel}</span>
            </span>
          </div>

          <header className="mt-6">
            <div className="flex items-start justify-between gap-6">
              <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-text md:text-5xl">
                {activity.name}
              </h1>
              <Link
                href={`/add/sale/fields?edit=${activity.id}`}
                aria-label={t("saleDetail.editAria")}
                className="mt-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-tertiary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Link>
            </div>
            <p className="mt-3 text-base text-text-secondary">
              {saleKindLabel} · {s.saleVenue ?? "—"} · {s.tokenSymbol}
            </p>
            <p className="mt-1 font-mono text-sm text-text-tertiary">
              {t("saleDetail.fromPurchaseToMtm", { days: daysLabel })}
            </p>
            <div className="mt-5">
              <SatisfactionToggle
                activityId={activity.id}
                initialSatisfaction={satisfaction?.satisfaction ?? null}
                initialReason={satisfaction?.reason ?? null}
              />
            </div>
          </header>

          <section className="mt-14 border-y border-border py-12">
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
                {t("saleDetail.markToMarket")}
              </p>
              <div className="flex items-baseline gap-3">
                <span
                  className="font-serif font-normal leading-none text-signature"
                  style={{ fontSize: "clamp(56px, 9vw, 96px)" }}
                >
                  {fmtMultiplier(multiplier)}
                </span>
                <span className="font-serif text-2xl font-normal text-text-tertiary">
                  {t("saleDetail.mtmLabel")}
                </span>
              </div>
              <p className="mt-3 font-mono text-sm text-text-secondary">
                {t("saleDetail.netLead")}{" "}
                <span className={`${headlineTone} font-medium`}>
                  {fmtUsd(netPnl, true)}
                </span>{" "}
                {t("saleDetail.realizedOn", { capital: fmtCapital(usdPaid) })}
              </p>
            </div>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("saleDetail.allocation")}
            </h2>

            <div className="mt-6 overflow-hidden rounded-md border border-border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-text-tertiary">&nbsp;</TableHead>
                    <TableHead className="text-right text-text-secondary">
                      {t("saleDetail.tableValue")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ExecRow label={t("saleDetail.row.usdPaid")} value={fmtUsd(usdPaid)} mono />
                  <ExecRow
                    label={t("saleDetail.row.tokensAllocated")}
                    value={`${fmtTokens(tokens, intlLocale)} ${s.tokenSymbol}`}
                    mono
                  />
                  <ExecRow label={t("saleDetail.row.tgeDate")} value={fmtDate(s.saleDate, intlLocale)} mono />
                  <ExecRow label={t("saleDetail.row.tgeUnlockPct")} value={`${tgePct}%`} mono />
                  <ExecRow
                    label={t("saleDetail.row.vestingCliff")}
                    value={cliffMonths > 0 ? t("saleDetail.monthsAbbrev", { count: cliffMonths }) : t("saleDetail.none")}
                    mono
                  />
                  <ExecRow
                    label={t("saleDetail.row.vestingDuration")}
                    value={durationMonths > 0 ? t("saleDetail.monthsAbbrev", { count: durationMonths }) : t("saleDetail.none")}
                    mono
                  />
                  <ExecRow
                    label={t("saleDetail.row.currentPrice")}
                    value={currentPrice > 0 ? `$${fmtPrice(currentPrice, intlLocale)}` : "—"}
                    mono
                  />
                  <ExecRow
                    label={t("saleDetail.row.currentValue")}
                    value={currentValue > 0 ? fmtUsd(currentValue) : "—"}
                    mono
                  />
                  <ExecRow
                    label={t("saleDetail.row.netPnl")}
                    value={
                      <span className={`font-medium ${headlineTone}`}>
                        {fmtUsd(netPnl, true)}
                      </span>
                    }
                    mono
                  />
                  <ExecRow
                    label={t("saleDetail.row.mtmMultiplier")}
                    value={
                      <span className={`font-medium ${headlineTone}`}>
                        {fmtMultiplier(multiplier)}
                      </span>
                    }
                    mono
                  />
                </TableBody>
              </Table>
            </div>
          </section>

          {activity.regimeTags.length > 0 && (
            <section className="mt-14">
              <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                {t("saleDetail.regimeTags")}
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {activity.regimeTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-border bg-surface px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("saleDetail.notes")}
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              {t("saleDetail.notesSubtitle")}
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

          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("saleDetail.tags")}
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              {t("saleDetail.tagsSubtitle")}
            </p>
            <div className="mt-4">
              <TagEditor activityId={activity.id} initialTags={initialTags} />
            </div>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("saleDetail.screenshots")}
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              {t("saleDetail.screenshotsSubtitle")}
            </p>
            <div className="mt-4">
              <ScreenshotsSection
                activityId={activity.id}
                initialScreenshots={initialScreenshots}
              />
            </div>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("saleDetail.actions")}
            </h2>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                href={`/add/sale/fields?edit=${activity.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3 w-3" />
                {t("saleDetail.edit")}
              </Link>
              <SetReminderButton
                activityId={activity.id}
                activityName={activity.name}
              />
              <DeleteButton
                activityId={activity.id}
                activityType="sale"
                serial={serial}
              />
            </div>
          </section>

          <footer className="mt-20 border-t border-border pt-6 font-mono text-xs text-text-tertiary">
            <div className="flex items-center justify-between">
              <Link
                href="/spreads/archive?activity=sale"
                className="hover:text-text"
              >
                {t("saleDetail.backToSales")}
              </Link>
              <span>
                {t("saleDetail.footerLabel", { serial: serial.toLowerCase() })}
              </span>
            </div>
          </footer>
    </article>
  );
}

function ExecRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="text-text-tertiary text-sm">{label}</TableCell>
      <TableCell
        className={
          (mono ? "font-mono tabular-nums text-text" : "text-text") + " text-right"
        }
      >
        {value}
      </TableCell>
    </TableRow>
  );
}
