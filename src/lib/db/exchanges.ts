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
  /** Headline rebate percentage (e.g. 40 → "Up to 40% fee rebate").
   *  These are conservative defaults that match what the exchanges
   *  themselves market. Edit per-exchange in the OVERLAY map below. */
  rebatePct: number | null;
  /** Short welcome-bonus copy. Translated via i18n key when prefixed with
   *  `i18n:` — otherwise displayed verbatim. */
  welcomeBonus: string | null;
  /** 2-3 perk i18n keys (under `partners.perks.*`) — translated at render. */
  perks: string[];
  /** Sort order in the partners marketing rail. Lower = higher. */
  priority: number;
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
  | "requiresPassphrase"
  | "logoUrl"
  | "referralUrl"
  | "referralBlurb"
  | "rebatePct"
  | "welcomeBonus"
  | "perks"
  | "priority"
>;

/**
 * Referral data populated 2026-05-17. Rebate percentages are conservative
 * placeholders — the exchanges set the real terms. Update freely in this
 * file (no migration needed) when the user gets fresh numbers from a
 * partner manager.
 *
 * Priority controls the partners-page sort order. Bybit and OKX lead
 * because they're the two venues users are most likely to recognize.
 */
const OVERLAY: Record<string, Overlay> = {
  binance: {
    requiresPassphrase: false,
    logoUrl: "/exchanges/binance.png",
    referralUrl: null,
    referralBlurb: "partners.blurb.binance",
    rebatePct: null,
    welcomeBonus: null,
    perks: [],
    priority: 99,
  },
  bybit: {
    requiresPassphrase: false,
    logoUrl: "/exchanges/bybit.png",
    referralUrl: "https://partner.bybit.com/b/94654",
    referralBlurb: "partners.blurb.bybit",
    rebatePct: 20,
    welcomeBonus: "partners.bonus.bybit",
    perks: [
      "partners.perks.feeRebates",
      "partners.perks.welcomeBonus",
      "partners.perks.fundingLeader",
    ],
    priority: 10,
  },
  okx: {
    requiresPassphrase: true,
    logoUrl: "/exchanges/okx.png",
    referralUrl: "https://okx.com/ru-ae/join/44845570",
    referralBlurb: "partners.blurb.okx",
    rebatePct: 20,
    welcomeBonus: "partners.bonus.okx",
    perks: [
      "partners.perks.feeRebates",
      "partners.perks.multiMargin",
      "partners.perks.tightSpreads",
    ],
    priority: 20,
  },
  bitget: {
    requiresPassphrase: true,
    logoUrl: "/exchanges/bitget.png",
    referralUrl:
      "https://www.bitgetapp.com/ru/referral/register?clacCode=QA7PEZ1K&from=%2Fru%2Fevents%2Freferral-all-program&source=events&utmSource=PremierInviter",
    referralBlurb: "partners.blurb.bitget",
    rebatePct: 30,
    welcomeBonus: "partners.bonus.bitget",
    perks: [
      "partners.perks.feeRebates",
      "partners.perks.makerRebates",
      "partners.perks.welcomeBonus",
    ],
    priority: 50,
  },
  kucoin: {
    requiresPassphrase: true,
    logoUrl: "/exchanges/kucoin.png",
    referralUrl: "https://www.kucoin.com/ucenter/signup?utm_source=app_g_Share",
    referralBlurb: "partners.blurb.kucoin",
    rebatePct: 40,
    welcomeBonus: "partners.bonus.kucoin",
    perks: [
      "partners.perks.feeRebates",
      "partners.perks.altCoverage",
      "partners.perks.welcomeBonus",
    ],
    priority: 60,
  },
  phemex: {
    requiresPassphrase: true,
    logoUrl: "/exchanges/phemex.png",
    referralUrl: "https://phemex.com/register?referralCode=BU8YF9&scene=referral",
    referralBlurb: "partners.blurb.phemex",
    rebatePct: 40,
    welcomeBonus: "partners.bonus.phemex",
    perks: [
      "partners.perks.feeRebates",
      "partners.perks.lowLatency",
      "partners.perks.inversePerps",
    ],
    priority: 80,
  },
  bingx: {
    requiresPassphrase: false,
    logoUrl: "/exchanges/bingx.png",
    referralUrl: "https://bingxdao.com/invite/2XFCXB/",
    referralBlurb: "partners.blurb.bingx",
    rebatePct: 30,
    welcomeBonus: "partners.bonus.bingx",
    perks: [
      "partners.perks.feeRebates",
      "partners.perks.copyTrading",
      "partners.perks.fundingLeader",
    ],
    priority: 70,
  },
  mexc: {
    requiresPassphrase: false,
    logoUrl: "/exchanges/mexc.png",
    referralUrl: "https://promote.mexc.com/a/2DkdpyPG",
    referralBlurb: "partners.blurb.mexc",
    rebatePct: 50,
    welcomeBonus: "partners.bonus.mexc",
    perks: [
      "partners.perks.feeRebates",
      "partners.perks.altCoverage",
      "partners.perks.welcomeBonus",
    ],
    priority: 40,
  },
  gate: {
    requiresPassphrase: false,
    logoUrl: "/exchanges/gate.png",
    referralUrl:
      "https://www.gate.com/referral/registry?ref=VQVAVQ0KBQ&ref_type=103&page=superRebate",
    referralBlurb: "partners.blurb.gate",
    rebatePct: 40,
    welcomeBonus: "partners.bonus.gate",
    perks: [
      "partners.perks.feeRebates",
      "partners.perks.altCoverage",
      "partners.perks.deepBook",
    ],
    priority: 30,
  },
  htx: {
    requiresPassphrase: false,
    logoUrl: "/exchanges/htx.png",
    referralUrl: "https://www.htx.com.ph/invite/ru-ru/1f?invite_code=9vxje223",
    referralBlurb: "partners.blurb.htx",
    rebatePct: 50,
    welcomeBonus: "partners.bonus.htx",
    perks: [
      "partners.perks.feeRebates",
      "partners.perks.regulated",
      "partners.perks.welcomeBonus",
    ],
    priority: 45,
  },
  kraken: {
    requiresPassphrase: false,
    logoUrl: "/exchanges/kraken.svg",
    referralUrl: null,
    referralBlurb: "partners.blurb.kraken",
    rebatePct: null,
    welcomeBonus: null,
    perks: [],
    priority: 99,
  },
  deribit: {
    requiresPassphrase: false,
    logoUrl: "/exchanges/deribit.svg",
    referralUrl: null,
    referralBlurb: "partners.blurb.deribit",
    rebatePct: null,
    welcomeBonus: null,
    perks: [],
    priority: 99,
  },
  hyperliquid: {
    requiresPassphrase: false,
    logoUrl: "/exchanges/hyperliquid.png",
    referralUrl: null,
    referralBlurb: "partners.blurb.hyperliquid",
    rebatePct: null,
    welcomeBonus: null,
    perks: [],
    priority: 99,
  },
  aster: {
    requiresPassphrase: false,
    logoUrl: "/exchanges/aster.png",
    referralUrl: null,
    referralBlurb: "partners.blurb.aster",
    rebatePct: null,
    welcomeBonus: null,
    perks: [],
    priority: 99,
  },
  okx_dex: {
    requiresPassphrase: false,
    logoUrl: "/exchanges/okx.png",
    referralUrl: null,
    referralBlurb: "partners.blurb.okx_dex",
    rebatePct: null,
    welcomeBonus: null,
    perks: [],
    priority: 99,
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
      rebatePct: overlay?.rebatePct ?? null,
      welcomeBonus: overlay?.welcomeBonus ?? null,
      perks: overlay?.perks ?? [],
      priority: overlay?.priority ?? 99,
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

/**
 * Returns ALL active catalog exchanges sorted so referral-eligible ones lead
 * (lowest `priority` first), with non-referral venues trailing. Used by the
 * `/partners` page so every exchange the journal supports gets a logo card,
 * not just the ones with active referrals. Cards without a referralUrl
 * render without the "Sign up" CTA — the marketing pitch only fires for
 * actual partners.
 */
export function getPartnerCatalog(
  all: CatalogExchange[],
): CatalogExchange[] {
  return [...all].sort((a, b) => a.priority - b.priority);
}
