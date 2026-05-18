import { requireUser } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { sql } from "@/lib/db/client";
import { CsvImportForm } from "@/components/settings/csv-import-form";

export const dynamic = "force-dynamic";

interface ConnectionRow {
  id: string;
  label: string;
  exchangeCode: string;
}

/**
 * Settings → Import. CSV upload escape valve for venues we don't have a
 * ccxt adapter for. Wires up the form with the user's existing exchange
 * connections so each fill ends up tied to a real row (the `fills` table
 * FKs to `exchange_connections`).
 *
 * `force-dynamic` because the connection list is per-user and lives in the
 * DB. Without it, Next 16's prerenderer would happily cache the page tree
 * with whatever connections existed at build time.
 */
export default async function ImportSettingsPage() {
  const user = await requireUser();
  const t = await getT();

  const connections = await sql<ConnectionRow[]>`
    SELECT id, label, exchange_code
    FROM public.exchange_connections
    WHERE user_id = ${user.id}::uuid
      AND deleted_at IS NULL
      AND status IN ('active', 'pending', 'rate_limited', 'error')
    ORDER BY exchange_code, label
  `;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 border-b border-border pb-5">
        <h2 className="font-serif text-[24px] font-medium leading-tight text-text">
          {t("settings.import.sectionHeading")}
        </h2>
        <p className="font-serif text-[13px] italic text-text-secondary">
          {t("settings.import.sectionSubtitle")}
        </p>
      </div>

      <div className="rounded-md border border-border bg-surface px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {t("settings.import.howItWorks.title")}
        </p>
        <p className="mt-1 font-serif text-[13px] leading-relaxed text-text-secondary">
          {t("settings.import.howItWorks.body")}
        </p>
      </div>

      <CsvImportForm connections={connections} />

      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        {t("settings.import.footer")}
      </p>
    </div>
  );
}
