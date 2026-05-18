/**
 * Shared helpers for every CSV parser.
 *
 * Decimal handling is intentionally string-only. We never reach for
 * `decimal.js` here — Postgres parses our string literal into `numeric` on
 * insert, which is the only conversion that matters. Doing math in JS at
 * import time would risk precision loss before the data even hits the wall.
 */
import { createHash } from 'node:crypto';
import { CsvParseError } from './normalized';

/**
 * Normalise a string-formatted decimal:
 *   • Trim whitespace
 *   • Strip currency symbols ($, €, etc.)
 *   • Strip thousands separators (commas) but only when followed by 3 digits
 *     so that European decimal commas survive ("1,5" → "1.5")
 *   • Coerce European decimal comma to a period
 *
 * Throws when the input is not a number-shaped string.
 */
export function parseDecimal(raw: string): string {
  if (raw == null) throw new CsvParseError('Decimal value is missing');
  let s = raw.trim();
  if (!s) throw new CsvParseError('Decimal value is empty');

  // Strip a leading currency sigil if present.
  s = s.replace(/^[$€£¥₩₽]\s*/, '');
  // Remove a trailing currency ticker — covers fields like "6.4999 USDT".
  s = s.replace(/\s+[A-Z]{2,5}$/, '');

  // Detect European format "1.234,56" — period as thousands, comma as decimal.
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && !hasDot) {
    // "1,5" → "1.5"; "1,234" is ambiguous but treat as decimal because
    // exchange exports rarely thousand-separate without a decimal.
    s = s.replace(',', '.');
  } else if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // European: "1.234,56" — strip dots, swap comma.
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // US: "1,234.56" — strip commas.
      s = s.replace(/,/g, '');
    }
  }
  // Strip remaining stray spaces.
  s = s.replace(/\s+/g, '');

  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new CsvParseError(`Not a decimal: "${raw}"`);
  }
  return s;
}

/**
 * Multiply two string-formatted decimals. We avoid floats: convert to
 * BigInt under a shared exponent, then re-emit.
 */
export function decimalMul(a: string, b: string): string {
  const [aInt, aDecLen] = splitDecimal(a);
  const [bInt, bDecLen] = splitDecimal(b);
  const product = aInt * bInt;
  const totalDec = aDecLen + bDecLen;
  return formatScaled(product, totalDec);
}

function splitDecimal(s: string): [bigint, number] {
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [intPart, decPart = ''] = body.split('.');
  const big = BigInt((intPart || '0') + decPart);
  return [neg ? -big : big, decPart.length];
}

function formatScaled(n: bigint, decLen: number): string {
  if (decLen === 0) return n.toString();
  const neg = n < BigInt(0);
  const abs = neg ? -n : n;
  const str = abs.toString().padStart(decLen + 1, '0');
  const intPart = str.slice(0, str.length - decLen);
  const decPart = str.slice(str.length - decLen).replace(/0+$/, '');
  const out = decPart ? `${intPart}.${decPart}` : intPart;
  return neg ? `-${out}` : out;
}

/**
 * Parse a fee string of the form "6.4999 USDT" or just "6.4999". Returns
 * the amount as a normalised decimal string and (if present) the currency
 * ticker. Missing/blank input → { amount: '0', currency: '' }.
 */
export function parseFeeWithCurrency(raw: string): { amount: string; currency: string } {
  if (!raw || !raw.trim()) return { amount: '0', currency: '' };
  const trimmed = raw.trim();
  // Detect "<number> <currency>" pattern, currency at end of string.
  const m = /^([0-9.,\-]+)\s*([A-Za-z]{2,12})?$/.exec(trimmed);
  if (m) {
    const amount = parseDecimal(m[1]);
    return { amount, currency: (m[2] ?? '').toUpperCase() };
  }
  // Some exporters put currency before the number ("USDT 6.4999")
  const m2 = /^([A-Za-z]{2,12})\s+([0-9.,\-]+)$/.exec(trimmed);
  if (m2) {
    return { amount: parseDecimal(m2[2]), currency: m2[1].toUpperCase() };
  }
  return { amount: parseDecimal(trimmed), currency: '' };
}

/**
 * Parse a date string into a UTC ISO 8601 string ("2024-09-01T12:34:01.000Z").
 *
 * Accepted shapes:
 *   • ISO 8601 with timezone: "2024-09-01T12:34:01Z" / "...+00:00"
 *   • Date-time with space:    "2024-09-01 12:34:01"  (assumed UTC)
 *   • Date-only:               "2024-09-01"          (00:00:00 UTC)
 *   • Unix seconds:            "1725193241"          (10 digits)
 *   • Unix millis:             "1725193241000"       (13 digits)
 */
export function parseExecutedAt(raw: string): string {
  if (!raw) throw new CsvParseError('Date value is missing');
  const trimmed = raw.trim();

  if (/^\d{13}$/.test(trimmed)) {
    return new Date(Number(trimmed)).toISOString();
  }
  if (/^\d{10}(\.\d+)?$/.test(trimmed)) {
    // Kraken and many others emit fractional unix seconds. Number() handles
    // the decimal; multiply by 1000 to get millis.
    return new Date(Math.round(Number(trimmed) * 1000)).toISOString();
  }

  // Treat a bare "YYYY-MM-DD HH:MM:SS" as UTC by replacing the space with a T
  // and tagging Z. Without this, V8 interprets it in the server's local tz.
  let candidate = trimmed;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(candidate)) {
    candidate = candidate.replace(' ', 'T') + 'Z';
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    candidate = `${candidate}T00:00:00Z`;
  }

  const d = new Date(candidate);
  if (Number.isNaN(d.getTime())) {
    throw new CsvParseError(`Unparseable date "${raw}"`);
  }
  return d.toISOString();
}

/**
 * Derive a stable id from an arbitrary tuple of fields. Used by parsers
 * whose source CSV doesn't carry a stable trade id. Same inputs → same
 * id, so a re-import of the same file dedups via uq_fill_idempotency.
 *
 * NOTE: We prefix with `csv:` so these synthetic ids can never collide with
 * native exchange ids (which are numeric or hex). That namespace separation
 * lets the worker tell at a glance which fills came from manual imports.
 */
export function deriveStableId(
  exchange: string,
  scope: string,
  parts: readonly string[],
): string {
  const hash = createHash('sha256');
  hash.update([exchange, scope, ...parts].join('|'));
  return `csv:${exchange}:${scope}:${hash.digest('hex').slice(0, 24)}`;
}

/** Copy header→value into a plain object for `raw_payload` storage. */
export function buildPayload(headers: string[], values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    out[headers[i]] = values[i] ?? '';
  }
  return out;
}
