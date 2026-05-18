import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardField, WizardInput, WizardSelect } from "@/components/wizard/wizard-field";
import { getT } from "@/lib/i18n/server";
import { fetchOnchainClaimsForWallet } from "@/lib/onchain/claims";

// getT() reads the csj-locale cookie per request; we also read searchParams
// for the optional chain pre-fill. Both make the page non-cacheable.
export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

/**
 * Display shape for the discovered-claims list. Wider than the v1
 * indexer contract ({@link import("@/lib/onchain/claims").OnchainClaim})
 * because the eventual v3 indexer will join protocol metadata + chain
 * hints in. Until then the list is always empty so the extra fields are
 * never read at runtime.
 */
interface DisplayClaim {
  txHash: string;
  protocol: string;
  asset: string;
  tokenChain: string;
  qty: string;
  valueUsd: string;
  gasUsd: string;
  claimedAt: string;
}

/**
 * Optional wallet-paste shortcut for the airdrop wizard. Trader pastes a
 * wallet + chain, the page calls the indexer helper, and lists any claim
 * transactions found. "Use this claim" pre-fills /fields with the chain,
 * tx hash, qty, value-at-claim, and gas cost so the trader only fills in
 * the thesis / tags.
 *
 * The indexer (`fetchOnchainClaimsForWallet`) is a stub today — it returns
 * an empty claims list for any wallet. The UI renders the empty state and
 * the manual-entry fallback in that case. Wiring a real indexer is a swap
 * inside the helper, no UI changes required.
 */
export default async function AirdropWalletPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;

  const chain = getStr(sp, "chain", "ethereum");
  const wallet = getStr(sp, "wallet");
  // v1: server helper short-circuits and returns an empty list for the
  // already-validated input shape; null only on bad input (page still
  // renders the empty state in that case — no inline 400 surfacing here
  // since the form is the source of the bad value).
  const indexed = wallet
    ? await fetchOnchainClaimsForWallet(chain, wallet)
    : null;
  const fetched: DisplayClaim[] = (indexed?.claims ?? []).map((c) => ({
    txHash: c.txHash,
    // Indexer (v3) provides protocol metadata via a separate join.
    // For v1 placeholder these collapse to the asset symbol.
    protocol: c.token,
    asset: c.token,
    tokenChain: chain,
    qty: c.qty,
    valueUsd: c.valueUsd,
    gasUsd: c.gasCostUsd,
    claimedAt: c.claimDate,
  }));

  const STEP_LABELS = [
    t("wizard.airdrop.wallet.stepLabels.intent"),
    t("wizard.airdrop.wallet.stepLabels.details"),
    t("wizard.airdrop.wallet.stepLabels.review"),
  ] as const;

  // Chain pickable subset — the realistic universe for the launch. The
  // dropdown stays text-edge to other wizards (Sale tokenChain is the
  // same set), so a chain list elsewhere can fold in without a new shape.
  const CHAINS = [
    { value: "ethereum", label: t("wizard.airdrop.wallet.chains.ethereum") },
    { value: "solana", label: t("wizard.airdrop.wallet.chains.solana") },
    { value: "arbitrum", label: t("wizard.airdrop.wallet.chains.arbitrum") },
    { value: "optimism", label: t("wizard.airdrop.wallet.chains.optimism") },
    { value: "base", label: t("wizard.airdrop.wallet.chains.base") },
  ];

  return (
    <WizardShell
      type="airdrop"
      step={1}
      totalSteps={3}
      stepLabels={STEP_LABELS}
      title={t("wizard.airdrop.wallet.title")}
      subtitle={t("wizard.airdrop.wallet.subtitle")}
    >
      {/* ── Wallet form ───────────────────────────────────────────────── */}
      <form
        id="airdrop-wallet-form"
        action="/add/airdrop/wallet"
        method="get"
        className="flex flex-col gap-6"
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.airdrop.wallet.chain.label")}
            htmlFor="chain"
            helper={t("wizard.airdrop.wallet.chain.helper")}
            required
          >
            <WizardSelect id="chain" name="chain" defaultValue={chain} required>
              {CHAINS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </WizardSelect>
          </WizardField>
          <WizardField
            label={t("wizard.airdrop.wallet.wallet.label")}
            htmlFor="wallet"
            helper={t("wizard.airdrop.wallet.wallet.helper")}
            required
          >
            <WizardInput
              id="wallet"
              name="wallet"
              defaultValue={wallet}
              placeholder={t("wizard.airdrop.wallet.wallet.placeholder")}
              required
              autoComplete="off"
              spellCheck={false}
            />
          </WizardField>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-app px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text hover:border-border-strong"
          >
            {t("wizard.airdrop.wallet.fetchBtn.label")}
          </button>
        </div>
      </form>

      {/* ── Results ─────────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-3 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          {t("wizard.airdrop.wallet.results.heading")}
        </h2>
        {!wallet ? (
          <p className="font-serif text-[14px] italic text-text-tertiary">
            {t("wizard.airdrop.wallet.results.idle")}
          </p>
        ) : fetched.length === 0 ? (
          <div className="rounded-md border border-border bg-subtle px-4 py-5">
            <p className="font-serif text-[14px] italic text-text-secondary">
              {t("wizard.airdrop.wallet.results.empty")}
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              {t("wizard.airdrop.wallet.results.fallbackHint")}
            </p>
            <Link
              href={`/add/airdrop/fields?status=claimed&tokenChain=${encodeURIComponent(chain)}&claimWallet=${encodeURIComponent(wallet)}`}
              className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text transition-colors hover:text-text-secondary"
            >
              {t("wizard.airdrop.wallet.results.fallbackCta")}
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {fetched.map((c) => (
              <li
                key={c.txHash}
                className="flex items-baseline justify-between gap-4 rounded-md border border-border bg-surface px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-[15px] font-medium text-text">
                    {c.asset.toUpperCase()} · {c.protocol}
                  </p>
                  <p className="font-mono text-[11px] text-text-tertiary truncate">
                    {c.txHash}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono tabular-nums text-[12px] text-text">
                    {c.qty} {c.asset.toUpperCase()}
                  </p>
                  <p className="font-mono text-[10px] text-text-tertiary">
                    ${c.valueUsd} · gas ${c.gasUsd}
                  </p>
                </div>
                <Link
                  href={`/add/airdrop/fields?${new URLSearchParams({
                    status: "claimed",
                    tokenChain: c.tokenChain,
                    asset: c.asset,
                    protocol: c.protocol,
                    claimTxHash: c.txHash,
                    claimWallet: wallet,
                    claimDate: c.claimedAt.slice(0, 10),
                    tokensClaimed: c.qty,
                    usdValueAtClaim: c.valueUsd,
                    gasCostUsd: c.gasUsd,
                  }).toString()}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-text bg-text px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
                >
                  {t("wizard.airdrop.wallet.results.useClaim")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <div className="mt-10 flex items-center justify-between border-t border-border pt-6">
        <Link
          href="/add/airdrop"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
        >
          <ArrowLeft className="h-3 w-3" />
          {t("wizard.airdrop.wallet.nav.back")}
        </Link>
      </div>
    </WizardShell>
  );
}
