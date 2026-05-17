/**
 * Exchange catalog reads.
 *
 * Single source of truth for the Settings → Exchanges UI catalog. The Postgres
 * `exchange_catalog` table currently holds the v1 columns (code, display_name,
 * venue_type, supports_spot/perp/options, auth_mode). Wave 12B's migration is
 * scheduled to add three columns (`logo_url`, `referral_url`,
 * `requires_passphrase`); until then, those values live in the OVERLAY map
 * below and we merge them in at read time.
 *
 * When Wave 12B's migration lands:
 *   1. Add the three columns to the SELECT in `listExchangeCatalog`.
 *   2. Remove the OVERLAY map (or leave it as a fallback — null-coalesce is
 *      fine).
 *   3. No callers should need to change.
 *
 * Logo policy: we do NOT fetch logos from a third-party CDN — that would log
 * the user's IP to the exchange on every page render (a privacy regression
 * for a local-first tool). Acceptable `logoUrl` values are:
 *   - `null`                            → serif-initial fallback box
 *   - `/exchanges/<code>.svg`           → file under `/public`
 *   - `data:image/svg+xml;base64,...`   → base64-encoded SVG in the DB column
 *
 * Referral policy: only the venues we have a real signed referral with are
 * surfaced in the "Recommended exchanges" rail. The empty overlay for now
 * keeps that section empty until the user backfills.
 */
import { sql } from "@/lib/db/client";

export type ExchangeKind = "cex" | "dex";
export type ExchangeAuthMode = "api_key" | "wallet_address";

export interface CatalogExchange {
  code: string;
  displayName: string;
  kind: ExchangeKind;
  authMode: ExchangeAuthMode;
  supportsPerp: boolean;
  supportsSpot: boolean;
  /** KuCoin, OKX, Bitget, Phemex all require a passphrase on top of key+secret. */
  requiresPassphrase: boolean;
  /** Local-only / data-URL path. Never a third-party host. */
  logoUrl: string | null;
  /** External sign-up referral. `null` means we don't surface a CTA. */
  referralUrl: string | null;
  /** Short italic-serif caption used in the Recommended rail. */
  referralBlurb: string | null;
}

/**
 * Local overlay for fields that aren't in the DB yet (Wave 12B migration is
 * pending). Keys are exchange `code` values from `public.exchange_catalog`.
 *
 * For v1: `logoUrl` and `referralUrl` are intentionally `null` everywhere
 * — the user will paste real values in later. The Recommended section will
 * therefore render empty until then, which is correct (we shouldn't pretend
 * to have partnerships we don't have).
 *
 * `requiresPassphrase` IS real today — KuCoin/OKX/Bitget/Phemex' API auth
 * genuinely requires a third secret. Keep it accurate.
 *
 * `referralBlurb` is allowed even when `referralUrl` is null so the user can
 * pre-write the copy and just paste a link later.
 */
type Overlay = Pick<
  CatalogExchange,
  "requiresPassphrase" | "logoUrl" | "referralUrl" | "referralBlurb"
>;

const OVERLAY: Record<string, Overlay> = {
  binance: {
    requiresPassphrase: false,
    logoUrl: null,
    referralUrl: null,
    referralBlurb: "Deepest perp book · lowest fees with VIP tier",
  },
  bybit: {
    requiresPassphrase: false,
    logoUrl: null,
    referralUrl: null,
    referralBlurb: "Strong funding rates for cash-and-carry",
  },
  okx: {
    requiresPassphrase: true,
    logoUrl: null,
    referralUrl: null,
    referralBlurb: "Multi-asset margin · tight perp spreads",
  },
  bitget: {
    requiresPassphrase: true,
    logoUrl: null,
    referralUrl: null,
    referralBlurb: "Aggressive maker rebates on perps",
  },
  kucoin: {
    requiresPassphrase: true,
    logoUrl: null,
    referralUrl: null,
    referralBlurb: "Long-tail altcoin perps",
  },
  phemex: {
    requiresPassphrase: true,
    logoUrl: null,
    referralUrl: null,
    referralBlurb: "Low-latency inverse perps",
  },
  bingx: {
    requiresPassphrase: false,
    logoUrl: null,
    referralUrl: null,
    referralBlurb: "Copy-trading focused · friendly funding",
  },
  mexc: {
    requiresPassphrase: false,
    logoUrl: null,
    referralUrl: null,
    referralBlurb: "Widest altcoin coverage",
  },
  gate: {
    requiresPassphrase: false,
    logoUrl: null,
    referralUrl: null,
    referralBlurb: "Deep alt-perp listings",
  },
  kraken: {
    requiresPassphrase: false,
    logoUrl: null,
    referralUrl: null,
    referralBlurb: "Regulated · spot-heavy hedge venue",
  },
  deribit: {
    requiresPassphrase: false,
    logoUrl: null,
    referralUrl: null,
    referralBlurb: "Options + dated futures benchmark",
  },
  hyperliquid: {
    requiresPassphrase: false,
    logoUrl: null,
    referralUrl: null,
    referralBlurb: "On-chain perps · zero gas, EVM custody",
  },
  aster: {
    requiresPassphrase: false,
    logoUrl: null,
    referralUrl: null,
    referralBlurb: "Cross-chain perp DEX",
  },
  okx_dex: {
    requiresPassphrase: false,
    logoUrl: null,
    referralUrl: null,
    referralBlurb: "OKX on-chain venue · spot + perp",
  },
};

interface CatalogRow {
  code: string;
  displayName: string;
  venueType: ExchangeKind;
  authMode: ExchangeAuthMode;
  supportsSpot: boolean;
  supportsPerp: boolean;
}

/**
 * Read the full active exchange catalog, merging Wave 12B fields from the
 * local overlay. Order: CEXs first then DEXs, alphabetical within group —
 * matches what the Settings page wants without per-call sorting.
 */
export async function listExchangeCatalog(): Promise<CatalogExchange[]> {
  const rows = await sql<CatalogRow[]>`
    SELECT code, display_name, venue_type, auth_mode,
           supports_spot, supports_perp
    FROM public.exchange_catalog
    WHERE is_active = true
    ORDER BY
      CASE venue_type WHEN 'cex' THEN 0 ELSE 1 END,
      display_name ASC
  `;

  return rows.map((r) => {
    const overlay = OVERLAY[r.code];
    return {
      code: r.code,
      displayName: r.displayName,
      kind: r.venueType,
      authMode: r.authMode,
      supportsSpot: r.supportsSpot,
      supportsPerp: r.supportsPerp,
      requiresPassphrase: overlay?.requiresPassphrase ?? false,
      logoUrl: overlay?.logoUrl ?? null,
      referralUrl: overlay?.referralUrl ?? null,
      referralBlurb: overlay?.referralBlurb ?? null,
    };
  });
}

/**
 * Returns only the rows that have a referral URL set. The Recommended rail
 * uses this — venues without a referral link still appear in the Add dialog
 * but are hidden from the rail (we don't want to fake partnerships).
 */
export function filterReferralExchanges(
  all: CatalogExchange[],
): CatalogExchange[] {
  return all.filter((e) => e.referralUrl != null && e.referralUrl.length > 0);
}
