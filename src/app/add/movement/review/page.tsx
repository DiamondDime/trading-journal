import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardSummaryRow } from "@/components/wizard/wizard-summary-row";
import { WizardErrorBanner } from "@/components/wizard/wizard-error-banner";
import { WizardSubmitButton } from "@/components/wizard/wizard-submit-button";
import { EventCard } from "@/components/event/event-card";
import { getT } from "@/lib/i18n/server";
import type { MovementEventKind } from "@/types/canonical";
import { logMovement } from "../actions";

export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const MOVEMENT_FIELDS = [
  // editId carries the row id forward in edit mode so logMovement() can
  // UPDATE instead of INSERT a duplicate. Absent on fresh-create paths.
  "editId",
  "kind",
  "occurredAt",
  "asset",
  "amount",
  "usdValue",
  "fromVenue",
  "toVenue",
  "txHash",
  "chain",
  "feeUsd",
  "description",
  "relatedActivityId",
] as const;

function fmtUsd(raw: string): string {
  if (!raw) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  return `$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtAmount(raw: string): string {
  if (!raw) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumSignificantDigits: 8 });
}

function fmtDateTime(raw: string): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return raw;
  return d.toLocaleString("en-US", {
    year:   "numeric",
    month:  "short",
    day:    "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

/**
 * Movement wizard step 3 — review and submit. event_log doesn't get an
 * activity card (it's not in the supertype), so the preview uses the slim
 * <EventCard> with the same wire shape that the list page renders.
 */
export default async function MovementReviewPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;

  const rawKind = getStr(sp, "kind");
  const kind: MovementEventKind = VALID_KINDS.has(rawKind as MovementEventKind)
    ? (rawKind as MovementEventKind)
    : "other";

  const STEP_LABELS = [
    t("wizard.movement.stepLabels.kind"),
    t("wizard.movement.stepLabels.fields"),
    t("wizard.movement.stepLabels.review"),
  ] as const;

  const v = {
    kind,
    occurredAt:        getStr(sp, "occurredAt"),
    asset:             getStr(sp, "asset").toUpperCase(),
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

  const editAllHref = `/add/movement/fields?${new URLSearchParams(
    Object.fromEntries(
      MOVEMENT_FIELDS.map((k) => [k, getStr(sp, k)] as const).filter(
        ([, val]) => val !== "",
      ),
    ),
  ).toString()}`;

  // Edit mode is signalled by a UUID `editId` carried forward from
  // /movement-events/<id>?edit. The submit CTA must say "Save" (not "Log
  // movement") so the user isn't told they're creating a new row.
  const isEditing = UUID_RE.test(getStr(sp, "editId"));

  const kindI18nKey = kind === "nft_trade" ? "nftTrade" : kind;
  const kindLabel = t(`wizard.movement.kinds.${kindI18nKey}.title` as const);

  const cardTitle =
    v.asset && v.fromVenue && v.toVenue
      ? `${v.asset} · ${v.fromVenue} → ${v.toVenue}`
      : v.asset && v.toVenue
        ? `${v.asset} → ${v.toVenue}`
        : v.asset
          ? `${v.asset} · ${kindLabel}`
          : kindLabel;

  const subtitleParts = [v.fromVenue, v.toVenue].filter(Boolean);
  const cardSubtitle = subtitleParts.length > 0
    ? subtitleParts.join(" → ")
    : v.chain || null;

  return (
    <WizardShell
      type="movement"
      step={3}
      totalSteps={3}
      stepLabels={STEP_LABELS}
      title={t("wizard.movement.review.title")}
      subtitle={t("wizard.movement.review.subtitle")}
    >
      <WizardErrorBanner error={getStr(sp, "error") || undefined} />

      {/* ── Slim event-card preview ──────────────────────────────────── */}
      <section className="mb-10 border-y border-border py-8">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.movement.review.previewCaption")}
        </p>
        <EventCard
          item={{
            id:         "preview",
            kind:       v.kind,
            title:      cardTitle,
            subtitle:   cardSubtitle,
            asset:      v.asset || null,
            amount:     v.amount || null,
            usdValue:   v.usdValue || null,
            feeUsd:     v.feeUsd || null,
            occurredAt: v.occurredAt
              ? new Date(v.occurredAt).toISOString()
              : new Date().toISOString(),
            // href omitted — preview only, no row exists yet; renders as
            // a static article rather than a dead <Link href="#">
          }}
        />
      </section>

      {/* ── Field summary ────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.movement.review.section.identity")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.movement.review.row.kind")}
            value={kindLabel}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.movement.review.row.occurredAt")}
            value={fmtDateTime(v.occurredAt)}
            editHref={editAllHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.movement.review.section.asset")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.movement.review.row.asset")}
            value={v.asset || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.movement.review.row.amount")}
            value={fmtAmount(v.amount)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.movement.review.row.usdValue")}
            value={fmtUsd(v.usdValue)}
            editHref={editAllHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.movement.review.section.route")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.movement.review.row.fromVenue")}
            value={v.fromVenue || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.movement.review.row.toVenue")}
            value={v.toVenue || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.movement.review.row.chain")}
            value={v.chain || "—"}
            editHref={editAllHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.movement.review.section.txAndFee")}
        </h2>
        <div>
          <WizardSummaryRow
            label={t("wizard.movement.review.row.feeUsd")}
            value={v.feeUsd ? fmtUsd(v.feeUsd) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={t("wizard.movement.review.row.txHash")}
            value={
              v.txHash
                ? `${v.txHash.slice(0, 10)}…${v.txHash.slice(-6)}`
                : "—"
            }
            editHref={editAllHref}
          />
        </div>

        {(v.description || v.relatedActivityId) && (
          <>
            <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("wizard.movement.review.section.context")}
            </h2>
            <div>
              <WizardSummaryRow
                label={t("wizard.movement.review.row.description")}
                value={v.description || "—"}
                editHref={editAllHref}
                mono={false}
              />
              {v.relatedActivityId && (
                <WizardSummaryRow
                  label={t("wizard.movement.review.row.relatedActivity")}
                  value={`${v.relatedActivityId.slice(0, 8)}…`}
                  editHref={editAllHref}
                />
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Submit ───────────────────────────────────────────────────── */}
      <form action={logMovement} className="mt-10">
        {MOVEMENT_FIELDS.map((k) => (
          <input key={k} type="hidden" name={k} value={getStr(sp, k)} />
        ))}
        <div className="flex items-center justify-between border-t border-border pt-6">
          <Link
            href={editAllHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("common.back")}
          </Link>
          <WizardSubmitButton>
            {isEditing
              ? t("common.save")
              : t("wizard.movement.review.nav.logMovement")}
          </WizardSubmitButton>
        </div>
      </form>
    </WizardShell>
  );
}
