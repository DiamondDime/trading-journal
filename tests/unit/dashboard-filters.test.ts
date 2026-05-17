/**
 * Unit tests for the dashboard filter URL contract and the KPI hero font
 * scaler. Both are pure functions exercised by the page render — covering
 * them here keeps a regression in the filter codec or the font-tier math
 * from silently shipping.
 */
import { describe, it, expect } from 'vitest';
import {
  parseDashboardSearchParams,
  serializeDashboardSearchParams,
  buildDashboardFilters,
  resolveDateRange,
  heatmapWeeks,
  isAllDefaults,
} from '@/lib/dashboard/filters';
import { heroFontSize } from '@/components/spread/kpi-card';

describe('parseDashboardSearchParams', () => {
  it('returns defaults for an empty object', () => {
    expect(parseDashboardSearchParams({})).toEqual({
      range: 'all',
      from: undefined,
      to: undefined,
      types: [],
      minCapital: 0,
      heatmap: '13w',
    });
  });

  it('parses preset ranges', () => {
    expect(parseDashboardSearchParams({ range: '30d' }).range).toBe('30d');
    expect(parseDashboardSearchParams({ range: 'ytd' }).range).toBe('ytd');
    expect(parseDashboardSearchParams({ range: 'all' }).range).toBe('all');
  });

  it('falls back to "all" for unknown range values', () => {
    expect(parseDashboardSearchParams({ range: 'lol' }).range).toBe('all');
  });

  it('parses comma-separated activity types and filters unknowns', () => {
    const p = parseDashboardSearchParams({ types: 'spread,trade,gobbledygook' });
    expect(p.types).toEqual(['spread', 'trade']);
  });

  it('parses minCap as a non-negative number', () => {
    expect(parseDashboardSearchParams({ minCap: '500' }).minCapital).toBe(500);
    expect(parseDashboardSearchParams({ minCap: '-1' }).minCapital).toBe(0);
    expect(parseDashboardSearchParams({ minCap: 'NaN' }).minCapital).toBe(0);
  });

  it('parses heatmap window with fallback', () => {
    expect(parseDashboardSearchParams({ heatmap: '26w' }).heatmap).toBe('26w');
    expect(parseDashboardSearchParams({ heatmap: '99w' }).heatmap).toBe('13w');
  });

  it('parses custom range dates as YYYY-MM-DD only', () => {
    const p = parseDashboardSearchParams({
      range: 'custom',
      from: '2026-01-01',
      to: '2026-05-17',
    });
    expect(p.range).toBe('custom');
    expect(p.from).toBe('2026-01-01');
    expect(p.to).toBe('2026-05-17');
  });

  it('rejects malformed dates', () => {
    expect(
      parseDashboardSearchParams({ range: 'custom', from: 'yesterday' }).from,
    ).toBeUndefined();
  });
});

describe('serializeDashboardSearchParams', () => {
  it('omits defaults', () => {
    const p = parseDashboardSearchParams({});
    expect(serializeDashboardSearchParams(p).toString()).toBe('');
  });

  it('round-trips through parse', () => {
    const sp = parseDashboardSearchParams({
      range: '90d',
      types: 'spread,airdrop',
      minCap: '500',
      heatmap: '52w',
    });
    const serialized = serializeDashboardSearchParams(sp).toString();
    const reparsed = parseDashboardSearchParams(
      Object.fromEntries(new URLSearchParams(serialized).entries()),
    );
    expect(reparsed).toEqual(sp);
  });

  it('emits from/to only when range is custom', () => {
    const p = parseDashboardSearchParams({
      range: '30d',
      from: '2026-01-01',
      to: '2026-02-01',
    });
    const s = serializeDashboardSearchParams(p).toString();
    expect(s).toContain('range=30d');
    expect(s).not.toContain('from=');
    expect(s).not.toContain('to=');
  });
});

describe('resolveDateRange', () => {
  const today = new Date(2026, 4, 17); // 2026-05-17 local

  it('returns nulls for "all"', () => {
    const p = parseDashboardSearchParams({});
    expect(resolveDateRange(p, today)).toEqual({ from: null, to: null });
  });

  it('computes 7-day window inclusive', () => {
    const p = parseDashboardSearchParams({ range: '7d' });
    const r = resolveDateRange(p, today);
    expect(r.to).toBe('2026-05-17');
    expect(r.from).toBe('2026-05-11');
  });

  it('computes YTD window', () => {
    const p = parseDashboardSearchParams({ range: 'ytd' });
    const r = resolveDateRange(p, today);
    expect(r.from).toBe('2026-01-01');
    expect(r.to).toBe('2026-05-17');
  });
});

describe('buildDashboardFilters', () => {
  const today = new Date(2026, 4, 17);

  it('produces an empty filter for defaults', () => {
    const p = parseDashboardSearchParams({});
    expect(buildDashboardFilters(p, today)).toEqual({});
  });

  it('produces type + capital filters', () => {
    const p = parseDashboardSearchParams({
      types: 'spread',
      minCap: '5000',
    });
    expect(buildDashboardFilters(p, today)).toEqual({
      type: ['spread'],
      minCapital: 5000,
    });
  });

  it('encodes date boundaries with the end-of-day suffix', () => {
    const p = parseDashboardSearchParams({ range: '30d' });
    const f = buildDashboardFilters(p, today);
    expect(f.closedAfter).toMatch(/^2026-04-18T00:00:00$/);
    expect(f.closedBefore).toMatch(/^2026-05-17T23:59:59.999$/);
  });
});

describe('heatmapWeeks', () => {
  it('maps the three window keys to week counts', () => {
    expect(heatmapWeeks('13w')).toBe(13);
    expect(heatmapWeeks('26w')).toBe(26);
    expect(heatmapWeeks('52w')).toBe(52);
  });
});

describe('isAllDefaults', () => {
  it('detects defaults', () => {
    expect(isAllDefaults(parseDashboardSearchParams({}))).toBe(true);
  });
  it('detects any non-default field', () => {
    expect(isAllDefaults(parseDashboardSearchParams({ range: '7d' }))).toBe(false);
    expect(isAllDefaults(parseDashboardSearchParams({ heatmap: '52w' }))).toBe(
      false,
    );
  });
});

describe('heroFontSize boundary cases', () => {
  // Coverage of every test case in the brief. Each tier corresponds to a
  // character-count range; the assertions hard-code the resulting clamp
  // expression so future tuning trips a test rather than silently shipping.
  it('handles the smallest values (≤5 chars)', () => {
    expect(heroFontSize('$0.00')).toBe('clamp(36px, 4.6vw, 56px)'); // 5 chars
    expect(heroFontSize('$1.23')).toBe('clamp(36px, 4.6vw, 56px)'); // 5 chars
  });

  it('drops one tier for 6-7 char values', () => {
    expect(heroFontSize('+$1.23')).toBe('clamp(32px, 4vw, 48px)'); // 6
    expect(heroFontSize('+$10.00')).toBe('clamp(32px, 4vw, 48px)'); // 7
    expect(heroFontSize('+$1,234')).toBe('clamp(32px, 4vw, 48px)'); // 7
  });

  it('drops to medium for 8–10 char values', () => {
    expect(heroFontSize('+$100.00')).toBe('clamp(26px, 3.2vw, 36px)'); // 8
    expect(heroFontSize('+$1,234.56')).toBe('clamp(26px, 3.2vw, 36px)'); // 10
  });

  it('drops to small for 11–13 char values', () => {
    expect(heroFontSize('+$12,345.67')).toBe('clamp(22px, 2.6vw, 30px)'); // 11
    expect(heroFontSize('+$123,456.78')).toBe('clamp(22px, 2.6vw, 30px)'); // 12
    expect(heroFontSize('+$1,234,567')).toBe('clamp(22px, 2.6vw, 30px)'); // 11
  });

  it('drops to smallest for very long values', () => {
    expect(heroFontSize('+$1,234,567.89')).toBe('clamp(20px, 2.2vw, 26px)'); // 14
    expect(heroFontSize('+$12,345,678.90')).toBe('clamp(20px, 2.2vw, 26px)'); // 15
    expect(heroFontSize('−$1,234,567.89')).toBe('clamp(20px, 2.2vw, 26px)'); // 14
  });

  it('always returns a clamp() expression so it scales with viewport', () => {
    for (const v of [
      '$0.00',
      '+$1.23',
      '+$1,234.56',
      '+$12,345.67',
      '+$1,234,567.89',
      '+$12,345,678.90',
    ]) {
      expect(heroFontSize(v)).toMatch(/^clamp\(/);
    }
  });
});
