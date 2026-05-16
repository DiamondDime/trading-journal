import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db/client";
import { AddExchangeDialog } from "@/components/settings/add-exchange-dialog";
import { ExchangesTable } from "@/components/settings/exchanges-table";
import { EmptyExchanges } from "@/components/settings/empty-exchanges";
import type {
  ExchangeConnectionRow,
  CatalogEntry,
} from "@/components/settings/exchange-types";

export const dynamic = "force-dynamic";

async function loadConnections(
  userId: string,
): Promise<ExchangeConnectionRow[]> {
  return sql<ExchangeConnectionRow[]>`
    SELECT
      id,
      exchange_code,
      label,
      connection_type,
      api_key_hint,
      wallet_chain,
      status,
      status_message,
      last_sync_at,
      last_fill_at,
      fills_synced::bigint AS fills_synced,
      created_at
    FROM public.exchange_connections
    WHERE user_id = ${userId}::uuid AND deleted_at IS NULL
    ORDER BY created_at DESC
  `;
}

async function loadCatalog(): Promise<CatalogEntry[]> {
  return sql<CatalogEntry[]>`
    SELECT code, display_name, venue_type, auth_mode
    FROM public.exchange_catalog
    ORDER BY display_name ASC
  `;
}

export default async function ExchangesSettingsPage() {
  const user = await requireUser();
  const [connections, catalog] = await Promise.all([
    loadConnections(user.id),
    loadCatalog(),
  ]);

  // v1 supported exchanges per spec
  const v1Codes = new Set(["binance", "bybit", "hyperliquid"]);
  const v1Catalog = catalog.filter((c) => v1Codes.has(c.code));

  const hasAny = connections.length > 0;

  return (
    <div className="space-y-8">
      {/* Section header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <h2 className="font-serif text-[24px] font-medium leading-tight text-text">
            Exchanges
          </h2>
          <p className="mt-1 font-serif text-[13px] italic text-text-secondary">
            Connect your accounts to auto-import fills.
          </p>
        </div>
        {hasAny && <AddExchangeDialog catalog={v1Catalog} />}
      </div>

      {hasAny ? (
        <ExchangesTable connections={connections} catalog={catalog} />
      ) : (
        <EmptyExchanges catalog={v1Catalog} />
      )}

      {hasAny && (
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {connections.length} connection{connections.length === 1 ? "" : "s"}
          {" · "}
          encrypted at rest with AES-256-GCM
        </p>
      )}
    </div>
  );
}
