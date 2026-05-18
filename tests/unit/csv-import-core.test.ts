/**
 * Tests for the CSV parser core (RFC 4180 + delimiter detection + table
 * helper). These do not exercise any exchange-specific logic — see the
 * per-exchange test files for that.
 */
import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  parseCsvTable,
  getCell,
} from '@/lib/csv-import/csv-parser';
import {
  parseDecimal,
  decimalMul,
  parseFeeWithCurrency,
  parseExecutedAt,
  deriveStableId,
} from '@/lib/csv-import/shared';

describe('parseCsv', () => {
  it('returns [] on empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('parses simple comma-separated rows with header', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n4,5,6');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ lineNumber: 1, fields: ['a', 'b', 'c'] });
    expect(rows[1]).toEqual({ lineNumber: 2, fields: ['1', '2', '3'] });
    expect(rows[2]).toEqual({ lineNumber: 3, fields: ['4', '5', '6'] });
  });

  it('handles CRLF line endings', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n');
    expect(rows.map((r) => r.fields)).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('respects quoted fields with embedded commas', () => {
    const rows = parseCsv('a,b\n"1,000","hello"\n');
    expect(rows[1].fields).toEqual(['1,000', 'hello']);
  });

  it('un-escapes doubled quotes inside quoted fields', () => {
    const rows = parseCsv('a,b\n"He said ""hi""","ok"\n');
    expect(rows[1].fields).toEqual(['He said "hi"', 'ok']);
  });

  it('preserves newlines inside quoted fields', () => {
    const rows = parseCsv('a,b\n"line1\nline2","x"\n');
    expect(rows[1].fields).toEqual(['line1\nline2', 'x']);
  });

  it('throws on unterminated quoted field', () => {
    expect(() => parseCsv('a,b\n"unfinished\n')).toThrow(/unterminated/);
  });

  it('strips a UTF-8 BOM if present', () => {
    const rows = parseCsv('﻿a,b\n1,2\n');
    expect(rows[0].fields).toEqual(['a', 'b']);
  });

  it('auto-detects tab delimiter', () => {
    const rows = parseCsv('a\tb\tc\n1\t2\t3\n');
    expect(rows.map((r) => r.fields)).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('respects an explicit delimiter override', () => {
    // Semicolon-separated, default would pick comma — verify override works.
    const rows = parseCsv('a;b;c\n1;2;3', { delimiter: ';' });
    expect(rows[1].fields).toEqual(['1', '2', '3']);
  });
});

describe('parseCsvTable', () => {
  it('lowercases header keys for case-insensitive lookup', () => {
    const t = parseCsvTable('Date,Symbol\n2024-09-01,BTCUSDT\n');
    expect(t.headerIndex.get('date')).toBe(0);
    expect(t.headerIndex.get('symbol')).toBe(1);
    expect(getCell(t.rows[0], t.headerIndex, 'Symbol')).toBe('BTCUSDT');
    expect(getCell(t.rows[0], t.headerIndex, 'date')).toBe('2024-09-01');
  });

  it('right-pads short rows', () => {
    const t = parseCsvTable('a,b,c\n1,2\n');
    expect(t.rows[0].values).toEqual(['1', '2', '']);
  });

  it('returns empty when input is empty', () => {
    const t = parseCsvTable('');
    expect(t.headers).toEqual([]);
    expect(t.rows).toEqual([]);
  });
});

describe('parseDecimal', () => {
  it('normalises trailing currency tickers', () => {
    expect(parseDecimal('6.4999 USDT')).toBe('6.4999');
    expect(parseDecimal('1000 USD')).toBe('1000');
  });

  it('strips a leading currency sigil', () => {
    expect(parseDecimal('$1.50')).toBe('1.50');
  });

  it('converts European decimal commas', () => {
    expect(parseDecimal('1,5')).toBe('1.5');
    expect(parseDecimal('1.234,56')).toBe('1234.56');
  });

  it('strips US thousands separators', () => {
    expect(parseDecimal('1,234.56')).toBe('1234.56');
  });

  it('handles negative values', () => {
    expect(parseDecimal('-0.05')).toBe('-0.05');
  });

  it('rejects garbage', () => {
    expect(() => parseDecimal('abc')).toThrow();
    expect(() => parseDecimal('')).toThrow();
  });
});

describe('decimalMul', () => {
  it('multiplies without precision loss', () => {
    expect(decimalMul('0.1', '0.2')).toBe('0.02');
    expect(decimalMul('1000.5', '2')).toBe('2001');
    // Property check: the FLOAT version of 0.1 * 0.2 is 0.020000000000000004.
  });

  it('handles negative operands', () => {
    expect(decimalMul('-1.5', '2')).toBe('-3');
  });

  it('keeps high-precision results', () => {
    expect(decimalMul('123.456789', '987.654321')).toMatch(/^\d+\.\d+$/);
  });
});

describe('parseFeeWithCurrency', () => {
  it('extracts amount and trailing ticker', () => {
    expect(parseFeeWithCurrency('6.4999 USDT')).toEqual({
      amount: '6.4999',
      currency: 'USDT',
    });
  });

  it('handles blank/missing fee gracefully', () => {
    expect(parseFeeWithCurrency('')).toEqual({ amount: '0', currency: '' });
  });

  it('parses bare numeric fee', () => {
    expect(parseFeeWithCurrency('0.05')).toEqual({
      amount: '0.05',
      currency: '',
    });
  });
});

describe('parseExecutedAt', () => {
  it('treats space-separated datetime as UTC', () => {
    expect(parseExecutedAt('2024-09-01 12:34:01')).toBe('2024-09-01T12:34:01.000Z');
  });

  it('parses ISO 8601', () => {
    expect(parseExecutedAt('2024-09-01T12:34:01Z')).toBe('2024-09-01T12:34:01.000Z');
  });

  it('parses unix seconds', () => {
    expect(parseExecutedAt('1725193241')).toBe(new Date(1725193241_000).toISOString());
  });

  it('parses unix millis', () => {
    expect(parseExecutedAt('1725193241000')).toBe(new Date(1725193241_000).toISOString());
  });

  it('rejects garbage', () => {
    expect(() => parseExecutedAt('not-a-date')).toThrow();
  });
});

describe('deriveStableId', () => {
  it('is deterministic on identical inputs', () => {
    const a = deriveStableId('binance', 'spot', ['2024-09-01T12:34:01.000Z', 'BTC-USDT', 'buy', '0.1', '65000']);
    const b = deriveStableId('binance', 'spot', ['2024-09-01T12:34:01.000Z', 'BTC-USDT', 'buy', '0.1', '65000']);
    expect(a).toBe(b);
  });

  it('produces different ids for different inputs', () => {
    const a = deriveStableId('binance', 'spot', ['t', 'BTC', 'buy', '0.1', '65000']);
    const b = deriveStableId('binance', 'spot', ['t', 'BTC', 'sell', '0.1', '65000']);
    expect(a).not.toBe(b);
  });

  it('uses the csv: namespace prefix', () => {
    const id = deriveStableId('binance', 'spot', ['t']);
    expect(id.startsWith('csv:')).toBe(true);
  });
});
