import { Plug } from "lucide-react";

import { AddExchangeDialog } from "@/components/settings/add-exchange-dialog";
import type { CatalogEntry } from "@/components/settings/exchange-types";

interface Props {
  catalog: CatalogEntry[];
}

export function EmptyExchanges({ catalog }: Props) {
  return (
    <div className="rounded-md border border-border bg-surface px-10 py-14 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-border bg-inset">
        <Plug className="h-4 w-4 text-text-tertiary" />
      </div>

      <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
        No connections
      </p>
      <h3 className="mt-3 font-serif text-[28px] font-medium leading-tight tracking-tight text-text">
        No exchanges connected yet.
      </h3>
      <p className="mx-auto mt-3 max-w-md font-serif text-[14px] italic leading-snug text-text-secondary">
        Connect your first to auto-import fills. We support Binance, Bybit, and
        Hyperliquid out of the gate.
      </p>

      <div className="mt-6 flex justify-center">
        <AddExchangeDialog catalog={catalog} variant="primary" />
      </div>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        Read-only keys only · withdraw scope rejected at connect
      </p>
    </div>
  );
}
