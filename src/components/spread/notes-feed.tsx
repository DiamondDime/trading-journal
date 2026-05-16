import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

const NOTES: { date: string; serial: string; spread: string; body: string }[] = [
  {
    date: "Mar 28",
    serial: "#032",
    spread: "BTC cash-carry",
    body: "\"Funding dropped below 10% for 4 ticks. Net 14% realized — slight miss of target. Next time: trigger at 12%, not 10%.\"",
  },
  {
    date: "Mar 22",
    serial: "#031",
    spread: "BTC calendar",
    body: "\"Sep-Dec on Deribit captured the contango widening beautifully. 5.0 bps/day average · total 152 bps over 32 days · solid setup.\"",
  },
  {
    date: "Mar 14",
    serial: "#029",
    spread: "BTC perp arb",
    body: "\"Binance-Bybit BTC perp arb · 47 min hold · 11.6 bps gross, 4 bps net after fees. Window was wider than usual at NY open.\"",
  },
  {
    date: "Mar 12",
    serial: "#028",
    spread: "ETH funding",
    body: "\"Closed funding capture — ETH on Bybit. Rate decay forced exit at day 19. APR ended at 11.3%, target was 13.7%.\"",
  },
  {
    date: "Mar 1",
    serial: "#027",
    spread: "PEPE DEX-CEX",
    body: "\"Opened DEX-CEX on PEPE · wide spread (94 bps) but gas was higher than expected. Mempool fee 2× budget at exit — keep an eye.\"",
  },
];

export function NotesFeed() {
  return (
    <div className="h-full rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
          Recent notes
        </h3>
        <Link
          href="#"
          className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary hover:text-text"
        >
          47 total <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="divide-y divide-border-subtle">
        {NOTES.map((n) => (
          <Link
            key={n.serial + n.date}
            href="/spreads/demo"
            className="block px-4 py-3 transition-colors hover:bg-subtle"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                {n.date}
              </span>
              <span className="font-mono text-[10px] text-text-tertiary">·</span>
              <span className="font-mono text-[10px] text-signature">
                {n.serial}
              </span>
              <span className="font-mono text-[10px] text-text-tertiary">·</span>
              <span className="text-[11px] text-text-secondary">
                {n.spread}
              </span>
            </div>
            <p className="font-serif text-[13px] italic leading-snug text-text line-clamp-2">
              {n.body}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
