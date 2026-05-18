import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardField, WizardInput, WizardSelect } from "@/components/wizard/wizard-field";
import { getT } from "@/lib/i18n/server";

// getT() reads the csj-locale cookie per request; we also read searchParams
// for the optional chain pre-fill. Both make the page non-cacheable.
export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

interface OnchainClaim {
  txHash: string;
  protocol: string;
  asset: string;
  tokenChain: string;
  qty: string;
  valueUsd: string;
  gasUsd: string;
  claimedAt: string; // ISO
}

/**
 * v1 stub for the on-chain claim fetcher. Returns no matches — the real
 * Etherscan / Solscan integration is v3 backlog. When v3 lands, this server
 * helper gets replaced by a fetch() against `/api/onchain/claims?chain=...
 * &wallet=...` and the page wires the response straight in.
 *
 * Kept in this file (not the API route) because v1 has no real call — the
 * route still exists so the wallet page can demonstrate the auth/CSRF
 * shape, but it returns an empty array.
 */
function fetchOnchainClaims(_chain: string, _wallet: string): OnchainClaim[] {
  return [];
}

/**
 * Optional wallet-paste shortcut for the airdrop wizard. Trader pastes a
 * wallet + chain, the page (in v3) calls an indexer and lists any claim
 * transactions found. "Use this claim" pre-fills /fields with the chain,
 * tx hash, qty, value-at-claim, and gas cost so the trader only fills in
 * the thesis / tags.
 *
 * v1 behaviour: the indexer is stubbed empty so the path is reachable and
 * the UI demonstrates the eventual UX. The "Fetch from chain" button is
 * disabled with a "coming soon" hint.
 */
export default async function AirdropWalletPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;

  const chain = getStr(sp, "chain", "ethereum");
  const wallet = getStr(sp, "wallet");
  const fetched = wallet ? fetchOnchainClaims(chain, wallet) : [];

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
            disabled
            aria-disabled
            title={t("wizard.airdrop.wallet.fetchBtn.disabledHint")}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-subtle px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-disabled cursor-not-allowed"
          >
            {t("wizard.airdrop.wallet.fetchBtn.label")}
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {t("wizard.airdrop.wallet.fetchBtn.comingSoon")}
          </span>
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
