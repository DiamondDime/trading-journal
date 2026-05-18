/**
 * Wizard-local DB helpers for the airdrop flow.
 *
 * Why this file exists:
 *   Migration v5 added a swath of new columns to `activity_airdrop`
 *   (token_chain, snapshot_date, claim_tx_hash, claim_wallet,
 *   eligibility_reason, gas_cost_usd, claim_window_start/end) and to the
 *   `activity` supertype (strategy_tag, tax_taxable, tax_jurisdiction). The
 *   shared `createAirdrop()` / `updateAirdropActivity()` in
 *   `src/lib/db/activity.ts` only know about the v1 column set and live
 *   outside the Wave-2D scope. Wave 2D writes its own wizard-local SQL so
 *   the wizard reaches every column the schema exposes.
 *
 * Status branches:
 *   - `pending`: pre-claim watchlist. token + protocol + eligibility known;
 *     claim_date / qty / value-at-claim may be null. `closed_at` is left null
 *     (status enum check requires opened_at; we use snapshot_date or now()).
 *   - `claimed`: full claim happened. Existing semantics + new columns.
 *
 * Gas-cost wiring:
 *   `gas_cost_usd` is stored on the subtype AND propagated to
 *   `activity.fees_usd` so the cards / aggregations subtract it from net P&L
 *   without subtype-specific code. Same column-promotion pattern the spread
 *   wizard uses for `fees_usd`.
 */

import { sql } from '@/lib/db/client';
import type { CreateAirdropData } from '@/lib/db/zod-schemas';
import { setTagsForActivity } from '@/lib/db/satellite';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Supertype-level extras that aren't in CreateAirdropBody (zod schema is
 *  shared TS; we don't touch it). The wizard parses these out of FormData
 *  in `actions.ts` and passes them in via this extras bag. */
export interface AirdropExtras {
  strategyTag: string | null;
  taxTaxable: boolean;
  taxJurisdiction: string | null;
  /** Free-form custom tags, comma-separated string from the form. */
  customTagsRaw: string;
  /** Confidence radio value — folded into eligibility_reason as a prefix. */
  eligibilityConfidence: 'snapshot_listed' | 'expected_unconfirmed' | 'claimed_confirmed' | null;
}

function parseNum(s: string | undefined | null): number {
  if (s === null || s === undefined || s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function nullableStr(s: string | undefined | null): string | null {
  if (s === null || s === undefined) return null;
  const trimmed = s.trim();
  return trimmed === '' ? null : trimmed;
}

function nullableDate(s: string | undefined | null): string | null {
  const v = nullableStr(s);
  if (!v) return null;
  // Inputs from a `<input type="date">` come as 'YYYY-MM-DD' which is a
  // valid Postgres date literal — no coercion needed.
  return v;
}

function nullableIso(s: string | undefined | null): string | null {
  const v = nullableStr(s);
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function deriveAirdropName(asset: string, protocol: string): string {
  return `${asset.toUpperCase()} · ${protocol} airdrop`;
}

/** Compose the eligibility_reason text from the structured confidence prefix
 *  + the free-form text the user typed. Round-trip stable: read parser at
 *  the wizard edge unwraps the prefix back into the radio value. */
function composeEligibilityReason(
  confidence: AirdropExtras['eligibilityConfidence'],
  freeText: string | null,
): string | null {
  const prefix = confidence ? `[${confidence}]` : null;
  if (prefix && freeText) return `${prefix} ${freeText}`;
  if (prefix) return prefix;
  return freeText;
}

/** Inverse of composeEligibilityReason — strips the `[confidence_tag]` prefix
 *  if present and returns (confidence, body) for edit-mode pre-fill. */
export function parseEligibilityReason(raw: string | null | undefined): {
  confidence: AirdropExtras['eligibilityConfidence'];
  text: string;
} {
  const v = (raw ?? '').trim();
  if (!v) return { confidence: null, text: '' };
  // No `s` flag — target is es2017. Match the prefix-only portion against
  // the start of the string; capture body manually via slice. Same effect,
  // works with newlines because we never anchor against `$` over the body.
  const m = v.match(/^\[(snapshot_listed|expected_unconfirmed|claimed_confirmed)\]\s*/);
  if (!m) return { confidence: null, text: v };
  return {
    confidence: m[1] as AirdropExtras['eligibilityConfidence'],
    text: v.slice(m[0].length),
  };
}

/** Normalised customTags pulled from the wizard's comma-separated input. */
function normaliseCustomTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const t = part.trim();
    if (!t || t.length > 60) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ============================================================================
// createAirdropV5 — insert a fresh airdrop with every v5 column populated.
// ============================================================================

export interface CreateAirdropV5Result {
  id: string;
}

export async function createAirdropV5(
  userId: string,
  input: CreateAirdropData,
  extras: AirdropExtras,
): Promise<CreateAirdropV5Result> {
  const status = input.status === 'pending' ? 'pending' : 'claimed';
  const tokens = parseNum(input.tokensClaimed);
  const valueAtClaim = parseNum(input.usdValueAtClaim);
  const currentPrice = parseNum(input.currentPriceUsd);
  const gasCost = parseNum(input.gasCostUsd);
  const currentValue = tokens * currentPrice;

  // Lifecycle stamps:
  //  - pending → opened_at = snapshot_date (or now), closed_at = null
  //  - claimed → opened_at = closed_at = claim_date (or now)
  const snapshotIso = nullableIso(input.snapshotDate);
  const claimIso = nullableIso(input.claimDate);
  const openedIso =
    status === 'pending'
      ? snapshotIso ?? new Date().toISOString()
      : claimIso ?? new Date().toISOString();
  const closedIso = status === 'claimed' ? openedIso : null;

  // P&L math:
  //  - realized = value_at_claim (the income event) — 0 if pending
  //  - fees_usd = gas_cost_usd (rolls into card aggregations)
  //  - net_pnl = current_value − fees_usd (claimed) | 0 − fees_usd (pending)
  const realized = status === 'claimed' ? valueAtClaim : 0;
  const fees = gasCost;
  const netPnl = (status === 'claimed' ? currentValue : 0) - fees;

  const eligibilityReason = composeEligibilityReason(
    extras.eligibilityConfidence,
    nullableStr(input.eligibilityReason ?? input.note),
  );

  const customTags = normaliseCustomTags(extras.customTagsRaw);

  const activityId = await sql.begin(async (tx) => {
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at, closed_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags,
        strategy_tag, tax_taxable, tax_jurisdiction
      ) VALUES (
        ${userId}::uuid, 'airdrop', ${status},
        ${deriveAirdropName(input.asset, input.protocol)},
        ${openedIso}::timestamptz, ${closedIso}::timestamptz,
        '0', ${realized.toString()}, ${fees.toString()}, ${netPnl.toString()},
        ${input.regimeTags as string[]}, ${[] as string[]},
        ${extras.strategyTag},
        ${extras.taxTaxable},
        ${extras.taxJurisdiction}
      )
      RETURNING id
    `;

    await tx`
      INSERT INTO public.activity_airdrop (
        activity_id, token_symbol, protocol,
        token_chain, snapshot_date, eligibility_reason,
        qty_received, claim_date,
        claim_tx_hash, claim_wallet,
        gas_cost_usd, claim_window_start, claim_window_end,
        value_at_receipt_usd, current_price_usd, current_price_at
      ) VALUES (
        ${activity.id}::uuid,
        ${input.asset.toUpperCase()},
        ${input.protocol},
        ${nullableStr(input.tokenChain)},
        ${nullableDate(input.snapshotDate)}::date,
        ${eligibilityReason},
        ${status === 'claimed' && tokens > 0 ? tokens.toString() : null},
        ${claimIso}::timestamptz,
        ${nullableStr(input.claimTxHash)},
        ${nullableStr(input.claimWallet)},
        ${gasCost > 0 ? gasCost.toString() : null},
        ${nullableDate(input.claimWindowStart)}::date,
        ${nullableDate(input.claimWindowEnd)}::date,
        ${status === 'claimed' && valueAtClaim > 0 ? valueAtClaim.toString() : null},
        ${currentPrice > 0 ? currentPrice.toString() : null},
        ${currentPrice > 0 ? new Date().toISOString() : null}
      )
    `;

    return activity.id;
  });

  // Custom tags via the satellite helper — runs after the transaction so the
  // ownership check sees the freshly-inserted activity row.
  if (customTags.length > 0) {
    await setTagsForActivity(userId, activityId, customTags);
  }

  return { id: activityId };
}

// ============================================================================
// updateAirdropV5 — full-replace update used by the wizard's edit path.
// ============================================================================

export async function updateAirdropV5(
  userId: string,
  activityId: string,
  input: CreateAirdropData,
  extras: AirdropExtras,
): Promise<boolean> {
  if (!UUID_RE.test(activityId)) return false;

  const status = input.status === 'pending' ? 'pending' : 'claimed';
  const tokens = parseNum(input.tokensClaimed);
  const valueAtClaim = parseNum(input.usdValueAtClaim);
  const currentPrice = parseNum(input.currentPriceUsd);
  const gasCost = parseNum(input.gasCostUsd);
  const currentValue = tokens * currentPrice;

  const snapshotIso = nullableIso(input.snapshotDate);
  const claimIso = nullableIso(input.claimDate);
  const openedIso =
    status === 'pending'
      ? snapshotIso ?? new Date().toISOString()
      : claimIso ?? new Date().toISOString();
  const closedIso = status === 'claimed' ? openedIso : null;

  const realized = status === 'claimed' ? valueAtClaim : 0;
  const fees = gasCost;
  const netPnl = (status === 'claimed' ? currentValue : 0) - fees;

  const eligibilityReason = composeEligibilityReason(
    extras.eligibilityConfidence,
    nullableStr(input.eligibilityReason ?? input.note),
  );

  const customTags = normaliseCustomTags(extras.customTagsRaw);

  const ok = await sql.begin(async (tx) => {
    const parentRows = await tx<{ id: string }[]>`
      UPDATE public.activity
      SET name = ${deriveAirdropName(input.asset, input.protocol)},
          status = ${status},
          opened_at = ${openedIso}::timestamptz,
          closed_at = ${closedIso}::timestamptz,
          realized_pnl_usd = ${realized.toString()},
          fees_usd = ${fees.toString()},
          net_pnl_usd = ${netPnl.toString()},
          regime_tags = ${input.regimeTags as string[]},
          strategy_tag = ${extras.strategyTag},
          tax_taxable = ${extras.taxTaxable},
          tax_jurisdiction = ${extras.taxJurisdiction}
      WHERE id = ${activityId}::uuid
        AND user_id = ${userId}::uuid
        AND deleted_at IS NULL
      RETURNING id
    `;
    if (parentRows.length === 0) return false;

    await tx`
      UPDATE public.activity_airdrop
      SET token_symbol = ${input.asset.toUpperCase()},
          protocol = ${input.protocol},
          token_chain = ${nullableStr(input.tokenChain)},
          snapshot_date = ${nullableDate(input.snapshotDate)}::date,
          eligibility_reason = ${eligibilityReason},
          qty_received = ${status === 'claimed' && tokens > 0 ? tokens.toString() : null},
          claim_date = ${claimIso}::timestamptz,
          claim_tx_hash = ${nullableStr(input.claimTxHash)},
          claim_wallet = ${nullableStr(input.claimWallet)},
          gas_cost_usd = ${gasCost > 0 ? gasCost.toString() : null},
          claim_window_start = ${nullableDate(input.claimWindowStart)}::date,
          claim_window_end = ${nullableDate(input.claimWindowEnd)}::date,
          value_at_receipt_usd = ${status === 'claimed' && valueAtClaim > 0 ? valueAtClaim.toString() : null},
          current_price_usd = ${currentPrice > 0 ? currentPrice.toString() : null},
          current_price_at = ${currentPrice > 0 ? new Date().toISOString() : null}
      WHERE activity_id = ${activityId}::uuid
    `;

    return true;
  });

  if (!ok) return false;

  // Rewrite custom tags (deletes + reinserts inside setTagsForActivity).
  await setTagsForActivity(userId, activityId, customTags);

  return true;
}
