/**
 * Unit tests for the trade-wizard Zod schema's exchange validation.
 *
 * Two related guarantees are pinned here:
 *   1. Every key in `src/app/add/trade/db.ts EXCHANGE_LABEL_TO_CODE` (the
 *      runtime mapping the wizard hands to the DB layer) is also accepted
 *      by `CreateTradeBody`. If they drift the wizard would 422 on submit
 *      while the form still offers the option — silently broken UX.
 *   2. The Zod schema rejects labels the runtime mapper has never heard of
 *      (e.g. the historical "Coinbase" entry that silently translated to
 *      kraken). This is the bug the v5 cleanup explicitly closed.
 *
 * We can't import `add/trade/db.ts` from a unit test — it ships with
 * `import "server-only"` which throws under `vitest --pool=forks` (the
 * default node env). So we read the file as text and parse the keys from
 * `EXCHANGE_LABEL_TO_CODE` via a tight regex. Same source of truth, no
 * runtime coupling.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CreateTradeBody } from '@/lib/db/zod-schemas';

const DB_TS_PATH = resolve(__dirname, '../../src/app/add/trade/db.ts');

/**
 * Extract the keys of EXCHANGE_LABEL_TO_CODE by scanning the source file.
 * Looks for `Word: "code",` lines inside the declaration block.
 */
function readExchangeLabelKeys(): string[] {
  const src = readFileSync(DB_TS_PATH, 'utf8');
  const blockMatch = src.match(
    /EXCHANGE_LABEL_TO_CODE\s*:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\};/,
  );
  if (!blockMatch) {
    throw new Error(
      `Could not find EXCHANGE_LABEL_TO_CODE in ${DB_TS_PATH}. ` +
        `If the declaration was renamed or restructured, update this test.`,
    );
  }
  const body = blockMatch[1];
  const keyRe = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*"[a-z_]+",?\s*$/gm;
  const keys: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(body)) !== null) {
    keys.push(m[1]);
  }
  if (keys.length === 0) {
    throw new Error(
      `No keys parsed from EXCHANGE_LABEL_TO_CODE block. ` +
        `Check whether the regex needs updating.`,
    );
  }
  return keys;
}

const VALID_TRADE_INPUT = {
  exchange: 'Binance',
  symbol: 'BTC-PERP',
  instrument: 'perp' as const,
  side: 'long' as const,
  capital: '5000',
  qty: '0.1',
  entryPrice: '60000',
  exitPrice: '62000',
  fees: '5',
  openedAt: '2026-05-01T10:00',
  closedAt: '2026-05-02T10:00',
  note: '',
  regimeTags: '' as unknown as string[],
};

describe('CreateTradeBody — exchange field', () => {
  const labels = readExchangeLabelKeys();

  it('reads at least 12 exchange labels from db.ts', () => {
    // Soft floor — if someone deletes a venue the test reminds them to
    // update the Zod schema's TRADE_EXCHANGE_LABELS list too.
    expect(labels.length).toBeGreaterThanOrEqual(12);
  });

  it.each(labels)('accepts %s as a valid exchange label', (label) => {
    const parsed = CreateTradeBody.safeParse({ ...VALID_TRADE_INPUT, exchange: label });
    if (!parsed.success) {
      // Surface the actual error so a sync drift is obvious.
      throw new Error(
        `Expected "${label}" to parse, got error: ${JSON.stringify(parsed.error.issues)}`,
      );
    }
    expect(parsed.success).toBe(true);
  });

  it('rejects historical "Coinbase" label (mapped silently to kraken in v4)', () => {
    const parsed = CreateTradeBody.safeParse({
      ...VALID_TRADE_INPUT,
      exchange: 'Coinbase',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an unknown label', () => {
    const parsed = CreateTradeBody.safeParse({
      ...VALID_TRADE_INPUT,
      exchange: 'TotallyMadeUp',
    });
    expect(parsed.success).toBe(false);
  });
});
