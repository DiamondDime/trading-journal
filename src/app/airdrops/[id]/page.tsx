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
import { fmtUsd } from "@/lib/data/archive-data";
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
import { NotesEditor } from "@/components/activity/notes-editor";
import { ScreenshotsSection } from "@/components/activity/screenshots-section";
import { toScreenshotItems } from "@/components/activity/screenshots-data";
import { TagEditor } from "@/components/activity/tag-editor";
import { SatisfactionToggle } from "@/components/activity/satisfaction-toggle";
import { getT, getLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

function fmtPrice(n: number, intlLocale: string) {
  if (n < 1) return n.toLocaleString(intlLocale, { maximumSignificantDigits: 4 });
  return n.toLocaleString(intlLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtTokens(n: number, intlLocale: string) {
  return n.toLocaleString(intlLocale, { maximumFractionDigits: 0 });
}
function fmtDate(iso: string | null, intlLocale: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(intlLocale, { month: "short", day: "numeric", year: "numeric" });
}
function fmtMultiplier(m: number) {
  if (!Number.isFinite(m) || m === 0) return "—";
  return m >= 10 ? `${m.toFixed(1)}×` : `${m.toFixed(2)}×`;
}

export default async function AirdropDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; action?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { id: userId } = await requireUser();
  const t = await getT();
  const intlLocale = (await getLocale()) === "ru" ? "ru-RU" : "en-US";
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
  if (!activity || activity.subtype.type !== "airdrop") {
    notFound();
  }
  const initialScreenshots = toScreenshotItems(screenshots);

  const a = activity.subtype.row;
  const tokens = Number(a.qtyReceived);
  const currentPrice = Number(a.currentPriceUsd ?? 0);
  const currentValue = tokens * currentPrice;
  const valueAtClaim = Number(a.valueAtReceiptUsd ?? 0);
  // Multiplier when valueAtClaim is 0 (free airdrop with no recorded
  // cost-basis). Show "—" rather than a misleading "1.00×" since the trade
  // has no denominator. fmtMultiplier maps 0 / non-finite to "—" already.
  const multiplier = valueAtClaim > 0 ? currentValue / valueAtClaim : 0;
  const netPnl = Number(activity.netPnlUsd ?? 0);
  const headlineTone = multiplier >= 1 ? "text-up" : "text-down";
  // Status uses the top-level status.* dict (all 9 ActivityStatus values).
  // The local airdropDetail.status only had 3 keys (pending|claimed|closed)
  // which produced a broken raw-key fallback for non-canonical airdrop
  // statuses (e.g. expired retroactive drops).
  const statusLabel = t(`status.${activity.status}`);
  const serial = `A#${activity.id.slice(0, 4).toUpperCase()}`;
  const claimLabel = fmtDate(a.claimDate ?? activity.openedAt, intlLocale);
  const daysSinceClaim = a.claimDate
    ? // Date.now is pure-at-request-time inside this async Server Component.
      // eslint-disable-next-line react-hooks/purity
      Math.max(0, Math.round((Date.now() - new Date(a.claimDate).getTime()) / 86_400_000))
    : 0;

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
              <span>{claimLabel}</span>
            </span>
          </div>

          <header className="mt-6">
            <div className="flex items-start justify-between gap-6">
              <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-text md:text-5xl">
                {activity.name}
              </h1>
              <Link
                href={`/add/airdrop/fields?edit=${activity.id}`}
                aria-label={t("airdropDetail.editAria")}
                className="mt-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-tertiary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Link>
            </div>
            <p className="mt-3 text-base text-text-secondary">
              {a.protocol} · {a.tokenSymbol}
            </p>
            <p className="mt-1 font-mono text-sm text-text-tertiary">
              {a.claimDate
                ? t("airdropDetail.daysSinceClaim", { days: daysSinceClaim })
                : t("airdropDetail.notClaimedYet")}
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
                {t("airdropDetail.markToMarket")}
              </p>
              <div className="flex items-baseline gap-3">
                <span
                  className="font-serif font-normal leading-none text-signature"
                  style={{ fontSize: "clamp(56px, 9vw, 96px)" }}
                >
                  {fmtMultiplier(multiplier)}
                </span>
                <span className="font-serif text-2xl font-normal text-text-tertiary">
                  {t("airdropDetail.mtmAbbrev")}
                </span>
              </div>
              <p className="mt-3 font-mono text-sm text-text-secondary">
                {t("airdropDetail.netPrefix")}{" "}
                <span className={`${headlineTone} font-medium`}>
                  {fmtUsd(netPnl, true)}
                </span>{" "}
                {t("airdropDetail.netSuffix")}
              </p>
            </div>
          </section>

          {a.eligibilityReason && (
            <section className="mt-14">
              <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                {t("airdropDetail.thesis")}
              </h2>
              <div className="mt-4 space-y-4 font-serif text-lg leading-[1.65] text-text">
                <p>{a.eligibilityReason}</p>
              </div>
            </section>
          )}

          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("airdropDetail.claim")}
            </h2>

            <div className="mt-6 overflow-hidden rounded-md border border-border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-text-tertiary">&nbsp;</TableHead>
                    <TableHead className="text-right text-text-secondary">{t("airdropDetail.table.value")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ExecRow label={t("airdropDetail.table.protocol")} value={a.protocol} mono />
                  <ExecRow
                    label={t("airdropDetail.table.tokensClaimed")}
                    value={`${fmtTokens(tokens, intlLocale)} ${a.tokenSymbol}`}
                    mono
                  />
                  <ExecRow label={t("airdropDetail.table.claimDate")} value={fmtDate(a.claimDate, intlLocale)} mono />
                  <ExecRow label={t("airdropDetail.table.valueAtClaim")} value={fmtUsd(valueAtClaim)} mono />
                  <ExecRow
                    label={t("airdropDetail.table.currentPrice")}
                    value={currentPrice > 0 ? `$${fmtPrice(currentPrice, intlLocale)}` : "—"}
                    mono
                  />
                  <ExecRow
                    label={t("airdropDetail.table.currentValue")}
                    value={currentValue > 0 ? fmtUsd(currentValue) : "—"}
                    mono
                  />
                  <ExecRow
                    label={t("airdropDetail.table.costBasis")}
                    value={<span className="text-text-tertiary">$0.00</span>}
                    mono
                  />
                  <ExecRow
                    label={t("airdropDetail.table.netPnl")}
                    value={
                      <span className={`font-medium ${headlineTone}`}>
                        {fmtUsd(netPnl, true)}
                      </span>
                    }
                    mono
                  />
                  <ExecRow
                    label={t("airdropDetail.table.mtmMultiplier")}
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
                {t("airdropDetail.regimeTags")}
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
              {t("airdropDetail.notes")}
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              {t("airdropDetail.notesHint")}
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
              {t("airdropDetail.tags")}
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              {t("airdropDetail.tagsHint")}
            </p>
            <div className="mt-4">
              <TagEditor activityId={activity.id} initialTags={initialTags} />
            </div>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("airdropDetail.screenshots")}
            </h2>
            <p className="mt-2 font-serif text-[12px] italic text-text-tertiary">
              {t("airdropDetail.screenshotsHint")}
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
              {t("airdropDetail.actions")}
            </h2>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                href={`/add/airdrop/fields?edit=${activity.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-border-strong hover:text-text"
              >
                <Pencil className="h-3 w-3" />
                {t("airdropDetail.edit")}
              </Link>
              <DeleteButton
                activityId={activity.id}
                activityType="airdrop"
                serial={serial}
              />
            </div>
          </section>

          <footer className="mt-20 border-t border-border pt-6 font-mono text-xs text-text-tertiary">
            <div className="flex items-center justify-between">
              <Link
                href="/spreads/archive?activity=airdrop"
                className="hover:text-text"
              >
                {t("airdropDetail.backLink")}
              </Link>
              <span>
                {t("airdropDetail.footerLabel", { serial: serial.toLowerCase() })}
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
