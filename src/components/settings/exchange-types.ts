/**
 * Shared types for the Settings → Exchanges UI.
 *
 * These mirror the camelCase shape that `postgres.js` returns (the singleton
 * client is configured with `transform: postgres.camel`). Keep them
 * server/client-safe — no runtime imports.
 */

export type ConnectionStatus =
  | "pending"
  | "active"
  | "syncing"
  | "auth_failed"
  | "rate_limited"
  | "error"
  | "disabled";

export interface ExchangeConnectionRow {
  id: string;
  exchangeCode: string;
  label: string;
  connectionType: "api_key" | "wallet_address";
  apiKeyHint: string | null;
  walletChain: string | null;
  status: ConnectionStatus;
  statusMessage: string | null;
  lastSyncAt: string | null;
  lastFillAt: string | null;
  fillsSynced: string | number;
  createdAt: string;
}

export interface CatalogEntry {
  code: string;
  displayName: string;
  venueType: "cex" | "dex";
  authMode: "api_key" | "wallet_address";
  /** Set to `true` for venues whose API keys require an additional passphrase
   *  (e.g. KuCoin, OKX, Bitget, Phemex). The credentials step renders an extra
   *  input only when this is true. */
  requiresPassphrase: boolean;
  /** Either `null`, an absolute path under `/public/...`, or a `data:` URL.
   *  We never load from a third-party CDN — that would leak the user's IP to
   *  the exchange on every page render. */
  logoUrl: string | null;
  /** External referral / partner sign-up link. `null` hides the row from the
   *  Recommended section but the exchange still appears in the Add dialog. */
  referralUrl: string | null;
  /** Short editorial caption shown beside the referral entry. */
  referralBlurb: string | null;
  /** v1 boolean — `true` means an adapter exists today. UI does not block
   *  picking false-flagged ones, but the empty-state copy may differ. */
  supportsSpot: boolean;
  supportsPerp: boolean;
}
