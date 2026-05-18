/**
 * v1 stub for the on-chain claim indexer.
 *
 * The real implementation in v3 calls Etherscan / Solscan, decodes claim
 * transactions, prices each token at claim-time, and returns the wallet's
 * recent eligible claims. For v1 the surface area is wired (page → server
 * helper → API route) so the contract is testable end-to-end, but the
 * indexer call is a no-op: always returns an empty array.
 *
 * Two entry points:
 *   - {@link fetchOnchainClaimsForWallet}: direct server-to-server call.
 *     Used by /add/airdrop/wallet/page.tsx so the SSR render skips an
 *     HTTP round-trip + cookie forwarding.
 *   - POST /api/onchain/claims: same shape, exposed for any future
 *     client-side caller (e.g., the BETA refetch button when v3 ships).
 *
 * Both paths share {@link parseClaimRequest} for input validation so the
 * regex rules can't drift between server-rendered and HTTP-served paths.
 */

export type OnchainClaimsChain =
  | "ethereum"
  | "solana"
  | "arbitrum"
  | "optimism"
  | "base";

export interface OnchainClaim {
  token: string;
  qty: string;
  valueUsd: string;
  txHash: string;
  claimDate: string;
  gasCostUsd: string;
}

export interface ClaimRequestInput {
  chain: OnchainClaimsChain;
  wallet: string;
}

export interface ClaimRequestParseOk {
  ok: true;
  value: ClaimRequestInput;
}

export interface ClaimRequestParseErr {
  ok: false;
  code: "INVALID_CHAIN" | "INVALID_WALLET";
  message: string;
}

export type ClaimRequestParseResult = ClaimRequestParseOk | ClaimRequestParseErr;

const VALID_CHAINS = new Set<string>([
  "ethereum",
  "solana",
  "arbitrum",
  "optimism",
  "base",
]);

// 0x followed by 40 hex chars. Case-insensitive — EIP-55 checksum casing
// is optional at this layer; the indexer would normalize later.
const EVM_WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// Base58 alphabet, 32-44 chars (Solana addresses are 32 bytes → base58
// length 32-44).
const SOLANA_WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Validate and normalize the inbound claim-request shape. Trims the
 * wallet, lowercases the chain. Returns either a typed payload or a
 * structured error the API route can turn into a 400.
 */
export function parseClaimRequest(raw: unknown): ClaimRequestParseResult {
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      code: "INVALID_CHAIN",
      message: "Body must be an object with { chain, wallet }",
    };
  }
  const obj = raw as Record<string, unknown>;
  const chainRaw = typeof obj.chain === "string" ? obj.chain.toLowerCase() : "";
  if (!VALID_CHAINS.has(chainRaw)) {
    return {
      ok: false,
      code: "INVALID_CHAIN",
      message: `chain must be one of ${[...VALID_CHAINS].join(", ")}`,
    };
  }
  const chain = chainRaw as OnchainClaimsChain;
  const walletRaw = typeof obj.wallet === "string" ? obj.wallet.trim() : "";
  if (!walletRaw) {
    return {
      ok: false,
      code: "INVALID_WALLET",
      message: "wallet is required",
    };
  }
  const evmChains: ReadonlySet<OnchainClaimsChain> = new Set([
    "ethereum",
    "arbitrum",
    "optimism",
    "base",
  ]);
  if (evmChains.has(chain)) {
    if (!EVM_WALLET_RE.test(walletRaw)) {
      return {
        ok: false,
        code: "INVALID_WALLET",
        message: "EVM wallet must match 0x[40 hex chars]",
      };
    }
  } else if (chain === "solana") {
    if (!SOLANA_WALLET_RE.test(walletRaw)) {
      return {
        ok: false,
        code: "INVALID_WALLET",
        message: "Solana wallet must be 32-44 base58 chars",
      };
    }
  }
  return { ok: true, value: { chain, wallet: walletRaw } };
}

/**
 * Direct server helper. Called by the airdrop wallet page during SSR so
 * we don't have to fabricate an absolute URL + forward cookies for what
 * is currently a constant empty array.
 *
 * Returns `null` if the input fails validation (the page renders a
 * generic empty state in that case — no need to differentiate).
 */
export async function fetchOnchainClaimsForWallet(
  chain: string,
  wallet: string,
): Promise<{ claims: OnchainClaim[]; stub: true } | null> {
  const parsed = parseClaimRequest({ chain, wallet });
  if (!parsed.ok) return null;
  // v3 backlog: replace with Etherscan / Solscan calls.
  return { claims: [], stub: true };
}
