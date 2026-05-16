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

const STEP_LABELS = ["Details", "Review"] as const;

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
  const sp = await props.searchParams;
  const editId = getStr(sp, "edit");

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
      title={editValid ? "Edit airdrop" : "Airdrop details"}
      subtitle={
        editValid
          ? "Editing existing airdrop. Cost basis stays $0; everything else is fair game."
          : "Free tokens still count. Capture what you claimed, when, and the spot value at claim — the rest is mark-to-market upside."
      }
    >
      {editValid && (
        <aside
          className="mb-6 rounded-md border border-warn/30 bg-warn/5 px-4 py-2.5 text-[12px] text-warn"
          role="status"
        >
          <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">
            Editing
          </span>
          {" — "}
          <span className="font-serif italic">
            airdrop #{dbDefaults.serial}. Changes save back to the same record.
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
        <SectionLabel>Protocol &amp; token</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField label="Protocol" htmlFor="protocol" required>
            <WizardInput
              id="protocol"
              name="protocol"
              defaultValue={defaults.protocol}
              placeholder="Jito"
              required
              autoComplete="off"
            />
          </WizardField>
          <WizardField
            label="Token symbol"
            htmlFor="asset"
            helper="Ticker, uppercase"
            required
          >
            <WizardInput
              id="asset"
              name="asset"
              defaultValue={defaults.asset}
              placeholder="JTO"
              required
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
          </WizardField>
        </div>

        {/* ── Claim ─────────────────────────────────────────────────── */}
        <SectionLabel>Claim</SectionLabel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label="Tokens claimed"
            htmlFor="tokensClaimed"
            helper="What you actually received"
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
          <WizardField label="Claim date" htmlFor="claimDate" required>
            <WizardInput
              id="claimDate"
              name="claimDate"
              type="date"
              defaultValue={defaults.claimDate}
              required
            />
          </WizardField>
          <WizardField
            label="USD value at claim"
            htmlFor="usdValueAtClaim"
            helper="Spot value the moment you claimed. Tax record."
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
            label="Current price"
            htmlFor="currentPriceUsd"
            helper="USD per token, for MTM calc"
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
        <SectionLabel>Thesis &amp; tags</SectionLabel>
        <WizardField
          label="Note"
          htmlFor="note"
          helper="Why this protocol caught the drop, why you held or sold, any context."
        >
          <WizardTextarea
            id="note"
            name="note"
            rows={4}
            defaultValue={defaults.note}
            placeholder="Solana ecosystem usage. Claimed and held; thesis is L1 expansion…"
          />
        </WizardField>
        <WizardField
          label="Regime tags"
          htmlFor="regimeTags"
          helper="Comma-separated. e.g. solana-narrative, oracle-narrative"
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
            Back
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            Review
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
