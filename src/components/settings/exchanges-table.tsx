import { cn } from "@/lib/utils";
import { ExchangeRowActions } from "@/components/settings/exchange-row-actions";
import { ExchangeLogo } from "@/components/settings/exchange-logo";
import { getT, getLocale } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n/resolve";
import type { Locale } from "@/lib/i18n/types";
import type {
  CatalogEntry,
  ExchangeConnectionRow,
  ConnectionStatus,
} from "@/components/settings/exchange-types";

interface Props {
  connections: ExchangeConnectionRow[];
  catalog: CatalogEntry[];
}

const STATUS_TONE: Record<ConnectionStatus, string> = {
  pending: "bg-subtle text-text-secondary",
  active: "bg-up-bg text-up",
  syncing: "bg-info-bg text-info",
  auth_failed: "bg-down-bg text-down",
  rate_limited: "bg-warn-bg text-warn",
  error: "bg-down-bg text-down",
  disabled: "bg-subtle text-text-tertiary",
};

export async function ExchangesTable({ connections, catalog }: Props) {
  const t = await getT();
  const locale = await getLocale();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  // Index catalog rows by code so we can render the logo + display name per
  // connection in O(1). If the connection points at a code missing from the
  // catalog (e.g. an exchange that was removed), we degrade to the raw code
  // and a null-logo fallback so the row still renders.
  const byCode = new Map(catalog.map((c) => [c.code, c]));

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border">
            <TableHead>{t("settings.exchanges.table.columns.exchange")}</TableHead>
            <TableHead>{t("settings.exchanges.table.columns.label")}</TableHead>
            <TableHead>{t("settings.exchanges.table.columns.status")}</TableHead>
            <TableHead className="text-right">
              {t("settings.exchanges.table.columns.fills")}
            </TableHead>
            <TableHead>{t("settings.exchanges.table.columns.lastSync")}</TableHead>
            <TableHead className="sr-only">
              {t("settings.exchanges.table.columns.actions")}
            </TableHead>
          </tr>
        </thead>
        <tbody>
          {connections.map((row) => {
            const meta = byCode.get(row.exchangeCode);
            const name = meta?.displayName ?? row.exchangeCode;
            const logoUrl = meta?.logoUrl ?? null;
            // fillsSynced is queried as ::bigint, so values past
            // Number.MAX_SAFE_INTEGER arrive as a string. Number() handles
            // both; for a journal, fills past 2^53 isn't realistic.
            const fills = Number(row.fillsSynced ?? 0);
            const dash = t("settings.exchanges.table.connectionType.dash");
            const hint =
              row.connectionType === "wallet_address"
                ? `${t("settings.exchanges.table.connectionType.wallet")} · ${
                    row.walletChain ?? dash
                  }`
                : `${t("settings.exchanges.table.connectionType.apiKey")} · ${
                    row.apiKeyHint ?? dash
                  }`;
            return (
              <tr
                key={row.id}
                className="border-b border-border-subtle last:border-b-0 hover:bg-subtle/40"
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <ExchangeLogo
                      code={row.exchangeCode}
                      displayName={name}
                      logoUrl={logoUrl}
                      size="sm"
                    />
                    <div className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate font-serif text-[15px] font-medium text-text">
                        {name}
                      </span>
                      <span className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                        {hint}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {/* break-all so a paste-bombed 40-char label wraps gracefully
                      instead of forcing the table to overflow its container. */}
                  <span className="block max-w-[220px] break-all font-mono text-[12px] text-text">
                    {row.label}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} t={t} />
                  {row.statusMessage && row.status !== "active" && (
                    <p
                      className="mt-1 max-w-[220px] truncate font-mono text-[10px] text-text-tertiary"
                      title={translateStatusMessage(row.statusMessage, t)}
                    >
                      {translateStatusMessage(row.statusMessage, t)}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-[13px] tabular-nums text-text">
                    {fills.toLocaleString(intlLocale)}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-[12px] text-text-secondary">
                    {formatRelative(row.lastSyncAt, locale, t)}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <ExchangeRowActions
                    connectionId={row.id}
                    exchangeName={name}
                  />
                </TableCell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TableHead({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-5 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-text-tertiary",
        className,
      )}
    >
      {children}
    </th>
  );
}

function TableCell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("px-5 py-4 align-top", className)}>{children}</td>
  );
}

/**
 * Translate known server-emitted status messages into localized copy. The
 * sync API stores English in `connection.status_message` for compatibility
 * with the worker; we map the canonical strings to dictionary keys here
 * and pass anything else through verbatim.
 */
function translateStatusMessage(message: string, t: TFunction): string {
  if (message.startsWith("Awaiting worker validation")) {
    return t("settings.exchanges.statusMessages.awaitingValidation");
  }
  if (message.toLowerCase() === "attestation required") {
    return t("settings.exchanges.statusMessages.attestationRequired");
  }
  if (message.toLowerCase() === "connect failed") {
    return t("settings.exchanges.statusMessages.connectFailed");
  }
  return message;
}

function StatusBadge({
  status,
  t,
}: {
  status: ConnectionStatus;
  t: TFunction;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]",
        STATUS_TONE[status],
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "active" && "bg-up",
          status === "syncing" && "bg-info",
          status === "pending" && "bg-text-tertiary",
          (status === "auth_failed" || status === "error") && "bg-down",
          status === "rate_limited" && "bg-warn",
          status === "disabled" && "bg-text-disabled",
        )}
      />
      {t(`settings.exchanges.statusBadge.${status}` as const)}
    </span>
  );
}

/**
 * Locale-aware relative time. Uses Intl.RelativeTimeFormat so Russian gets
 * "5 минут назад" / "2 дня назад", English gets "5 min ago" etc.
 */
function formatRelative(
  iso: string | null,
  locale: Locale,
  t: TFunction,
): string {
  if (!iso) return t("settings.exchanges.relative.never");
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return t("settings.exchanges.relative.invalid");
  // Clamp delta to zero so clock-skew (server slightly ahead of client)
  // doesn't surface as "in 3s ago" — treat as "just now".
  const delta = Math.max(0, Date.now() - then);
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  const sec = Math.floor(delta / 1000);
  if (sec < 5) return t("settings.exchanges.relative.justNow");
  const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });
  if (sec < 60) return rtf.format(-sec, "second");
  const min = Math.floor(sec / 60);
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.floor(min / 60);
  if (hr < 24) return rtf.format(-hr, "hour");
  const days = Math.floor(hr / 24);
  if (days < 30) return rtf.format(-days, "day");
  const months = Math.floor(days / 30);
  if (months < 12) return rtf.format(-months, "month");
  return rtf.format(-Math.floor(months / 12), "year");
}
