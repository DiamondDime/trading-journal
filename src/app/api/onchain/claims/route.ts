/**
 * POST /api/onchain/claims
 *
 * Stub indexer endpoint for the airdrop wizard's wallet-paste flow. v1
 * returns an empty array — the real Etherscan / Solscan integration is
 * v3 backlog. Set the X-Stub: true response header so clients can show a
 * "coming soon" hint without parsing the body.
 *
 * Request:  { chain: ChainEnum, wallet: string }
 * Response: { data: { claims: OnchainClaim[] } } (always 200 with empty
 *           claims for valid input; 400 with structured error otherwise).
 *
 * Validation lives in {@link parseClaimRequest} (shared with the server-
 * render path in /add/airdrop/wallet) so EVM/Solana regex stays in one
 * place when v3 turns this on.
 */
import { withAuth } from "@/lib/api/handler";
import { errors, ok } from "@/lib/api/response";
import {
  fetchOnchainClaimsForWallet,
  parseClaimRequest,
} from "@/lib/onchain/claims";

export const POST = withAuth(async (req) => {
  const raw = await req.json().catch(() => null);
  const parsed = parseClaimRequest(raw);
  if (!parsed.ok) {
    return errors.badRequest(parsed.code, parsed.message);
  }
  const result = await fetchOnchainClaimsForWallet(
    parsed.value.chain,
    parsed.value.wallet,
  );
  // result is non-null because parseClaimRequest already passed.
  const res = ok({ claims: result?.claims ?? [] });
  res.headers.set("X-Stub", "true");
  return res;
});
