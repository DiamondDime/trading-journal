/**
 * Zod validation schemas for API route inputs.
 */
import { z } from 'zod';

export const ExchangeCode = z.enum([
  'binance', 'bybit', 'okx', 'deribit',
  'hyperliquid', 'okx_dex', 'aster',
  'phemex', 'bitget', 'mexc', 'kucoin', 'kraken', 'gate', 'bingx',
]);

export const SpreadType = z.enum([
  'cross_exchange_perp_arb', 'cash_carry', 'calendar',
  'funding_capture', 'dex_cex_arb', 'custom',
]);

export const SpreadStatus = z.enum([
  'candidate', 'rejected',
  'open', 'winding_down', 'orphaned', 'expired', 'closed',
]);

export const SpreadVariant = z.enum([
  'funding', 'basis',                  // cash_carry
  'same_venue', 'cross_venue',         // funding_capture
]);

export const CardHeadlineMetric = z.enum([
  'bps_captured', 'realized_apr', 'bps_per_day', 'net_pnl_quote',
]);

export const CardHeadlineFormat = z.enum(['bps', 'apr_pct', 'bps_per_day', 'usd']);

export const PositionSide = z.enum(['long', 'short']);

export const CreateExchangeConnectionBody = z.object({
  exchange: ExchangeCode,
  label: z.string().min(1).max(40),
  credentials: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('api_key'),
      api_key: z.string().min(8),
      api_secret: z.string().min(8),
      passphrase: z.string().optional(),
    }),
    z.object({
      mode: z.literal('wallet_address'),
      address: z.string().min(8),
      chain: z.string().optional(),
    }),
  ]),
  /**
   * Required when connecting to an exchange that does not expose a
   * permission-introspection endpoint (BingX/MEXC/Phemex). The worker
   * returns ``withdraw:unverified`` for those venues; without this flag
   * the POST handler refuses to persist the connection as active.
   */
  attest_read_only: z.boolean().optional(),
});

// Per-leg intended price the trader can set at open (for slippage review).
const LegIntent = z.object({
  intended_price: z.string().optional(), // Decimal as string
});

export const CreateSpreadBody = z.object({
  spread_type: SpreadType,
  variant: SpreadVariant.optional(),
  name: z.string().min(1).max(120).optional(),
  regime_tags: z.array(z.string().max(40)).max(20).optional(),
  custom_tags: z.array(z.string().max(40)).max(20).optional(),
  capital_deployed_usd: z.string().optional(),
  // Open-intent fields (post-trade review keys off these)
  target_apr_at_open: z.string().optional(),
  expected_holding_days: z.number().int().positive().optional(),
  expected_basis_convergence_date: z.string().date().optional(),
  exit_plan: z.string().max(2000).optional(),
  borrow_cost_assumed_bps: z.string().optional(),
  close_threshold_apr: z.string().optional(),
  close_threshold_periods: z.number().int().positive().optional(),
  max_gas_budget_usd: z.string().optional(),
  slippage_tolerance_bps: z.string().optional(),
  legs: z.array(
    z.object({
      connection_id: z.string().uuid(),
      side: PositionSide,
      position_ids: z.array(z.string().uuid()).min(1),
      role: z.string().max(40),
      intended_price: z.string().optional(),
    })
  ).min(1),
}).superRefine((val, ctx) => {
  // variant must match spread_type
  if (val.variant != null) {
    const ok =
      (val.spread_type === 'cash_carry'      && (val.variant === 'funding' || val.variant === 'basis')) ||
      (val.spread_type === 'funding_capture' && (val.variant === 'same_venue' || val.variant === 'cross_venue'));
    if (!ok) {
      ctx.addIssue({
        code: 'custom',
        path: ['variant'],
        message: `variant ${val.variant} is not valid for spread_type ${val.spread_type}`,
      });
    }
  }
  // cash_carry basis-variant requires the expected convergence date so the
  // post-trade review can compute basis-converged-vs-expectations.
  if (val.spread_type === 'cash_carry'
      && val.variant === 'basis'
      && !val.expected_basis_convergence_date) {
    ctx.addIssue({
      code: 'custom',
      path: ['expected_basis_convergence_date'],
      message: 'basis-variant cash_carry requires expected_basis_convergence_date',
    });
  }
});
// Silence unused-import lint: LegIntent is exported below for callers that
// want to validate just the per-leg intent payload.
export { LegIntent };

export const UpdateSpreadBody = z.object({
  name: z.string().min(1).max(120).optional(),
  variant: SpreadVariant.optional(),
  regime_tags: z.array(z.string().max(40)).max(20).optional(),
  custom_tags: z.array(z.string().max(40)).max(20).optional(),
  exit_plan: z.string().max(2000).optional(),
  target_apr_at_open: z.string().optional(),
  expected_holding_days: z.number().int().positive().optional(),
  expected_basis_convergence_date: z.string().date().optional(),
  close_threshold_apr: z.string().optional(),
  close_threshold_periods: z.number().int().positive().optional(),
  max_gas_budget_usd: z.string().optional(),
  slippage_tolerance_bps: z.string().optional(),
});

export const AcceptCandidateBody = z.object({
  overrides: z.object({
    name: z.string().min(1).max(120).optional(),
    spread_type: SpreadType.optional(),
  }).optional(),
});

export const RejectCandidateBody = z.object({
  reason: z.string().max(200).optional(),
});

export const AddAllowlistBody = z.object({
  email: z.string().email(),
  role: z.enum(['user', 'admin']).default('user'),
  notes: z.string().max(200).optional(),
});

export const ListSpreadsQuery = z.object({
  status: z.string().optional(),
  spread_type: z.string().optional(),
  exchange: z.string().optional(),
  coin: z.string().optional(),
  opened_after: z.string().datetime().optional(),
  opened_before: z.string().datetime().optional(),
  apr_min: z.coerce.number().optional(),
  apr_max: z.coerce.number().optional(),
  search: z.string().max(120).optional(),
  sort_field: z.enum(['opened_at', 'closed_at', 'apr', 'net_pnl', 'capital_deployed']).default('opened_at'),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

// ============================================================================
// Activity (v2) schemas
// Mirror src/types/canonical.ts Activity-family interfaces 1:1 for runtime
// validation at API boundaries (parsing rows from postgres.js + validating
// request bodies that touch the activity tables).
// ============================================================================

// Decimal-as-string primitive. Accepts an optional sign, digits, and an
// optional fractional part. Scientific notation is intentionally rejected
// — values originating from postgres NUMERIC never use it, and accepting it
// would let callers slip in NaN/Infinity-looking strings.
const DecimalSchema = z.string().regex(
  /^-?\d+(\.\d+)?$/,
  'must be a decimal string (e.g. "1234.56" or "-0.01")',
);

export const ActivityTypeSchema = z.enum([
  'spread', 'trade', 'sale', 'airdrop', 'yield_position', 'option',
]);

export const ActivityStatusSchema = z.enum([
  'pending', 'open', 'winding_down', 'unwinding', 'orphaned',
  'vesting', 'claimed', 'liquidated', 'expired', 'closed',
]);

export const SaleKindSchema = z.enum([
  'ido', 'launchpad', 'premarket', 'otc',
  'ieo', 'private_round', 'otc_allocation', 'vesting_claim',
]);

export const TradeKindSchema = z.enum([
  'spot', 'perp', 'dated_future', 'option', 'otc', 'nft',
]);

export const YieldKindSchema = z.enum([
  'stake', 'lend', 'farm', 'lp', 'validator', 'mining',
]);

export const OptionSubtypeKindSchema = z.enum(['single_leg', 'option_spread']);
export const OptionSideSchema        = z.enum(['long', 'short']);
export const OptionCpKindSchema      = z.enum(['call', 'put']);
export const OptionSpreadStyleSchema = z.enum([
  'vertical', 'iron_condor', 'calendar', 'strangle', 'butterfly', 'custom',
]);

export const MovementEventKindSchema = z.enum([
  'bridge', 'convert', 'transfer', 'deposit', 'withdrawal',
  'nft_trade', 'loss', 'other',
]);

export const HeadlineKindSchema = z.enum([
  'realized_apr', 'mtm_multiplier', 'apy_pct', 'realized_pnl_usd',
]);

export const HeadlineFormatSchema = z.enum([
  'apr_pct', 'apy_pct', 'mtm_x', 'usd', 'bps',
]);

export const InstrumentKindSchema = z.enum(['spot', 'perp', 'dated_future', 'option']);

// activity_sale.vesting_schedule (jsonb). Discriminated by `kind`.
export const VestingScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all_at_tge') }),
  z.object({
    kind:        z.literal('tge_plus_linear'),
    tge_pct:     z.number().min(0).max(100),
    linear_days: z.number().int().nonnegative(),
  }),
  z.object({
    kind:        z.literal('cliff_plus_linear'),
    cliff_days:  z.number().int().nonnegative(),
    linear_days: z.number().int().nonnegative(),
    tge_pct:     z.number().min(0).max(100).optional(),
  }),
  z.object({
    kind:    z.literal('custom'),
    entries: z.array(z.object({
      date: z.string().datetime(),
      pct:  z.number().min(0).max(100),
    })),
  }),
]);

// One element of activity_sale.claim_events (jsonb array).
export const ClaimEventSchema = z.object({
  date:    z.string().datetime(),
  qty:     DecimalSchema,
  tx_hash: z.string().optional(),
});

// activity supertype row.
export const ActivitySchema = z.object({
  id:                   z.string().uuid(),
  user_id:              z.string().uuid(),
  type:                 ActivityTypeSchema,
  status:               ActivityStatusSchema,
  name:                 z.string(),
  opened_at:            z.string().datetime().nullable(),
  closed_at:            z.string().datetime().nullable(),
  capital_deployed_usd: DecimalSchema.nullable(),
  realized_pnl_usd:     DecimalSchema.nullable(),
  unrealized_pnl_usd:   DecimalSchema.nullable(),
  fees_usd:             DecimalSchema,
  net_pnl_usd:          DecimalSchema.nullable(),
  regime_tags:          z.array(z.string()),
  custom_tags:          z.array(z.string()),
  strategy_tag:         z.string().nullable(),
  created_at:           z.string().datetime(),
  updated_at:           z.string().datetime(),
  deleted_at:           z.string().datetime().nullable(),
});

// activity_spread subtype row (JOIN to activity for shared cols).
export const ActivitySpreadSchema = z.object({
  activity_id:                     z.string().uuid(),
  spread_type:                     SpreadType,
  variant:                         SpreadVariant.nullable(),
  origin:                          z.enum(['auto_matched', 'manual', 'auto_confirmed']),
  primary_base:                    z.string(),
  match_confidence:                z.number().min(0).max(1).nullable(),
  funding_pnl_quote:               DecimalSchema,
  apr:                             DecimalSchema.nullable(),
  exchanges:                       z.array(ExchangeCode),
  leg_count:                       z.number().int().nonnegative(),
  hold_duration_ms:                z.number().int().nonnegative().nullable(),
  source:                          z.enum(['user', 'system']),
  system_proposal_metadata:        z.record(z.string(), z.unknown()).nullable(),
  target_apr_at_open:              DecimalSchema.nullable(),
  expected_holding_days:           z.number().int().nullable(),
  expected_basis_convergence_date: z.string().datetime().nullable(),
  exit_plan:                       z.string().nullable(),
  borrow_cost_assumed_bps:         DecimalSchema.nullable(),
  close_threshold_apr:             DecimalSchema.nullable(),
  close_threshold_periods:         z.number().int().nullable(),
  max_gas_budget_usd:              DecimalSchema.nullable(),
  slippage_tolerance_bps:          DecimalSchema.nullable(),
});

// activity_trade subtype row.
export const ActivityTradeSchema = z.object({
  activity_id:          z.string().uuid(),
  position_id:          z.string().uuid(),
  symbol:               z.string(),
  exchange:             ExchangeCode,
  instrument_kind:      InstrumentKindSchema,
  side:                 PositionSide,
  entry_thesis:         z.string().nullable(),
  exit_plan:            z.string().nullable(),
  target_price:         DecimalSchema.nullable(),
  stop_price:           DecimalSchema.nullable(),
  qty:                  DecimalSchema,
  avg_entry_price:      DecimalSchema,
  avg_exit_price:       DecimalSchema.nullable(),
  realized_apr:         DecimalSchema.nullable(),
  kind:                 TradeKindSchema,
  leverage:             DecimalSchema.nullable(),
  margin_mode:          z.enum(['cross', 'isolated']).nullable(),
  fees_entry_usd:       DecimalSchema.nullable(),
  fees_exit_usd:        DecimalSchema.nullable(),
  funding_paid_usd:     DecimalSchema.nullable(),
  funding_received_usd: DecimalSchema.nullable(),
  borrow_cost_usd:      DecimalSchema.nullable(),
});

// activity_sale subtype row.
export const ActivitySaleSchema = z.object({
  activity_id:         z.string().uuid(),
  token_symbol:        z.string(),
  token_name:          z.string().nullable(),
  token_chain:         z.string().nullable(),
  sale_kind:           SaleKindSchema,
  sale_venue:          z.string().nullable(),
  sale_date:           z.string().datetime(),
  usd_paid:            DecimalSchema,
  tokens_allocated:    DecimalSchema,
  effective_price_usd: DecimalSchema.nullable(),
  vesting_schedule:    VestingScheduleSchema.nullable(),
  claim_events:        z.array(ClaimEventSchema),
  total_claimed:       DecimalSchema,
  remaining_locked:    DecimalSchema.nullable(),
  current_price_usd:   DecimalSchema.nullable(),
  current_price_at:    z.string().datetime().nullable(),
  claim_wallet:        z.string().nullable(),
  fundraising_round:   z.enum(['seed', 'private', 'public', 'strategic', 'other']).nullable(),
  allocation_method:   z.enum(['fcfs', 'lottery', 'staking', 'whitelist', 'other']).nullable(),
  tier:                z.string().nullable(),
  bonus_pct:           DecimalSchema.nullable(),
});

// activity_airdrop subtype row.
export const ActivityAirdropSchema = z.object({
  activity_id:          z.string().uuid(),
  token_symbol:         z.string(),
  token_name:           z.string().nullable(),
  token_chain:          z.string().nullable(),
  protocol:             z.string(),
  snapshot_date:        z.string().datetime().nullable(),
  eligibility_reason:   z.string().nullable(),
  qty_received:         DecimalSchema.nullable(),
  claim_date:           z.string().datetime().nullable(),
  claim_tx_hash:        z.string().nullable(),
  claim_wallet:         z.string().nullable(),
  gas_cost_usd:         DecimalSchema.nullable(),
  claim_window_start:   z.string().datetime().nullable(),
  claim_window_end:     z.string().datetime().nullable(),
  value_at_receipt_usd: DecimalSchema.nullable(),
  current_price_usd:    DecimalSchema.nullable(),
  current_price_at:     z.string().datetime().nullable(),
});

// v_activity_feed view row.
export const ActivityFeedRowSchema = z.object({
  id:                   z.string().uuid(),
  user_id:              z.string().uuid(),
  type:                 ActivityTypeSchema,
  status:               ActivityStatusSchema,
  name:                 z.string(),
  opened_at:            z.string().datetime().nullable(),
  closed_at:            z.string().datetime().nullable(),
  capital_deployed_usd: DecimalSchema.nullable(),
  realized_pnl_usd:     DecimalSchema.nullable(),
  unrealized_pnl_usd:   DecimalSchema.nullable(),
  fees_usd:             DecimalSchema,
  net_pnl_usd:          DecimalSchema.nullable(),
  regime_tags:          z.array(z.string()),
  custom_tags:          z.array(z.string()),
  strategy_tag:         z.string().nullable(),
  headline_value:       DecimalSchema.nullable(),
  headline_kind:        HeadlineKindSchema,
  headline_format:      HeadlineFormatSchema,
  primary_symbol:       z.string().nullable(),
  card_subtitle:        z.string().nullable(),
  created_at:           z.string().datetime(),
  updated_at:           z.string().datetime(),
});

// ============================================================================
// Activity create-body schemas
//
// Wired into /api/activities/{trade,sale,airdrop} (POST). Mirrors the wizard
// form field names exactly. Numeric values arrive as strings from the GET-form
// pipeline; we coerce + validate. .strict() rejects unknown keys so a typo in
// the form rendering is a 400, not a silent insert with a missing column.
// ============================================================================

/** Number-as-string with a positive bound. */
const PositiveDecimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'must be a positive decimal string')
  .refine((s) => Number(s) > 0, { message: 'must be > 0' });

/** Number-as-string, non-negative. */
const NonNegativeDecimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string')
  .refine((s) => Number(s) >= 0, { message: 'must be >= 0' });

/** Number-as-string, signed (can be negative). */
const SignedDecimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'must be a signed decimal string');

/** Comma-separated tags string → string[]. */
const TagListString = z
  .string()
  .optional()
  .transform((s) =>
    (s ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  )
  .pipe(z.array(z.string().max(40)).max(20));

/**
 * Trade-wizard exchange labels — kept in sync with
 * src/app/add/trade/db.ts EXCHANGE_LABEL_TO_CODE (the runtime authority).
 *
 * We don't import that map directly because src/app/add/trade/db.ts marks
 * itself "server-only" and importing it here would pull the whole DB layer
 * into client bundles. Sync is verified by tests/unit/zod-trade.test.ts.
 *
 * If you add a venue here, mirror it into EXCHANGE_LABEL_TO_CODE (and the
 * picker in src/app/add/trade/fields/page.tsx EXCHANGES).
 */
const TRADE_EXCHANGE_LABELS = [
  'Binance', 'Bybit', 'Hyperliquid', 'OKX', 'Deribit', 'Phemex',
  'Bitget', 'MEXC', 'KuCoin', 'Kraken', 'Gate', 'BingX',
] as const;
const TRADE_EXCHANGE_SET: ReadonlySet<string> = new Set(TRADE_EXCHANGE_LABELS);

const TradeExchange = z
  .string()
  .min(1)
  .max(40)
  .refine((v) => TRADE_EXCHANGE_SET.has(v), {
    message: `Unknown exchange. Expected one of: ${TRADE_EXCHANGE_LABELS.join(', ')}.`,
  });
const TradeInstrument = z.enum(['perp', 'spot', 'future']);
const TradeSide = z.enum(['long', 'short']);

/**
 * CreateTradeBody — mirrors /add/trade/fields. Validates manual-entry trades
 * before they hit createTrade(). Keys match the form's <input name="…">.
 *
 * v5 adds:
 *   - `kind` discriminator (spot/perp/dated_future/option/otc/nft)
 *   - leverage + marginMode (NULL for spot)
 *   - targetPrice + stopPrice + exitPlan (open-intent)
 *   - feesEntry + feesExit (decomposed round-trip cost)
 *   - fundingPaidUsd + fundingReceivedUsd (perp-only) + borrowCostUsd (margin)
 *
 * Validation rules per spec:
 *   - entry_price > 0, exit_price > 0, quantity > 0
 *   - capital_deployed_usd >= 0
 *   - closed_at >= opened_at
 *   - leverage > 0 when present
 *   - marginMode only when kind != 'spot'
 */
export const CreateTradeBody = z
  .object({
    exchange:            TradeExchange,
    symbol:              z.string().min(1).max(40),
    instrument:          TradeInstrument,
    side:                TradeSide,
    capital:             NonNegativeDecimal,
    qty:                 PositiveDecimal,
    entryPrice:          PositiveDecimal,
    exitPrice:           PositiveDecimal,
    fees:                NonNegativeDecimal.optional().default('0'),
    openedAt:            z.string().min(1),  // datetime-local string
    closedAt:            z.string().min(1),
    note:                z.string().max(4000).optional().default(''),
    regimeTags:          TagListString,
    // Pass-through fields from earlier wizard steps. Not validated as content.
    source:              z.string().max(80).optional(),
    // v5 trade-kind discriminator + leverage context
    kind:                TradeKindSchema.optional().default('spot'),
    leverage:            PositiveDecimal.optional(),
    marginMode:          z.enum(['cross', 'isolated']).optional(),
    // v5 open-intent
    targetPrice:         PositiveDecimal.optional(),
    stopPrice:           PositiveDecimal.optional(),
    exitPlan:            z.string().max(2000).optional(),
    // v5 cost decomposition
    feesEntry:           NonNegativeDecimal.optional(),
    feesExit:            NonNegativeDecimal.optional(),
    fundingPaidUsd:      NonNegativeDecimal.optional(),
    fundingReceivedUsd:  NonNegativeDecimal.optional(),
    borrowCostUsd:       NonNegativeDecimal.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const opened = new Date(val.openedAt).getTime();
    const closed = new Date(val.closedAt).getTime();
    if (!Number.isFinite(opened)) {
      ctx.addIssue({ code: 'custom', path: ['openedAt'], message: 'invalid datetime' });
    }
    if (!Number.isFinite(closed)) {
      ctx.addIssue({ code: 'custom', path: ['closedAt'], message: 'invalid datetime' });
    }
    if (Number.isFinite(opened) && Number.isFinite(closed) && closed < opened) {
      ctx.addIssue({
        code: 'custom',
        path: ['closedAt'],
        message: 'closed_at must be >= opened_at',
      });
    }
    // marginMode only makes sense for non-spot kinds. (kind defaults to 'spot'.)
    if (val.marginMode !== undefined && val.kind === 'spot') {
      ctx.addIssue({
        code: 'custom',
        path: ['marginMode'],
        message: 'marginMode is not valid for spot trades',
      });
    }
  });

export type CreateTradeInput = z.input<typeof CreateTradeBody>;
export type CreateTradeData = z.output<typeof CreateTradeBody>;

/**
 * CreateSaleBody — mirrors /add/sale/fields. Captures an allocation manually.
 *
 * v5 expands saleKind to include ieo/private_round/otc_allocation/vesting_claim
 * and adds optional round/tier/wallet/bonus context. tokenChain enables the
 * wallet-paste claim fetcher to pick the right explorer.
 *
 * The discriminated union over saleKind keeps the per-kind required-field
 * differences (e.g. vesting_claim doesn't need usdPaid > 0) cleanly typed.
 *
 * Rules:
 *   - usd_paid > 0, tokens_allocated > 0, current_price_usd >= 0
 *   - tge_unlock_pct in [0, 100]
 *   - bonus_pct in [-100, 500]
 */
const SaleBaseBody = z
  .object({
    venue:                  z.string().min(1).max(80),
    asset:                  z.string().min(1).max(40),
    tokenChain:             z.string().max(40).optional(),
    claimWallet:            z.string().max(80).optional(),
    fundraisingRound:       z.enum(['seed', 'private', 'public', 'strategic', 'other']).optional(),
    allocationMethod:       z.enum(['fcfs', 'lottery', 'staking', 'whitelist', 'other']).optional(),
    tier:                   z.string().max(40).optional(),
    bonusPct:               z.coerce.number().min(-100).max(500).optional(),
    usdPaid:                PositiveDecimal,
    tokensAllocated:        PositiveDecimal,
    tgeDate:                z.string().min(1),  // YYYY-MM-DD
    tgeUnlockPct:           z.coerce.number().min(0).max(100),
    vestingCliffMonths:     z.coerce.number().int().nonnegative().optional().default(0),
    vestingDurationMonths:  z.coerce.number().int().nonnegative().optional().default(0),
    currentPriceUsd:        NonNegativeDecimal,
    openedAt:               z.string().min(1),  // datetime-local
    note:                   z.string().max(4000).optional().default(''),
    regimeTags:             TagListString,
  });

export const CreateSaleBody = z.discriminatedUnion('saleKind', [
  SaleBaseBody.extend({ saleKind: z.literal('ido') }).strict(),
  SaleBaseBody.extend({ saleKind: z.literal('launchpad') }).strict(),
  SaleBaseBody.extend({ saleKind: z.literal('premarket') }).strict(),
  SaleBaseBody.extend({ saleKind: z.literal('otc') }).strict(),
  SaleBaseBody.extend({ saleKind: z.literal('ieo') }).strict(),
  SaleBaseBody.extend({ saleKind: z.literal('private_round') }).strict(),
  SaleBaseBody.extend({ saleKind: z.literal('otc_allocation') }).strict(),
  SaleBaseBody.extend({ saleKind: z.literal('vesting_claim') }).strict(),
]);

export type CreateSaleInput = z.input<typeof CreateSaleBody>;
export type CreateSaleData = z.output<typeof CreateSaleBody>;

/**
 * CreateAirdropBody — mirrors /add/airdrop/fields. Captures a retro / loyalty
 * token drop. Cost basis is always $0; net_pnl is current_value.
 *
 * v5 makes the wizard reach the `pending` status:
 *   - status === 'pending' (eligibility known, no claim yet) → tokensClaimed
 *     and claimDate optional. Trader is registering the watchlist entry.
 *   - status === 'claimed' (or omitted) → tokensClaimed > 0, claimDate required.
 *
 * Adds tokenChain, snapshotDate, claimTxHash, claimWallet, eligibilityReason,
 * gasCostUsd, claimWindowStart/End to support the wallet-paste auto-import +
 * watchlist alerts.
 */
export const CreateAirdropBody = z
  .object({
    status:             z.enum(['pending', 'claimed']).optional().default('claimed'),
    protocol:           z.string().min(1).max(80),
    asset:              z.string().min(1).max(40),
    tokenChain:         z.string().max(40).optional(),
    snapshotDate:       z.string().optional(), // YYYY-MM-DD (allow empty)
    eligibilityReason:  z.string().max(2000).optional(),
    tokensClaimed:      PositiveDecimal.optional(),
    claimDate:          z.string().optional(),
    claimTxHash:        z.string().max(80).optional(),
    claimWallet:        z.string().max(80).optional(),
    gasCostUsd:         NonNegativeDecimal.optional(),
    claimWindowStart:   z.string().optional(),
    claimWindowEnd:     z.string().optional(),
    usdValueAtClaim:    NonNegativeDecimal.optional(),
    currentPriceUsd:    NonNegativeDecimal.optional(),
    note:               z.string().max(4000).optional().default(''),
    regimeTags:         TagListString,
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === 'claimed') {
      if (!val.tokensClaimed) {
        ctx.addIssue({
          code: 'custom',
          path: ['tokensClaimed'],
          message: 'tokensClaimed is required when status is claimed',
        });
      }
      if (!val.claimDate) {
        ctx.addIssue({
          code: 'custom',
          path: ['claimDate'],
          message: 'claimDate is required when status is claimed',
        });
      }
      if (!val.usdValueAtClaim) {
        ctx.addIssue({
          code: 'custom',
          path: ['usdValueAtClaim'],
          message: 'usdValueAtClaim is required when status is claimed',
        });
      }
    }
  });

export type CreateAirdropInput = z.input<typeof CreateAirdropBody>;
export type CreateAirdropData = z.output<typeof CreateAirdropBody>;

/**
 * ListActivitiesQuery — /api/activities GET query string. Filters across all
 * four activity types via v_activity_feed.
 */
export const ListActivitiesQuery = z.object({
  type:           z.string().optional(),      // 'spread,trade,sale,airdrop' subset
  status:         z.string().optional(),
  spread_type:    z.string().optional(),      // only meaningful when type includes 'spread'
  sale_kind:      z.string().optional(),
  asset:          z.string().optional(),
  opened_after:   z.string().datetime().optional(),
  opened_before:  z.string().datetime().optional(),
  search:         z.string().max(120).optional(),
  sort_field:     z.enum([
    'closed_at', 'opened_at', 'realized_pnl_usd', 'net_pnl_usd', 'capital_deployed_usd', 'created_at',
  ]).default('closed_at'),
  sort_dir:       z.enum(['asc', 'desc']).default('desc'),
  limit:          z.coerce.number().int().min(1).max(200).default(50),
  cursor:         z.string().optional(),
});

/**
 * UpdateActivityBody — common-field edits for any activity type.
 * Subtype-specific edits land in Wave 6 via the wizard edit flow; the PATCH
 * API stays scoped to these "safe across all types" fields.
 */
export const UpdateActivityBody = z
  .object({
    name:             z.string().min(1).max(120).optional(),
    regime_tags:      z.array(z.string().max(40)).max(20).optional(),
    custom_tags:      z.array(z.string().max(40)).max(20).optional(),
    status:           ActivityStatusSchema.optional(),
    strategy_tag:     z.string().max(60).nullable().optional(),
  })
  .strict();

// ============================================================================
// Yield position schemas (v5)
//
// CreateYieldPositionBody is a discriminated union over `kind` so each
// yield kind's required-field shape is independently typed. kind_meta
// payload validation is delegated to the per-kind YieldMeta schemas below
// — each branch composes the base body with the appropriate kind_meta
// schema so a stake position can't accidentally land with lp-shaped meta.
// ============================================================================

const YieldStakeMeta = z.object({
  kind:             z.literal('stake'),
  validatorAddress: z.string().max(80).optional(),
  operator:         z.string().max(80).optional(),
});

const YieldLendMeta = z.object({
  kind:     z.literal('lend'),
  rateKind: z.enum(['variable', 'fixed']),
  ltv:      z.number().min(0).max(100).optional(),
});

const YieldFarmMeta = z.object({
  kind:        z.literal('farm'),
  pairA:       z.string().min(1).max(40),
  pairB:       z.string().min(1).max(40),
  amountA:     PositiveDecimal,
  amountB:     PositiveDecimal,
  poolFeeTier: z.string().max(20).optional(),
  rewardToken: z.string().min(1).max(40),
});

const YieldLpMeta = z.object({
  kind:         z.literal('lp'),
  pairA:        z.string().min(1).max(40),
  pairB:        z.string().min(1).max(40),
  amountA:      PositiveDecimal,
  amountB:      PositiveDecimal,
  poolFeeTier:  z.string().min(1).max(20),
  rangeLower:   PositiveDecimal.optional(),
  rangeUpper:   PositiveDecimal.optional(),
  concentrated: z.coerce.boolean(),
});

const YieldValidatorMeta = z.object({
  kind:             z.literal('validator'),
  validatorAddress: z.string().min(1).max(80),
  commissionPct:    z.coerce.number().min(0).max(100),
});

const YieldMiningMeta = z.object({
  kind:                    z.literal('mining'),
  hashrateThs:             z.coerce.number().nonnegative(),
  electricityCostUsdKwh:   z.coerce.number().nonnegative(),
  pool:                    z.string().min(1).max(80),
  expectedDailyRevenueUsd: z.coerce.number().nonnegative(),
});

export const YieldKindMetaSchema = z.discriminatedUnion('kind', [
  YieldStakeMeta,
  YieldLendMeta,
  YieldFarmMeta,
  YieldLpMeta,
  YieldValidatorMeta,
  YieldMiningMeta,
]);

const YieldPositionBase = z.object({
  protocol:           z.string().min(1).max(80),
  venue:              z.string().max(40).optional(),
  chain:              z.string().max(40).optional(),
  asset:              z.string().min(1).max(40),
  amount:             PositiveDecimal,
  amount_usd_at_open: NonNegativeDecimal.optional(),
  expected_apy_pct:   z.coerce.number().min(0).max(10000).optional(),
  rewards_token:      z.string().max(40).optional(),
  fees_protocol_usd:  NonNegativeDecimal.optional().default('0'),
  fees_gas_usd:       NonNegativeDecimal.optional().default('0'),
  status:             z.enum(['open', 'unwinding', 'closed']).optional().default('open'),
  opened_at:          z.string().min(1),
  closed_at:          z.string().optional(),
  name:               z.string().min(1).max(120).optional(),
  regime_tags:        z.array(z.string().max(40)).max(20).optional().default([]),
  custom_tags:        z.array(z.string().max(40)).max(20).optional().default([]),
  strategy_tag:       z.string().max(60).optional(),
});

/**
 * CreateYieldPositionBody — POST /api/activities/yield. Discriminated by
 * `kind`. Each kind extends the base with a matching kind_meta payload.
 */
export const CreateYieldPositionBody = z.discriminatedUnion('kind', [
  YieldPositionBase.extend({
    kind:      z.literal('stake'),
    kind_meta: YieldStakeMeta,
  }).strict(),
  YieldPositionBase.extend({
    kind:      z.literal('lend'),
    kind_meta: YieldLendMeta,
  }).strict(),
  YieldPositionBase.extend({
    kind:      z.literal('farm'),
    kind_meta: YieldFarmMeta,
  }).strict(),
  YieldPositionBase.extend({
    kind:      z.literal('lp'),
    kind_meta: YieldLpMeta,
  }).strict(),
  YieldPositionBase.extend({
    kind:      z.literal('validator'),
    kind_meta: YieldValidatorMeta,
  }).strict(),
  YieldPositionBase.extend({
    kind:      z.literal('mining'),
    kind_meta: YieldMiningMeta,
  }).strict(),
]);

export type CreateYieldPositionData = z.infer<typeof CreateYieldPositionBody>;

/**
 * UpdateYieldPositionBody — PATCH /api/activities/yield/[id]. Every field
 * optional. `kind` cannot change (it would invalidate kind_meta). Status
 * is the most common edit; rewards_accrued/claimed get updated when the
 * trader logs a claim.
 */
export const UpdateYieldPositionBody = z
  .object({
    name:              z.string().min(1).max(120).optional(),
    status:            z.enum(['open', 'unwinding', 'closed']).optional(),
    closed_at:         z.string().datetime().optional(),
    rewards_accrued:   NonNegativeDecimal.optional(),
    rewards_claimed:   NonNegativeDecimal.optional(),
    rewards_usd_value: NonNegativeDecimal.optional(),
    realized_apy_pct:  z.coerce.number().optional(),
    current_price_usd: NonNegativeDecimal.optional(),
    current_price_at:  z.string().datetime().optional(),
    fees_protocol_usd: NonNegativeDecimal.optional(),
    fees_gas_usd:      NonNegativeDecimal.optional(),
    regime_tags:       z.array(z.string().max(40)).max(20).optional(),
    custom_tags:       z.array(z.string().max(40)).max(20).optional(),
    strategy_tag:      z.string().max(60).optional(),
  })
  .strict();

export type UpdateYieldPositionData = z.infer<typeof UpdateYieldPositionBody>;

// ============================================================================
// Option schemas (v5)
//
// Option activities have N legs (1 for single_leg, 2-8 for spreads). The
// option-leg shape is exported so the wizard's `legs` step can validate
// each row independently before the final commit.
// ============================================================================

/**
 * OptionLegBody — one row in the legs array of CreateOptionBody. Mirrors
 * activity_option_leg.
 */
export const OptionLegBody = z
  .object({
    leg_index:                  z.coerce.number().int().nonnegative(),
    exchange:                   ExchangeCode,
    underlying:                 z.string().min(1).max(40),
    expiry:                     z.string().min(1), // YYYY-MM-DD
    strike:                     PositiveDecimal,
    option_kind:                OptionCpKindSchema,
    side:                       OptionSideSchema,
    contracts:                  PositiveDecimal,
    premium_per_contract:       PositiveDecimal,
    premium_total_usd:          NonNegativeDecimal.optional(),
    iv:                         z.coerce.number().nonnegative().optional(),
    delta:                      z.coerce.number().optional(),
    gamma:                      z.coerce.number().optional(),
    theta:                      z.coerce.number().optional(),
    vega:                       z.coerce.number().optional(),
    rho:                        z.coerce.number().optional(),
    filled_at:                  z.string().optional(),
    closed_at:                  z.string().optional(),
    close_premium_per_contract: NonNegativeDecimal.optional(),
    fees_usd:                   NonNegativeDecimal.optional().default('0'),
  })
  .strict();

export type OptionLegInput = z.input<typeof OptionLegBody>;
export type OptionLegData  = z.output<typeof OptionLegBody>;

/**
 * CreateOptionBody — POST /api/activities/option. Top-level + nested legs.
 * subtype === 'single_leg' requires exactly 1 leg; 'option_spread' requires
 * 2-8 legs and a non-null spread_style.
 */
export const CreateOptionBody = z
  .object({
    subtype:           OptionSubtypeKindSchema,
    spread_style:      OptionSpreadStyleSchema.optional(),
    underlying:        z.string().min(1).max(40),
    exchange:          ExchangeCode,
    total_premium_usd: NonNegativeDecimal.optional().default('0'),
    net_premium_usd:   SignedDecimal.optional(),
    max_profit_usd:    SignedDecimal.optional(),
    max_loss_usd:      SignedDecimal.optional(),
    breakeven_lower:   PositiveDecimal.optional(),
    breakeven_upper:   PositiveDecimal.optional(),
    iv_at_open:        z.coerce.number().nonnegative().optional(),
    entry_thesis:      z.string().max(4000).optional(),
    exit_plan:         z.string().max(2000).optional(),
    target_price:      PositiveDecimal.optional(),
    stop_price:        PositiveDecimal.optional(),
    status:            z.enum(['open', 'unwinding', 'expired', 'closed']).optional().default('open'),
    opened_at:         z.string().min(1),
    closed_at:         z.string().optional(),
    name:              z.string().min(1).max(120).optional(),
    regime_tags:       z.array(z.string().max(40)).max(20).optional().default([]),
    custom_tags:       z.array(z.string().max(40)).max(20).optional().default([]),
    strategy_tag:      z.string().max(60).optional(),
    legs:              z.array(OptionLegBody).min(1).max(8),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.subtype === 'single_leg' && val.legs.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['legs'],
        message: 'single_leg requires exactly 1 leg',
      });
    }
    if (val.subtype === 'option_spread') {
      if (val.legs.length < 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['legs'],
          message: 'option_spread requires at least 2 legs',
        });
      }
      if (!val.spread_style) {
        ctx.addIssue({
          code: 'custom',
          path: ['spread_style'],
          message: 'option_spread requires spread_style',
        });
      }
    }
    if (val.subtype === 'single_leg' && val.spread_style) {
      ctx.addIssue({
        code: 'custom',
        path: ['spread_style'],
        message: 'spread_style must be null for single_leg',
      });
    }
  });

export type CreateOptionInput = z.input<typeof CreateOptionBody>;
export type CreateOptionData  = z.output<typeof CreateOptionBody>;

/**
 * UpdateOptionBody — PATCH /api/activities/option/[id]. Mutable fields only;
 * subtype / spread_style cannot change once committed (the leg shape is tied
 * to the subtype). Legs get edited via the dedicated leg endpoint.
 */
export const UpdateOptionBody = z
  .object({
    name:             z.string().min(1).max(120).optional(),
    status:           z.enum(['open', 'unwinding', 'expired', 'closed']).optional(),
    closed_at:        z.string().datetime().optional(),
    realized_pnl_usd: SignedDecimal.optional(),
    entry_thesis:     z.string().max(4000).optional(),
    exit_plan:        z.string().max(2000).optional(),
    target_price:     PositiveDecimal.optional(),
    stop_price:       PositiveDecimal.optional(),
    regime_tags:      z.array(z.string().max(40)).max(20).optional(),
    custom_tags:      z.array(z.string().max(40)).max(20).optional(),
    strategy_tag:     z.string().max(60).optional(),
  })
  .strict();

export type UpdateOptionData = z.infer<typeof UpdateOptionBody>;

// ============================================================================
// Event log schemas (v5)
//
// event_log lives outside the activity supertype — it's an accounting
// table for treasury movements. Bodies are kept thin: the trader picks a
// kind and fills in the fields that apply to that kind (the UI is the
// gatekeeper; Postgres only enforces NOT NULL on user_id/kind/occurred_at).
// ============================================================================

export const CreateEventLogBody = z
  .object({
    kind:                MovementEventKindSchema,
    occurred_at:         z.string().min(1),
    asset:               z.string().max(40).optional(),
    amount:              SignedDecimal.optional(),
    usd_value:           SignedDecimal.optional(),
    from_venue:          z.string().max(80).optional(),
    to_venue:            z.string().max(80).optional(),
    tx_hash:             z.string().max(120).optional(),
    chain:               z.string().max(40).optional(),
    fee_usd:             NonNegativeDecimal.optional(),
    description:         z.string().max(4000).optional(),
    related_activity_id: z.string().uuid().optional(),
  })
  .strict();

export type CreateEventLogData = z.infer<typeof CreateEventLogBody>;

export const UpdateEventLogBody = z
  .object({
    kind:                MovementEventKindSchema.optional(),
    occurred_at:         z.string().datetime().optional(),
    asset:               z.string().max(40).nullable().optional(),
    amount:              SignedDecimal.nullable().optional(),
    usd_value:           SignedDecimal.nullable().optional(),
    from_venue:          z.string().max(80).nullable().optional(),
    to_venue:            z.string().max(80).nullable().optional(),
    tx_hash:             z.string().max(120).nullable().optional(),
    chain:               z.string().max(40).nullable().optional(),
    fee_usd:             NonNegativeDecimal.nullable().optional(),
    description:         z.string().max(4000).nullable().optional(),
    related_activity_id: z.string().uuid().nullable().optional(),
  })
  .strict();

export type UpdateEventLogData = z.infer<typeof UpdateEventLogBody>;

// ============================================================================
// Note schemas
// ============================================================================

/**
 * CreateNoteBody — POST /api/notes. Either creates the (one) note for an
 * activity or updates it when one already exists. The upsert semantics live
 * in upsertNote; the API route validates payload here.
 */
export const CreateNoteBody = z
  .object({
    activity_id: z.string().uuid(),
    body:        z.string().max(50_000),
  })
  .strict();

export type CreateNoteData = z.infer<typeof CreateNoteBody>;

/**
 * UpdateNoteBody — PATCH /api/notes/[id]. `version` is the client's last-
 * known `updated_at`; the upsert path compares for optimistic concurrency
 * and returns 409 on mismatch.
 */
export const UpdateNoteBody = z
  .object({
    body:    z.string().max(50_000),
    version: z.string().datetime().optional(),
  })
  .strict();

export type UpdateNoteData = z.infer<typeof UpdateNoteBody>;

/** GET /api/notes?activity_id=<uuid> */
export const ListNotesQuery = z
  .object({
    activity_id: z.string().uuid(),
  });

// ============================================================================
// Satellite tables (Wave 9A) — schemas for /api/activities/[id]/{tags,
// excursion,screenshots,satisfaction} and /api/screenshots/[id] body input.
// ============================================================================

/** PUT /api/activities/[id]/tags — replace all tags on an activity. */
export const SetTagsBody = z
  .object({
    tags: z.array(z.string().min(1).max(60)).max(40),
  })
  .strict();

export type SetTagsData = z.infer<typeof SetTagsBody>;

/**
 * PUT /api/activities/[id]/excursion — upsert MAE/MFE/stop-loss.
 *
 * All fields optional individually; the route maps `undefined` → "leave alone"
 * on update and "NULL" on insert. Decimals accept signed strings; prices come
 * back from postgres.js as strings so we stay in the string-decimal domain
 * end-to-end.
 */
export const UpsertExcursionBody = z
  .object({
    stop_loss_price: SignedDecimal.nullable().optional(),
    mae_price:       SignedDecimal.nullable().optional(),
    mfe_price:       SignedDecimal.nullable().optional(),
    mae_at:          z.string().datetime().nullable().optional(),
    mfe_at:          z.string().datetime().nullable().optional(),
    source:          z.enum(['manual', 'kline_backfill']).optional(),
    backfilled_at:   z.string().datetime().nullable().optional(),
  })
  .strict();

export type UpsertExcursionData = z.infer<typeof UpsertExcursionBody>;

/** PATCH /api/screenshots/[id] — update annotation state + optional caption. */
export const UpdateScreenshotAnnotationBody = z
  .object({
    // MarkerJS2 state is an opaque JSON blob — we don't validate the shape,
    // only that it's valid JSON the route can pass through to jsonb.
    annotation_state: z.unknown().nullable(),
    caption:          z.string().max(1000).nullable().optional(),
  })
  .strict();

export type UpdateScreenshotAnnotationData = z.infer<typeof UpdateScreenshotAnnotationBody>;

/** PUT /api/activities/[id]/satisfaction — upsert thumbs up/down. */
export const UpsertSatisfactionBody = z
  .object({
    satisfaction: z.boolean(),
    reason:       z.string().max(2000).nullable().optional(),
  })
  .strict();

export type UpsertSatisfactionData = z.infer<typeof UpsertSatisfactionBody>;

// ============================================================================
// SavedView schemas (Wave 13C)
//
// The on-disk shape stores the URL inside the `filters` jsonb column; the API
// surface exposes it as a flat `queryString` field. See
// src/lib/db/saved-views.ts for the rationale.
// ============================================================================

/** POST /api/saved-views — create a new bookmark. */
export const CreateSavedViewBody = z
  .object({
    name:         z.string().min(1).max(60),
    description:  z.string().max(200).optional(),
    queryString:  z.string().min(1).max(2000),
  })
  .strict();

export type CreateSavedViewData = z.infer<typeof CreateSavedViewBody>;

/**
 * PATCH /api/saved-views/[id] — partial edit. Every field optional;
 * `applied:true` is a convenience flag to bump lastAppliedAt without touching
 * other fields (used by the Apply button on /views).
 */
export const UpdateSavedViewBody = z
  .object({
    name:         z.string().min(1).max(60).optional(),
    description:  z.string().max(200).optional(),
    queryString:  z.string().min(1).max(2000).optional(),
    applied:      z.boolean().optional(),
  })
  .strict();

export type UpdateSavedViewData = z.infer<typeof UpdateSavedViewBody>;

// ============================================================================
// Balance tracker schemas (Wave v6)
//
// Match exchange_balances + portfolio_snapshots column shapes 1:1 so the
// API routes can parse rows coming back from postgres.js with `.parse()`.
// The DB column comments document the rationale for the decimal-as-string
// fields inside the jsonb columns; we replicate the contract here.
// ============================================================================

export const WalletTypeSchema = z.enum([
  'spot', 'margin', 'cross_margin', 'isolated_margin',
  'futures', 'earn', 'funding',
]);

export const BalanceSourceSchema = z.enum(['worker', 'manual']);

export const SnapshotSourceSchema = z.enum([
  'scheduled', 'manual_refresh', 'event_driven',
]);

/**
 * BalanceRow — one row from `public.exchange_balances` (camelCase via
 * postgres.js transform). Decimals come back as strings; we validate the
 * string shape via DecimalSchema (already defined above).
 */
export const BalanceRowSchema = z.object({
  id:                   z.string().uuid(),
  userId:               z.string().uuid(),
  exchangeConnectionId: z.string().uuid(),
  walletType:           WalletTypeSchema,
  asset:                z.string(),
  chain:                z.string().nullable(),
  total:                DecimalSchema,
  available:            DecimalSchema,
  locked:               DecimalSchema,
  borrowed:             DecimalSchema,
  usdPrice:             DecimalSchema.nullable(),
  usdValue:             DecimalSchema.nullable(),
  snapshotAt:           z.string().datetime(),
  source:               BalanceSourceSchema,
  createdAt:            z.string().datetime(),
  updatedAt:            z.string().datetime(),
});

export type BalanceRow = z.infer<typeof BalanceRowSchema>;

/**
 * PortfolioSnapshotRow — one row from `public.portfolio_snapshots`. The
 * jsonb columns are typed as Record<string, string> because the migration
 * stores decimals as strings inside the blob.
 */
export const PortfolioSnapshotRowSchema = z.object({
  id:                 z.string().uuid(),
  userId:             z.string().uuid(),
  snapshotAt:         z.string().datetime(),
  totalUsd:           DecimalSchema,
  totalStableUsd:     DecimalSchema,
  totalVolatileUsd:   DecimalSchema,
  byExchange:         z.record(z.string(), z.string()),
  byAsset:            z.record(z.string(), z.string()),
  byChain:            z.record(z.string(), z.string()).nullable(),
  driftFromFillsUsd:  DecimalSchema.nullable(),
  source:             SnapshotSourceSchema,
  createdAt:          z.string().datetime(),
});

export type PortfolioSnapshotRow = z.infer<typeof PortfolioSnapshotRowSchema>;

/**
 * `GET /api/balances/snapshot?range=...` query schema. The range is
 * resolved server-side to a `since` timestamp.
 */
export const SnapshotRangeQuerySchema = z.object({
  range: z.enum(['24h', '7d', '30d', '90d', 'all']).default('30d'),
});

export type SnapshotRangeQuery = z.infer<typeof SnapshotRangeQuerySchema>;

/**
 * Empty body for `POST /api/balances/refresh`. We don't accept a body —
 * the user_id is derived from the authenticated session.
 */
export const RefreshBalancesBodySchema = z.object({}).strict().optional();
