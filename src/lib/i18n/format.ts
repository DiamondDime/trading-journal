import type { Locale } from './types';

/**
 * Locale-aware formatters built on Intl.* primitives. Russian gets
 * `1 234,56` thousands grouping and comma decimals; English keeps
 * `1,234.56`. Currency formatter prepends `$` in EN and appends `$` in
 * RU per locale convention.
 *
 * Note: many existing components use `formatUsd` and `Number.toFixed`
 * directly. We don't replace those wholesale — only the dashboard KPIs,
 * analytics tables, and any newly-translated surface adopt the
 * locale-aware variants. This keeps the i18n turn surgical.
 */

function intlLocale(locale: Locale): string {
  return locale === 'ru' ? 'ru-RU' : 'en-US';
}

export function fmtCurrency(
  value: number,
  locale: Locale,
  opts: { compact?: boolean; minFractionDigits?: number; maxFractionDigits?: number } = {},
): string {
  const fmt = new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency: 'USD',
    notation: opts.compact ? 'compact' : 'standard',
    minimumFractionDigits: opts.minFractionDigits ?? 2,
    maximumFractionDigits: opts.maxFractionDigits ?? 2,
  });
  return fmt.format(value);
}

export function fmtNumber(
  value: number,
  locale: Locale,
  opts: { minFractionDigits?: number; maxFractionDigits?: number; compact?: boolean } = {},
): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    notation: opts.compact ? 'compact' : 'standard',
    minimumFractionDigits: opts.minFractionDigits ?? 0,
    maximumFractionDigits: opts.maxFractionDigits ?? 2,
  }).format(value);
}

export function fmtPercent(value: number, locale: Locale, fractionDigits = 1): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function fmtDate(
  value: Date | string,
  locale: Locale,
  style: 'short' | 'medium' | 'long' = 'medium',
): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: style,
  }).format(d);
}

export function fmtDateTime(value: Date | string, locale: Locale): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export function fmtMonth(value: Date | string, locale: Locale): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export function fmtRelativeDays(days: number, locale: Locale): string {
  return new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' }).format(
    -days,
    'day',
  );
}
