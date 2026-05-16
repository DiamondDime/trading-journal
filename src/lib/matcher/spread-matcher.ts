// Demo-grade spread matcher.
//
// Purpose: given a list of imported fills, group them into suggested spreads
// for the wizard's unified picker. **This is not the production matcher** —
// the real one ships with the Python worker (Phase 5) and operates over the
// `position`/`fill` tables with confidence scoring tuned to live data.
//
// The five rules here mirror the v1 product's spread types (cash-carry,
// cross-exchange, funding capture, calendar, dex-cex). Each rule is a pure
// function that yields candidate suggestions; the orchestrator dedupes by
// leg-id set and sorts by score.
//
// Scoring is deliberately simple: 100 − |Δqty %| − |Δclose hours|. Higher is
// better. We expose `score` mostly so the picker can sort suggestions; in
// production the worker will produce a calibrated confidence percentage.

import type { ImportedTradeFill } from "@/lib/data/exchange-fills-mock";

export type MatcherSpreadType =
  | "cash_carry"
  | "cross_exchange"
  | "funding"
  | "calendar"
  | "dex_cex";

export interface MatcherSuggestion {
  /** Deterministic id derived from the leg ids — stable across calls. */
  id: string;
  legs: ImportedTradeFill[];
  spreadType: MatcherSpreadType;
  /** Human-readable rationale shown in the picker card. */
  rationale: string;
  /** 0–100. Higher = better. Used for sort order. */
  score: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const MS_PER_HOUR = 1000 * 60 * 60;

function hoursBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / MS_PER_HOUR;
}

function qtyDeltaPct(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (denom === 0) return 100;
  return Math.abs(a - b) / denom * 100;
}

function score(qtyA: number, qtyB: number, closeHoursDelta: number): number {
  const s = 100 - qtyDeltaPct(qtyA, qtyB) - closeHoursDelta;
  return Math.max(0, Math.round(s * 10) / 10);
}

function legsKey(legs: ImportedTradeFill[]): string {
  return legs
    .map((l) => l.id)
    .slice()
    .sort()
    .join("+");
}

// Each rule emits raw candidates; the orchestrator dedupes and orders. We
// dedupe on `legsKey` (sorted leg-id set) so a cross-exchange match isn't
// re-reported as a DEX-CEX one when both rules happen to fire.
function dedupe(suggestions: MatcherSuggestion[]): MatcherSuggestion[] {
  const seen = new Map<string, MatcherSuggestion>();
  for (const s of suggestions) {
    const key = legsKey(s.legs);
    const existing = seen.get(key);
    if (!existing || s.score > existing.score) {
      seen.set(key, s);
    }
  }
  return [...seen.values()];
}

// ── Rule 1 · Cash-and-carry ──────────────────────────────────────────────────
// Same asset · one spot-long + one perp-short OR future-short · DIFFERENT
// venues · close-times within 24h.
function ruleCashAndCarry(fills: ImportedTradeFill[]): MatcherSuggestion[] {
  const out: MatcherSuggestion[] = [];
  for (let i = 0; i < fills.length; i++) {
    for (let j = i + 1; j < fills.length; j++) {
      const a = fills[i];
      const b = fills[j];
      if (a.asset !== b.asset) continue;
      if (a.exchange === b.exchange) continue;
      // pairs across cex+dex are surfaced by ruleDexCex, not here
      if (a.venueKind !== b.venueKind) continue;

      // Identify the spot-long leg and the short-derivative leg.
      const longSpot =
        a.instrument === "spot" && a.side === "long"
          ? a
          : b.instrument === "spot" && b.side === "long"
          ? b
          : null;
      const shortDeriv =
        (a.instrument === "perp" || a.instrument === "future") && a.side === "short"
          ? a
          : (b.instrument === "perp" || b.instrument === "future") && b.side === "short"
          ? b
          : null;
      if (!longSpot || !shortDeriv || longSpot.id === shortDeriv.id) continue;

      const dCloseH = hoursBetween(longSpot.closedAt, shortDeriv.closedAt);
      if (dCloseH > 24) continue;

      const legs = [longSpot, shortDeriv];
      out.push({
        id: `cc:${legsKey(legs)}`,
        legs,
        spreadType: "cash_carry",
        rationale: `Matched on: ${a.asset} · spot-long + ${shortDeriv.instrument}-short · close times within ${dCloseH.toFixed(1)}h · |Δqty| ${qtyDeltaPct(longSpot.qty, shortDeriv.qty).toFixed(1)}%`,
        score: score(longSpot.qty, shortDeriv.qty, dCloseH),
      });
    }
  }
  return out;
}

// ── Rule 2 · Cross-exchange ──────────────────────────────────────────────────
// Same asset · same instrument · opposite sides · DIFFERENT venues ·
// close-times within 4h.
function ruleCrossExchange(fills: ImportedTradeFill[]): MatcherSuggestion[] {
  const out: MatcherSuggestion[] = [];
  for (let i = 0; i < fills.length; i++) {
    for (let j = i + 1; j < fills.length; j++) {
      const a = fills[i];
      const b = fills[j];
      if (a.asset !== b.asset) continue;
      if (a.instrument !== b.instrument) continue;
      if (a.side === b.side) continue;
      if (a.exchange === b.exchange) continue;

      const dCloseH = hoursBetween(a.closedAt, b.closedAt);
      if (dCloseH > 4) continue;

      const legs = [a, b];
      out.push({
        id: `xe:${legsKey(legs)}`,
        legs,
        spreadType: "cross_exchange",
        rationale: `Matched on: ${a.asset} ${a.instrument} · ${a.exchange} ${a.side} vs ${b.exchange} ${b.side} · close times within ${dCloseH.toFixed(1)}h · |Δqty| ${qtyDeltaPct(a.qty, b.qty).toFixed(1)}%`,
        score: score(a.qty, b.qty, dCloseH),
      });
    }
  }
  return out;
}

// ── Rule 3 · Funding capture (same venue) ────────────────────────────────────
// Same asset · spot-long + perp-short · SAME venue · open dates within 24h.
function ruleFundingCapture(fills: ImportedTradeFill[]): MatcherSuggestion[] {
  const out: MatcherSuggestion[] = [];
  for (let i = 0; i < fills.length; i++) {
    for (let j = i + 1; j < fills.length; j++) {
      const a = fills[i];
      const b = fills[j];
      if (a.asset !== b.asset) continue;
      if (a.exchange !== b.exchange) continue;

      const longSpot =
        a.instrument === "spot" && a.side === "long"
          ? a
          : b.instrument === "spot" && b.side === "long"
          ? b
          : null;
      const shortPerp =
        a.instrument === "perp" && a.side === "short"
          ? a
          : b.instrument === "perp" && b.side === "short"
          ? b
          : null;
      if (!longSpot || !shortPerp || longSpot.id === shortPerp.id) continue;

      const dOpenH = hoursBetween(longSpot.openedAt, shortPerp.openedAt);
      if (dOpenH > 24) continue;

      const legs = [longSpot, shortPerp];
      const dCloseH = hoursBetween(longSpot.closedAt, shortPerp.closedAt);
      out.push({
        id: `fc:${legsKey(legs)}`,
        legs,
        spreadType: "funding",
        rationale: `Matched on: ${a.asset} · spot-long + perp-short on ${a.exchange} · opens within ${dOpenH.toFixed(1)}h · |Δqty| ${qtyDeltaPct(longSpot.qty, shortPerp.qty).toFixed(1)}%`,
        score: score(longSpot.qty, shortPerp.qty, dCloseH),
      });
    }
  }
  return out;
}

// ── Rule 4 · Calendar ────────────────────────────────────────────────────────
// Same asset · two `future` instruments with DIFFERENT expiries · SAME venue.
function ruleCalendar(fills: ImportedTradeFill[]): MatcherSuggestion[] {
  const out: MatcherSuggestion[] = [];
  for (let i = 0; i < fills.length; i++) {
    for (let j = i + 1; j < fills.length; j++) {
      const a = fills[i];
      const b = fills[j];
      if (a.asset !== b.asset) continue;
      if (a.exchange !== b.exchange) continue;
      if (a.instrument !== "future" || b.instrument !== "future") continue;
      if (!a.expiry || !b.expiry || a.expiry === b.expiry) continue;

      // A real calendar spread is one expiry long, the other short.
      if (a.side === b.side) continue;

      const dCloseH = hoursBetween(a.closedAt, b.closedAt);
      const legs = [a, b];
      out.push({
        id: `cal:${legsKey(legs)}`,
        legs,
        spreadType: "calendar",
        rationale: `Matched on: ${a.asset} futures on ${a.exchange} · ${a.expiry} vs ${b.expiry} · opposite sides · close times within ${dCloseH.toFixed(1)}h`,
        score: score(a.qty, b.qty, dCloseH),
      });
    }
  }
  return out;
}

// ── Rule 5 · DEX-CEX ─────────────────────────────────────────────────────────
// Same asset · one DEX leg + one CEX leg · opposite sides.
function ruleDexCex(fills: ImportedTradeFill[]): MatcherSuggestion[] {
  const out: MatcherSuggestion[] = [];
  for (let i = 0; i < fills.length; i++) {
    for (let j = i + 1; j < fills.length; j++) {
      const a = fills[i];
      const b = fills[j];
      if (a.asset !== b.asset) continue;
      if (a.side === b.side) continue;
      const venueMix = a.venueKind !== b.venueKind;
      if (!venueMix) continue;
      // Same asset · opposite sides · one DEX + one CEX → DEX-CEX shape.

      const dCloseH = hoursBetween(a.closedAt, b.closedAt);
      if (dCloseH > 12) continue;

      const cex = a.venueKind === "cex" ? a : b;
      const dex = a.venueKind === "dex" ? a : b;
      const legs = [cex, dex];
      out.push({
        id: `dx:${legsKey(legs)}`,
        legs,
        spreadType: "dex_cex",
        rationale: `Matched on: ${a.asset} · ${cex.exchange} ${cex.side} (CEX) + ${dex.exchange} ${dex.side} (DEX) · close times within ${dCloseH.toFixed(1)}h`,
        score: score(cex.qty, dex.qty, dCloseH),
      });
    }
  }
  return out;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Return all suggested spreads detected in `fills`, sorted highest score first.
 *
 * Notes:
 *  • Pure function, no I/O — easy to swap out for the production matcher.
 *  • Each suggestion's `legs` references the underlying `ImportedTradeFill`
 *    objects (not clones), so the UI can render their full details.
 *  • If multiple rules fire on the same leg-set, only the highest-scored
 *    suggestion survives (see `dedupe`).
 */
export function matchSpreads(
  fills: ImportedTradeFill[]
): MatcherSuggestion[] {
  const raw = [
    ...ruleCashAndCarry(fills),
    ...ruleCrossExchange(fills),
    ...ruleFundingCapture(fills),
    ...ruleCalendar(fills),
    ...ruleDexCex(fills),
  ];
  return dedupe(raw).sort((a, b) => b.score - a.score);
}

export const SPREAD_TYPE_LABELS: Record<MatcherSpreadType, string> = {
  cash_carry: "Cash-and-carry",
  cross_exchange: "Cross-exchange",
  funding: "Funding capture",
  calendar: "Calendar",
  dex_cex: "DEX-CEX",
};
