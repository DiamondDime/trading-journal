import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { searchHrefFor, type SearchResultItem } from '@/lib/search/types';
import type { ActivityStatus, HeadlineFormat } from '@/types/canonical';

/**
 * One row of search output. Mirrors the visual rhythm of `SpreadListCard`
 * (font-serif title, mono dot/serial, headline metric on the right) so a
 * search result feels native to the rest of the journal.
 *
 * Server component — no client features needed. Headlines and time labels
 * are formatted here once and shipped as plain text.
 */
export function SearchResultRow({
  item,
  intlLocale = 'en-US',
}: {
  item: SearchResultItem;
  intlLocale?: string;
}) {
  const href = searchHrefFor(item.type, item.id);
  const status = STATUS_STYLES[item.status];
  const tone = headlineTone(item.headlineValue, item.headlineFormat);

  return (
    <Link
      href={href}
      className={cn(
        'group flex items-stretch gap-4 rounded-md border bg-surface p-4 transition-all',
        'hover:bg-subtle hover:border-border-strong',
        item.status === 'orphaned' ? 'border-down/30' : 'border-border',
      )}
    >
      <div className="flex flex-1 flex-col gap-2 min-w-0">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-text-tertiary">
            <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
            <span className="uppercase tracking-[0.12em] font-medium">
              {status.label}
            </span>
          </span>
          <span className="font-mono text-text-tertiary">·</span>
          <span className="font-mono text-text-tertiary uppercase tracking-[0.14em]">
            {TYPE_LABEL[item.type]}
          </span>
        </div>

        <h3 className="font-serif text-[15px] font-medium leading-tight text-text truncate">
          {item.title}
        </h3>

        <p className="flex items-center gap-2 text-[11px] text-text-tertiary">
          {item.primarySymbol && (
            <span className="font-mono uppercase tracking-[0.1em] text-text-secondary">
              {item.primarySymbol}
            </span>
          )}
          {item.primarySymbol && item.subtitle && (
            <span className="font-mono text-text-tertiary">·</span>
          )}
          {item.subtitle && <span className="truncate">{item.subtitle}</span>}
        </p>
      </div>

      <div className="flex flex-col items-end justify-between gap-1">
        <ArrowUpRight className="h-3.5 w-3.5 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="text-right">
          <p
            className={cn(
              'font-serif text-[20px] leading-none tabular-nums',
              tone === 'up'
                ? 'text-up'
                : tone === 'down'
                ? 'text-down'
                : 'text-text',
            )}
          >
            {formatHeadline(item.headlineValue, item.headlineFormat)}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {item.openedAt ? formatRelative(item.openedAt, intlLocale) : '—'}
          </p>
        </div>
      </div>
    </Link>
  );
}

// ─── formatting helpers ───────────────────────────────────────────────────

const STATUS_STYLES: Record<ActivityStatus, { dot: string; label: string }> = {
  open:         { dot: 'bg-up',            label: 'Open' },
  pending:      { dot: 'bg-warn',          label: 'Pending' },
  winding_down: { dot: 'bg-warn',          label: 'Winding down' },
  unwinding:    { dot: 'bg-warn',          label: 'Unwinding' },
  orphaned:     { dot: 'bg-down',          label: 'Orphaned' },
  vesting:      { dot: 'bg-warn',          label: 'Vesting' },
  claimed:      { dot: 'bg-text-tertiary', label: 'Claimed' },
  liquidated:   { dot: 'bg-down',          label: 'Liquidated' },
  expired:      { dot: 'bg-text-tertiary', label: 'Expired' },
  closed:       { dot: 'bg-text-tertiary', label: 'Closed' },
};

const TYPE_LABEL: Record<SearchResultItem['type'], string> = {
  spread:         'Spread',
  trade:          'Trade',
  sale:           'Sale',
  airdrop:        'Airdrop',
  yield_position: 'Yield',
  option:         'Option',
};

/**
 * Render the headline metric per HeadlineFormat. Mirrors the rules in
 * `v_activity_feed` (apr_pct/apy_pct as %, mtm_x as multiplier, usd in
 * signed dollars, bps as basis points).
 */
function formatHeadline(value: string | null, format: HeadlineFormat): string {
  if (value == null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  switch (format) {
    case 'apr_pct':
    case 'apy_pct': {
      const pct = n * 100;
      return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
    }
    case 'mtm_x':
      return `${n.toFixed(2)}×`;
    case 'usd': {
      const sign = n >= 0 ? '+$' : '−$';
      return `${sign}${Math.abs(n).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    case 'bps':
      return `${Math.round(n)} bps`;
  }
}

function headlineTone(
  value: string | null,
  format: HeadlineFormat,
): 'up' | 'down' | 'neutral' {
  if (value == null) return 'neutral';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'neutral';
  if (format === 'mtm_x') {
    if (n > 1) return 'up';
    if (n < 1) return 'down';
    return 'neutral';
  }
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'neutral';
}

/**
 * "3d ago" / "2mo ago" — short, mono-friendly. Falls back to a localised
 * date if older than ~12 months so the row stays legible.
 */
function formatRelative(iso: string, intlLocale: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '—';
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return new Date(ts).toLocaleDateString(intlLocale, { month: 'short', day: 'numeric' });

  const sec = Math.floor(diffMs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  const mo = Math.floor(day / 30);
  const yr = Math.floor(day / 365);

  if (sec < 60) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (hr < 24)  return `${hr}h ago`;
  if (day < 30) return `${day}d ago`;
  if (mo < 12)  return `${mo}mo ago`;
  if (yr < 2)   return `${yr}y ago`;
  return new Date(ts).toLocaleDateString(intlLocale, { month: 'short', year: 'numeric' });
}
