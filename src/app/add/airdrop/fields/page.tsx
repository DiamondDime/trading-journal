import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import {
  WizardField,
  WizardInput,
  WizardTextarea,
} from "@/components/wizard/wizard-field";
import { requireUser } from "@/lib/auth/server";
import { getActivity } from "@/lib/db/activity";
import { getT } from "@/lib/i18n/server";

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

/**
 * Airdrop details — only data-entry step for Airdrop activities.
 * Airdrops never appear in exchange trade history; the wizard collapses
 * to Fields → Review.
 *
 * Edit mode (`?edit=<uuid>`): pre-fill from the existing airdrop row.
 * Cost basis stays $0; the wizard only edits the qty/value/price triple.
 */
export default async function AirdropFieldsPage(props: {
  searchParams: Search;
}) {
  const t = await getT();
  const sp = await props.searchParams;
  const editId = getStr(sp, "edit");

  const STEP_LABELS = [
    t("wizard.airdrop.fields.stepLabels.details"),
    t("wizard.airdrop.fields.stepLabels.review"),
  ] as const;

  let dbDefaults: Partial<{
    protocol: string;
    asset: string;
    tokensClaimed: string;
    claimDate: string;
    usdValueAtClaim: string;
    currentPriceUsd: string;
    note: string;
    regimeTags: string;
    serial: string;
  }> = {};
  let editValid = false;

  if (editId && UUID_RE.test(editId)) {
    const { id: userId } = await requireUser();
    const activity = await getActivity(userId, editId);
    if (activity && activity.subtype.type === "airdrop") {
      const a = activity.subtype.row;
      dbDefaults = {
        protocol: a.protocol,
        asset: a.tokenSymbol,
        tokensClaimed: a.qtyReceived,
        claimDate: isoToDate(a.claimDate),
        usdValueAtClaim: a.valueAtReceiptUsd ?? "",
        currentPriceUsd: a.currentPriceUsd ?? "",
        note: a.eligibilityReason ?? "",
        regimeTags: activity.regimeTags.join(", "),
        serial: activity.id.slice(0, 4).toUpperCase(),
      };
      editValid = true;
    }
  }

  const defaults = {
    protocol: getStr(sp, "protocol") || dbDefaults.protocol || "",
    asset: getStr(sp, "asset") || dbDefaults.asset || "",
    tokensClaimed: getStr(sp, "tokensClaimed") || dbDefaults.tokensClaimed || "",
    claimDate: getStr(sp, "claimDate") || dbDefaults.claimDate || "",
    usdValueAtClaim: getStr(sp, "usdValueAtClaim") || dbDefaults.usdValueAtClaim || "",
    currentPriceUsd: getStr(sp, "currentPriceUsd") || dbDefaults.currentPriceUsd || "",
    note: getStr(sp, "note") || dbDefaults.note || "",
    regimeTags: getStr(sp, "regimeTags") || dbDefaults.regimeTags || "",
  };

  const backHref = editValid ? `/airdrops/${editId}` : "/add";

  return (
    <WizardShell
      type="airdrop"
      step={1}
      totalSteps={2}
      stepLabels={STEP_LABELS}
      title={
        editValid
          ? t("wizard.airdrop.fields.titleEdit")
          : t("wizard.airdrop.fields.title")
      }
      subtitle={
        editValid
          ? t("wizard.airdrop.fields.subtitleEdit")
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
      <form
        id="airdrop-fields-form"
        action="/add/airdrop/review"
        method="get"
        className="flex flex-col gap-7"
      >
        {editValid && <input type="hidden" name="edit" value={editId} />}

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
        </div>

        {/* ── Claim ─────────────────────────────────────────────────── */}
        <SectionLabel>{t("wizard.airdrop.fields.section.claim")}</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.airdrop.fields.tokensClaimed.label")}
            htmlFor="tokensClaimed"
            helper={t("wizard.airdrop.fields.tokensClaimed.helper")}
            required
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
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.fields.claimDate.label")}
            htmlFor="claimDate"
            required
          >
            <WizardInput
              id="claimDate"
              name="claimDate"
              type="date"
              defaultValue={defaults.claimDate}
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.fields.usdValueAtClaim.label")}
            htmlFor="usdValueAtClaim"
            helper={t("wizard.airdrop.fields.usdValueAtClaim.helper")}
            required
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
              required
            />
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.fields.currentPriceUsd.label")}
            htmlFor="currentPriceUsd"
            helper={t("wizard.airdrop.fields.currentPriceUsd.helper")}
            required
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
              required
            />
          </WizardField>
        </div>

        {/* ── Thesis + tags ─────────────────────────────────────────── */}
        <SectionLabel>{t("wizard.airdrop.fields.section.thesisTags")}</SectionLabel>
        <WizardField
          label={t("wizard.airdrop.fields.note.label")}
          htmlFor="note"
          helper={t("wizard.airdrop.fields.note.helper")}
        >
          <WizardTextarea
            id="note"
            name="note"
            rows={4}
            defaultValue={defaults.note}
            placeholder={t("wizard.airdrop.fields.note.placeholder")}
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
