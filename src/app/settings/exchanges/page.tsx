import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { sql } from "@/lib/db/client";
import {
  listExchangeCatalog,
  type CatalogExchange,
} from "@/lib/db/exchanges";
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

/**
 * Adapt the DB-shaped `CatalogExchange` to the UI-shaped `CatalogEntry`
 * the existing client components expect. Same fields, different field
 * names (`kind` vs `venueType`) for historical reasons — keep the
 * translation in one place so the components don't need to know about
 * both shapes.
 */
function toCatalogEntry(e: CatalogExchange): CatalogEntry {
  return {
    code: e.code,
    displayName: e.displayName,
    venueType: e.kind,
    authMode: e.authMode,
    requiresPassphrase: e.requiresPassphrase,
    logoUrl: e.logoUrl,
    referralUrl: e.referralUrl,
    referralBlurb: e.referralBlurb,
    supportsSpot: e.supportsSpot,
    supportsPerp: e.supportsPerp,
  };
}

export default async function ExchangesSettingsPage() {
  const user = await requireUser();
  const t = await getT();
  const [connections, catalog] = await Promise.all([
    loadConnections(user.id),
    listExchangeCatalog(),
  ]);

  const catalogEntries = catalog.map(toCatalogEntry);

  const hasAny = connections.length > 0;

  return (
    <div className="space-y-8">
      {/* Section header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <h2 className="font-serif text-[24px] font-medium leading-tight text-text">
            {t("settings.exchanges.sectionHeading")}
          </h2>
          <p className="mt-1 font-serif text-[13px] italic text-text-secondary">
            {t("settings.exchanges.sectionSubtitle")}
          </p>
        </div>
        {hasAny && <AddExchangeDialog catalog={catalogEntries} />}
      </div>

      {/* Pointer to /partners — replaces the old in-page ReferralSection.
          Settings stays purely operational; marketing lives on /partners. */}
      <Link
        href="/partners"
        className="flex items-start gap-4 rounded-md border border-dashed border-border bg-surface px-5 py-4 transition-colors hover:border-border-strong hover:bg-subtle"
      >
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[14px] font-medium text-text">
            {t("settings.exchanges.partnersPointer.title")}
          </p>
          <p className="mt-1 font-serif text-[12.5px] italic leading-snug text-text-tertiary">
            {t("settings.exchanges.partnersPointer.body")}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">
          {t("settings.exchanges.partnersPointer.cta")}
          <ArrowRight className="h-3 w-3" />
        </span>
      </Link>

      {hasAny ? (
        <div className="space-y-3">
          <div>
            <h3 className="font-serif text-[18px] font-medium leading-tight text-text">
              {t("settings.exchanges.title")}
            </h3>
            <p className="mt-1 font-serif text-[13px] italic text-text-secondary">
              {t("settings.exchanges.subtitle")}
            </p>
          </div>
          <ExchangesTable
            connections={connections}
            catalog={catalogEntries}
          />
        </div>
      ) : (
        <EmptyExchanges catalog={catalogEntries} />
      )}

      {hasAny && (
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {connections.length === 1
            ? t("settings.exchanges.encryptedFooterOne")
            : t("settings.exchanges.encryptedFooter", { count: connections.length })}
        </p>
      )}
    </div>
  );
}
