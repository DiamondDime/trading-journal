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
