import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { searchHrefFor, type SearchResultItem } from '@/lib/search/types';
import type { ActivityStatus, HeadlineFormat } from '@/types/canonical';
import { getT, getLocale } from '@/lib/i18n/server';

/**
 * One row of search output. Mirrors the visual rhythm of `SpreadListCard`
 * (font-serif title, mono dot/serial, headline metric on the right) so a
 * search result feels native to the rest of the journal.
 *
 * Async server component — pulls localized status + activity labels +
 * relative-time copy through the dictionary; falls back to Intl helpers
 * for time strings.
 */
export async function SearchResultRow({
  item,
  intlLocale,
}: {
  item: SearchResultItem;
  intlLocale?: string;
}) {
  const t = await getT();
  const locale = await getLocale();
  const effectiveIntlLocale = intlLocale ?? (locale === 'ru' ? 'ru-RU' : 'en-US');
  const href = searchHrefFor(item.type, item.id);
  const dotClass = STATUS_DOT[item.status];
  const statusLabel = t(statusKey(item.status));
  const typeLabel = t(typeKey(item.type));
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
            <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
            <span className="uppercase tracking-[0.12em] font-medium">
              {statusLabel}
            </span>
          </span>
          <span className="font-mono text-text-tertiary">·</span>
          <span className="font-mono text-text-tertiary uppercase tracking-[0.14em]">
            {typeLabel}
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
            {item.openedAt ? formatRelative(item.openedAt, effectiveIntlLocale) : '—'}
          </p>
        </div>
      </div>
    </Link>
  );
}

// ─── formatting helpers ───────────────────────────────────────────────────

const STATUS_DOT: Record<ActivityStatus, string> = {
  open:         'bg-up',
  pending:      'bg-warn',
  winding_down: 'bg-warn',
  unwinding:    'bg-warn',
  orphaned:     'bg-down',
  vesting:      'bg-warn',
  claimed:      'bg-text-tertiary',
  liquidated:   'bg-down',
  expired:      'bg-text-tertiary',
  closed:       'bg-text-tertiary',
};

function statusKey(s: ActivityStatus):
  | 'status.open' | 'status.pending' | 'status.winding_down' | 'status.unwinding'
  | 'status.orphaned' | 'status.vesting' | 'status.claimed' | 'status.liquidated'
  | 'status.expired' | 'status.closed' {
  switch (s) {
    case 'open':         return 'status.open';
    case 'pending':      return 'status.pending';
    case 'winding_down': return 'status.winding_down';
    case 'unwinding':    return 'status.unwinding';
    case 'orphaned':     return 'status.orphaned';
    case 'vesting':      return 'status.vesting';
    case 'claimed':      return 'status.claimed';
    case 'liquidated':   return 'status.liquidated';
    case 'expired':      return 'status.expired';
    case 'closed':       return 'status.closed';
  }
}

function typeKey(t: SearchResultItem['type']):
  | 'activity.spread' | 'activity.trade' | 'activity.sale'
  | 'activity.airdrop' | 'activity.yieldPosition' | 'activity.option' {
  switch (t) {
    case 'spread':         return 'activity.spread';
    case 'trade':          return 'activity.trade';
    case 'sale':           return 'activity.sale';
    case 'airdrop':        return 'activity.airdrop';
    case 'yield_position': return 'activity.yieldPosition';
    case 'option':         return 'activity.option';
  }
}

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
 * "3d ago" / "2 мес назад" / "2y ago" via Intl.RelativeTimeFormat so the
 * copy matches the user's resolved locale. Falls back to a localised
 * absolute date once the gap exceeds ~24 months so the row stays legible.
 */
function formatRelative(iso: string, intlLocale: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '—';
  const diffMs = Date.now() - ts;
  if (diffMs < 0)
    return new Date(ts).toLocaleDateString(intlLocale, { month: 'short', day: 'numeric' });

  const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: 'auto', style: 'short' });
  const sec = Math.floor(diffMs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  const mo = Math.floor(day / 30);
  const yr = Math.floor(day / 365);

  if (sec < 60) return rtf.format(-sec, 'second');
  if (min < 60) return rtf.format(-min, 'minute');
  if (hr < 24)  return rtf.format(-hr,  'hour');
  if (day < 30) return rtf.format(-day, 'day');
  if (mo < 12)  return rtf.format(-mo,  'month');
  if (yr < 2)   return rtf.format(-yr,  'year');
  return new Date(ts).toLocaleDateString(intlLocale, { month: 'short', year: 'numeric' });
}
