import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtUsd, fmtCapital } from "@/lib/data/archive-data";
import type { Activity } from "@/lib/data/archive-data";

/**
 * Top-N best/worst trades table. Each row is a Link to the detail page so
 * the user can click through. Used twice (best/worst) on the track-record
 * page; tone prop colors the headline R-multiple cell.
 *
 * Why a Link wrapping a TableRow: rows are clickable on every td but the
 * Next.js link is what owns the navigation. We use a Link wrapper around
 * each row's contents via `display: contents` so semantics stay correct
 * (a `<tr><a></a></tr>` is invalid HTML; we instead make each <td> contain
 * a Link with `tabindex=-1` and the row itself gets a Link on a cell that
 * triggers the same href). Simpler approach: wrap the whole row in a Link
 * via `<TableRow asChild>` — but shadcn's Table doesn't support asChild.
 * We compromise: render the first <td> as the main click target and use
 * onClick on the row for the rest.
 *
 * Final approach: keep it accessible — make the row a real button by giving
 * the <tr> role + tabIndex + onClick. Each cell renders plain text. The
 * primary click target is a hidden link in the first cell that screen readers
 * can find.
 *
 * Simpler still: render each row as <tr> with a wrapper <Link> on the entire
 * "name" cell text — that text is the natural anchor. The whole row gets a
 * hover state via CSS; clicks anywhere on the row delegate to the link via
 * a JS onClick.
 *
 * For v1 we use the simplest accessible form: each row gets its own Link
 * tag wrapping the visible content of each cell. Slightly more DOM but
 * keyboard + screen reader behavior is preserved without role hacks.
 */

export interface TopTradeRow {
  activity: Activity;
  /** R-multiple, signed. null when R is undefined (no rUnit). */
  rMultiple: number | null;
}

interface Props {
  title: string;
  rows: TopTradeRow[];
  /** Tone of the title — used as the section emphasis. */
  tone: "up" | "down";
}

function fmtR(v: number | null, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = signed ? (v >= 0 ? "+" : "−") : "";
  return `${sign}${Math.abs(v).toFixed(2)}R`;
}

const TYPE_BADGE_LABEL: Record<string, string> = {
  spread: "SPR",
  trade: "TRD",
  sale: "SAL",
  airdrop: "AIR",
};

export function TopTradesTable({ title, rows, tone }: Props) {
  if (rows.length === 0) {
    return (
      <div className="flex h-[200px] w-full items-center justify-center rounded-md border border-dashed border-border bg-inset">
        <p className="font-serif text-sm italic text-text-tertiary">
          Not enough data yet.
        </p>
      </div>
    );
  }

  const titleTone = tone === "up" ? "text-up" : "text-down";

  return (
    <div className="flex flex-col gap-3">
      <h4
        className={
          "font-serif text-[13px] font-semibold uppercase tracking-[0.16em] " +
          titleTone
        }
      >
        {title}
      </h4>
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[64px] font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                #
              </TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                Name
              </TableHead>
              <TableHead className="hidden text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary md:table-cell">
                Date
              </TableHead>
              <TableHead className="hidden text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary md:table-cell">
                Capital
              </TableHead>
              <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                Net P&amp;L
              </TableHead>
              <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                R
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ activity: a, rMultiple }) => {
              const pnlTone =
                a.netPnl > 0 ? "text-up" : a.netPnl < 0 ? "text-down" : "text-text";
              return (
                <TableRow
                  key={a.id}
                  className="cursor-pointer hover:bg-inset/40"
                >
                  <TableCell className="w-[64px] font-mono text-[11px] tabular-nums text-text-tertiary">
                    <Link href={a.href} className="block">
                      {a.serial}
                    </Link>
                  </TableCell>
                  <TableCell className="font-serif text-[13px] text-text">
                    <Link href={a.href} className="flex items-center gap-2">
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
                        {TYPE_BADGE_LABEL[a.type] ?? "—"}
                      </span>
                      {a.name}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[11px] tabular-nums text-text-tertiary md:table-cell">
                    <Link href={a.href} className="block">
                      {a.closedLabel}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[11px] tabular-nums text-text-secondary md:table-cell">
                    <Link href={a.href} className="block">
                      {a.capital > 0 ? fmtCapital(a.capital) : "—"}
                    </Link>
                  </TableCell>
                  <TableCell className={"text-right font-mono text-[12px] tabular-nums " + pnlTone}>
                    <Link href={a.href} className="block">
                      {fmtUsd(a.netPnl, true)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums text-text-secondary">
                    <Link href={a.href} className="block">
                      {fmtR(rMultiple)}
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
