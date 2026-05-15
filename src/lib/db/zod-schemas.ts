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

export const SpreadStatus = z.enum(['candidate', 'open', 'closed', 'rejected']);

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

export const CreateSpreadBody = z.object({
  spread_type: SpreadType,
  name: z.string().min(1).max(120).optional(),
  regime: z.string().max(60).optional(),
  legs: z.array(
    z.object({
      connection_id: z.string().uuid(),
      side: PositionSide,
      position_ids: z.array(z.string().uuid()).min(1),
      role: z.string().max(40),
    })
  ).min(1),
  custom_tags: z.array(z.string().max(40)).max(20).optional(),
  capital_deployed_usd: z.string().optional(),
});

export const UpdateSpreadBody = z.object({
  name: z.string().min(1).max(120).optional(),
  regime_tags: z.array(z.string().max(40)).max(20).optional(),
  custom_tags: z.array(z.string().max(40)).max(20).optional(),
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
