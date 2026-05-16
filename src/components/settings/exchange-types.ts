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
}
