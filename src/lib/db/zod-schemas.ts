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

export const ActivityTypeSchema = z.enum(['spread', 'trade', 'sale', 'airdrop']);

export const ActivityStatusSchema = z.enum([
  'pending', 'open', 'winding_down', 'orphaned',
  'vesting', 'claimed', 'liquidated', 'expired', 'closed',
]);

export const SaleKindSchema = z.enum(['ido', 'launchpad', 'premarket', 'otc']);

export const HeadlineKindSchema = z.enum(['realized_apr', 'mtm_multiplier']);

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
  activity_id:     z.string().uuid(),
  position_id:     z.string().uuid(),
  symbol:          z.string(),
  exchange:        ExchangeCode,
  instrument_kind: InstrumentKindSchema,
  side:            PositionSide,
  entry_thesis:    z.string().nullable(),
  exit_plan:       z.string().nullable(),
  target_price:    DecimalSchema.nullable(),
  stop_price:      DecimalSchema.nullable(),
  qty:             DecimalSchema,
  avg_entry_price: DecimalSchema,
  avg_exit_price:  DecimalSchema.nullable(),
  realized_apr:    DecimalSchema.nullable(),
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
  qty_received:         DecimalSchema,
  claim_date:           z.string().datetime().nullable(),
  claim_tx_hash:        z.string().nullable(),
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
  headline_value:       DecimalSchema.nullable(),
  headline_kind:        HeadlineKindSchema,
  primary_symbol:       z.string().nullable(),
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

const TradeExchange = z.enum([
  'Binance', 'Bybit', 'Hyperliquid', 'Coinbase', 'OKX', 'Other',
]);
const TradeInstrument = z.enum(['perp', 'spot', 'future']);
const TradeSide = z.enum(['long', 'short']);

/**
 * CreateTradeBody — mirrors /add/trade/fields. Validates manual-entry trades
 * before they hit createTrade(). Keys match the form's <input name="…">.
 *
 * Validation rules per spec:
 *   - entry_price > 0, exit_price > 0, quantity > 0
 *   - capital_deployed_usd >= 0
 *   - closed_at >= opened_at
 */
export const CreateTradeBody = z
  .object({
    exchange:   TradeExchange,
    symbol:     z.string().min(1).max(40),
    instrument: TradeInstrument,
    side:       TradeSide,
    capital:    NonNegativeDecimal,
    qty:        PositiveDecimal,
    entryPrice: PositiveDecimal,
    exitPrice:  PositiveDecimal,
    fees:       NonNegativeDecimal.optional().default('0'),
    openedAt:   z.string().min(1),  // datetime-local string
    closedAt:   z.string().min(1),
    note:       z.string().max(4000).optional().default(''),
    regimeTags: TagListString,
    // Pass-through fields from earlier wizard steps. Not validated as content.
    source:     z.string().max(80).optional(),
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
  });

export type CreateTradeInput = z.input<typeof CreateTradeBody>;
export type CreateTradeData = z.output<typeof CreateTradeBody>;

/**
 * CreateSaleBody — mirrors /add/sale/fields. Captures an IDO/launchpad/
 * premarket/OTC allocation manually.
 *
 * Rules:
 *   - usd_paid > 0, tokens_allocated > 0, current_price_usd >= 0
 *   - tge_unlock_pct in [0, 100]
 */
export const CreateSaleBody = z
  .object({
    saleKind:               SaleKindSchema,
    venue:                  z.string().min(1).max(80),
    asset:                  z.string().min(1).max(40),
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
  })
  .strict();

export type CreateSaleInput = z.input<typeof CreateSaleBody>;
export type CreateSaleData = z.output<typeof CreateSaleBody>;

/**
 * CreateAirdropBody — mirrors /add/airdrop/fields. Captures a retro / loyalty
 * token drop. Cost basis is always $0; net_pnl is current_value.
 *
 * Rules:
 *   - tokens_claimed > 0, current_price_usd >= 0, usd_value_at_claim >= 0
 */
export const CreateAirdropBody = z
  .object({
    protocol:        z.string().min(1).max(80),
    asset:           z.string().min(1).max(40),
    tokensClaimed:   PositiveDecimal,
    claimDate:       z.string().min(1),  // YYYY-MM-DD
    usdValueAtClaim: NonNegativeDecimal,
    currentPriceUsd: NonNegativeDecimal,
    note:            z.string().max(4000).optional().default(''),
    regimeTags:      TagListString,
  })
  .strict();

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
    name:        z.string().min(1).max(120).optional(),
    regime_tags: z.array(z.string().max(40)).max(20).optional(),
    custom_tags: z.array(z.string().max(40)).max(20).optional(),
    status:      ActivityStatusSchema.optional(),
  })
  .strict();

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
