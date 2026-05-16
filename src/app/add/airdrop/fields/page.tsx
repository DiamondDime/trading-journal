import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import {
  WizardField,
  WizardInput,
  WizardTextarea,
} from "@/components/wizard/wizard-field";

const STEP_LABELS = ["Details", "Review"] as const;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

/**
 * Airdrop details — only data-entry step for Airdrop activities.
 * Airdrops never appear in exchange trade history; the wizard collapses
 * to Fields → Review.
 *
 * Cost basis is always $0 for retro/loyalty drops, but we capture the
 * USD value at the moment of claim — useful for tax records and as the
 * baseline for the MTM multiplier on the review screen.
 */
export default async function AirdropFieldsPage(props: {
  searchParams: Search;
}) {
  const sp = await props.searchParams;

  const defaults = {
    protocol: getStr(sp, "protocol"),
    asset: getStr(sp, "asset"),
    tokensClaimed: getStr(sp, "tokensClaimed"),
    claimDate: getStr(sp, "claimDate"),
    usdValueAtClaim: getStr(sp, "usdValueAtClaim"),
    currentPriceUsd: getStr(sp, "currentPriceUsd"),
    note: getStr(sp, "note"),
    regimeTags: getStr(sp, "regimeTags"),
  };

  return (
    <WizardShell
      type="airdrop"
      step={1}
      totalSteps={2}
      stepLabels={STEP_LABELS}
      title="Airdrop details"
      subtitle="Free tokens still count. Capture what you claimed, when, and the spot value at claim — the rest is mark-to-market upside."
    >
      <form
        id="airdrop-fields-form"
        action="/add/airdrop/review"
        method="get"
        className="flex flex-col gap-7"
      >
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
            href="/add"
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
