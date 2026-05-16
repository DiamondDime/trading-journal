import { cn } from "@/lib/utils";
import { ExchangeRowActions } from "@/components/settings/exchange-row-actions";
import type {
  CatalogEntry,
  ExchangeConnectionRow,
  ConnectionStatus,
} from "@/components/settings/exchange-types";

interface Props {
  connections: ExchangeConnectionRow[];
  catalog: CatalogEntry[];
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  pending: "Pending",
  active: "Active",
  syncing: "Syncing",
  auth_failed: "Auth failed",
  rate_limited: "Rate limited",
  error: "Error",
  disabled: "Disabled",
};

const STATUS_TONE: Record<ConnectionStatus, string> = {
  pending: "bg-subtle text-text-secondary",
  active: "bg-up-bg text-up",
  syncing: "bg-info-bg text-info",
  auth_failed: "bg-down-bg text-down",
  rate_limited: "bg-warn-bg text-warn",
  error: "bg-down-bg text-down",
  disabled: "bg-subtle text-text-tertiary",
};

export function ExchangesTable({ connections, catalog }: Props) {
  const displayName = new Map(catalog.map((c) => [c.code, c.displayName]));

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border">
            <TableHead>Exchange</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Fills imported</TableHead>
            <TableHead>Last sync</TableHead>
            <TableHead className="sr-only">Actions</TableHead>
          </tr>
        </thead>
        <tbody>
          {connections.map((row) => {
            const name = displayName.get(row.exchangeCode) ?? row.exchangeCode;
            const fills = Number(row.fillsSynced ?? 0);
            return (
              <tr
                key={row.id}
                className="border-b border-border-subtle last:border-b-0 hover:bg-subtle/40"
              >
                <TableCell>
                  <div className="flex flex-col leading-tight">
                    <span className="font-serif text-[15px] font-medium text-text">
                      {name}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                      {row.connectionType === "wallet_address"
                        ? `wallet · ${row.walletChain ?? "—"}`
                        : `api key · ${row.apiKeyHint ?? "—"}`}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-[12px] text-text">
                    {row.label}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                  {row.statusMessage && row.status !== "active" && (
                    <p className="mt-1 max-w-[220px] truncate font-mono text-[10px] text-text-tertiary">
                      {row.statusMessage}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-[13px] tabular-nums text-text">
                    {fills.toLocaleString("en-US")}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-[12px] text-text-secondary">
                    {formatRelative(row.lastSyncAt)}
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

function StatusBadge({ status }: { status: ConnectionStatus }) {
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
      {STATUS_LABEL[status]}
    </span>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const delta = Date.now() - then;
  if (delta < 0) return "just now";
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days} d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo ago`;
  const years = Math.floor(months / 12);
  return `${years} yr ago`;
}
