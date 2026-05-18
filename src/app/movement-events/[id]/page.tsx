import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { getEvent, deleteEventLog } from "@/lib/db/events";
import { EventCard } from "@/components/event/event-card";
import { WizardSummaryRow } from "@/components/wizard/wizard-summary-row";
import { WizardPreviewBanner } from "@/components/wizard/wizard-preview-banner";
import { getT, getLocale } from "@/lib/i18n/server";
import type { MovementEventKind } from "@/types/canonical";

export const dynamic = "force-dynamic";

interface DetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; action?: string }>;
}

function fmtUsd(raw: string | null | undefined, intlLocale: string): string {
  if (raw == null) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  return `$${Math.abs(n).toLocaleString(intlLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtQty(raw: string | null, intlLocale: string): string {
  if (raw == null) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(intlLocale, { maximumSignificantDigits: 8 });
}

function fmtDateTime(iso: string, intlLocale: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(intlLocale, {
    year:   "numeric",
    month:  "short",
    day:    "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

// Inline server action — keeps the detail page atomic with its delete path.
async function deleteEventAction(formData: FormData): Promise<void> {
  "use server";
  const id = formData.get("id");
  if (typeof id !== "string") return;
  const { id: userId } = await requireUser();
  await deleteEventLog(userId, id);
  redirect("/movement-events");
}

export default async function MovementEventDetailPage({
  params,
  searchParams,
}: DetailPageProps) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { id: userId } = await requireUser();
  const t = await getT();
  const intlLocale = (await getLocale()) === "ru" ? "ru-RU" : "en-US";

  const row = await getEvent(userId, id);
  if (!row) notFound();

  const kindI18nKey = row.kind === "nft_trade" ? "nftTrade" : row.kind;
  const kindLabel = t(`wizard.movement.kinds.${kindI18nKey}.title` as const);

  const buildTitle = (): string => {
    if (row.asset && row.fromVenue && row.toVenue) {
      return `${row.asset} · ${row.fromVenue} → ${row.toVenue}`;
    }
    if (row.asset && row.toVenue) return `${row.asset} → ${row.toVenue}`;
    if (row.asset) return `${row.asset} · ${kindLabel}`;
    return kindLabel;
  };

  const serial = `E#${row.id.slice(0, 4).toUpperCase()}`;

  // Pre-fill the wizard for edit. The wizard renders fields/page.tsx from
  // searchParams, so the same shape carries over.
  const editParams = new URLSearchParams();
  editParams.set("kind", row.kind);
  // datetime-local input wants YYYY-MM-DDTHH:mm (no seconds, no TZ).
  editParams.set(
    "occurredAt",
    new Date(row.occurredAt).toISOString().slice(0, 16),
  );
  if (row.asset)             editParams.set("asset", row.asset);
  if (row.amount)            editParams.set("amount", row.amount);
  if (row.usdValue)          editParams.set("usdValue", row.usdValue);
  if (row.fromVenue)         editParams.set("fromVenue", row.fromVenue);
  if (row.toVenue)           editParams.set("toVenue", row.toVenue);
  if (row.txHash)            editParams.set("txHash", row.txHash);
  if (row.chain)             editParams.set("chain", row.chain);
  if (row.feeUsd)            editParams.set("feeUsd", row.feeUsd);
  if (row.description)       editParams.set("description", row.description);
  if (row.relatedActivityId) editParams.set("relatedActivityId", row.relatedActivityId);
  const editHref = `/add/movement/fields?${editParams.toString()}`;

  const cardSubtitleParts = [row.fromVenue, row.toVenue].filter(Boolean) as string[];
  const cardSubtitle = cardSubtitleParts.length > 0
    ? cardSubtitleParts.join(" → ")
    : row.chain;

  return (
    <article className="mx-auto max-w-4xl px-6 py-14 md:py-20">
      <WizardPreviewBanner from={sp.from} action={sp.action} />
      <div className="flex items-center justify-between font-mono text-xs text-text-tertiary">
        <Link
          href="/movement-events"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-text"
        >
          <ArrowLeft className="h-3 w-3" />
          {t("movementEvents.detail.backToList")}
        </Link>
        <span>{serial}</span>
      </div>

      {/* ── Headline card ──────────────────────────────────────────────── */}
      <header className="mt-8">
        <EventCard
          item={{
            id:         row.id,
            kind:       row.kind,
            title:      buildTitle(),
            subtitle:   cardSubtitle,
            asset:      row.asset,
            amount:     row.amount,
            usdValue:   row.usdValue,
            feeUsd:     row.feeUsd,
            occurredAt: row.occurredAt,
            href:       "#",
          }}
        />
      </header>

      {/* ── Field rows ─────────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("movementEvents.detail.section.identity")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("movementEvents.detail.row.kind")}
            value={kindLabel}
            editHref={editHref}
          />
          <WizardSummaryRow
            label={t("movementEvents.detail.row.occurredAt")}
            value={fmtDateTime(row.occurredAt, intlLocale)}
            editHref={editHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("movementEvents.detail.section.asset")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("movementEvents.detail.row.asset")}
            value={row.asset ?? "—"}
            editHref={editHref}
          />
          <WizardSummaryRow
            label={t("movementEvents.detail.row.amount")}
            value={fmtQty(row.amount, intlLocale)}
            editHref={editHref}
          />
          <WizardSummaryRow
            label={t("movementEvents.detail.row.usdValue")}
            value={fmtUsd(row.usdValue, intlLocale)}
            editHref={editHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("movementEvents.detail.section.route")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("movementEvents.detail.row.fromVenue")}
            value={row.fromVenue ?? "—"}
            editHref={editHref}
          />
          <WizardSummaryRow
            label={t("movementEvents.detail.row.toVenue")}
            value={row.toVenue ?? "—"}
            editHref={editHref}
          />
          <WizardSummaryRow
            label={t("movementEvents.detail.row.chain")}
            value={row.chain ?? "—"}
            editHref={editHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("movementEvents.detail.section.txAndFee")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("movementEvents.detail.row.feeUsd")}
            value={fmtUsd(row.feeUsd, intlLocale)}
            editHref={editHref}
          />
          <WizardSummaryRow
            label={t("movementEvents.detail.row.txHash")}
            value={
              row.txHash
                ? `${row.txHash.slice(0, 10)}…${row.txHash.slice(-6)}`
                : "—"
            }
            editHref={editHref}
          />
        </div>

        {(row.description || row.relatedActivityId) && (
          <>
            <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("movementEvents.detail.section.context")}
            </h2>
            <div>
              <WizardSummaryRow
                label={t("movementEvents.detail.row.description")}
                value={row.description ?? "—"}
                editHref={editHref}
                mono={false}
              />
              {row.relatedActivityId && (
                <WizardSummaryRow
                  label={t("movementEvents.detail.row.relatedActivity")}
                  value={`${row.relatedActivityId.slice(0, 8)}…`}
                  editHref={editHref}
                />
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <section className="mt-10 flex items-center justify-between border-t border-border pt-6">
        <Link
          href={editHref}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-border-strong hover:text-text"
        >
          {t("movementEvents.detail.actions.edit")}
        </Link>
        <form action={deleteEventAction}>
          <input type="hidden" name="id" value={row.id} />
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-down/30 bg-surface px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-down transition-colors hover:bg-down/10"
          >
            <Trash2 className="h-3 w-3" />
            {t("movementEvents.detail.actions.delete")}
          </button>
        </form>
      </section>

      <footer className="mt-12 border-t border-border pt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
        {t("movementEvents.detail.footerSerial", { serial: row.id.slice(0, 8).toUpperCase() })}
      </footer>
    </article>
  );
}
