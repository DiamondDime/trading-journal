/**
 * Fills → Positions aggregator — pure, DB-free.
 *
 * TS port of `worker/csj_worker/positions_aggregator.py` (the pure-logic half:
 * `_aggregate_group`, `_group_fills`, `_RunningPosition`, `_derive_position_side`).
 * The Python file also contains the DB plumbing (`aggregate_positions`,
 * `_load_unmatched_fills`, `_insert_position`, ...) — that is deliberately NOT
 * ported here; DB integration lives in `db.ts` / `main.ts`.
 *
 * Why this module exists
 * ----------------------
 * The worker syncs raw `fills` (individual executions) but the UI's trade feed
 * reads the `positions` table. This module folds a chronological fill stream
 * into positions so that gap can be closed.
 *
 * Algorithm
 * =========
 * We work on one `(exchangeConnectionId, instrument, positionSide)` group at a
 * time — a single LOGICAL position lifecycle: open → grow → reduce → close,
 * possibly with side flips creating chains of positions.
 *
 * Within a group, fills are processed in `filledAt` ascending order (the caller
 * supplies them sorted). We carry a running `(side, qty, vwap)` state. Each fill
 * either:
 *
 *  1. Opens a new position (running qty == 0)
 *  2. Grows the running side (fill adds to it)
 *  3. Reduces it (fill opposes the running side)
 *     - qty reduces below running → close current AND open a new opposite one
 *     - qty == running → clean close
 *     - qty < running → partial close, stays open
 *
 * Cost-basis method
 * -----------------
 * Average / VWAP cost basis (NOT FIFO lot tracking). `vwap` is the
 * volume-weighted average entry price of the open quantity:
 *
 *   vwap' = (qty * vwap + fillQty * fillPrice) / (qty + fillQty)
 *
 * A reduction never moves `vwap` — it only shrinks `qty`. This matches the
 * Python aggregator exactly.
 *
 * Shorts
 * ------
 * For a `short` running side a `sell` grows and a `buy` reduces (mirror of
 * `long`). Derivatives venues supply `positionSide` per fill; spot fills have
 * none and are always bucketed as `long` (a sell reduces the long, a buy grows
 * it).
 *
 * Reduce-only fills
 * -----------------
 * The Python pure logic does NOT branch on the `reduceOnly` flag at all —
 * growth vs. reduction is decided purely by side vs. running side. A
 * reduce-only fill is therefore handled like any other reducing fill. We keep
 * the same behaviour (the flag is carried on `CanonicalFill` but unused here).
 *
 * Realized P&L
 * ------------
 * The Python aggregator explicitly does NOT compute realized P&L — migration
 * 005's `tg_fills_recompute_position` trigger does, DB-side, once the worker
 * sets `fills.position_id`, and it stays authoritative for the `positions`
 * table. This module additionally surfaces an in-process realized-P&L figure
 * and accumulated fees on the result wrapper — useful for logging and as a
 * cross-check against the trigger. They are pure derivations of the fills
 * already tracked and do not affect open/add/reduce/close behaviour:
 *
 *  - realizedPnl: sum over each reducing slice of
 *        long : (exitPrice - vwapAtReduce) * reducedQty
 *        short: (vwapAtReduce - exitPrice) * reducedQty
 *  - avgExitPrice: VWAP of all reducing slices (null while no qty closed)
 *  - feesPaid: sum of `fee` over every fill linked to the position
 *
 * Side-flip semantics
 * ===================
 * When a fill flips the position (reduces below zero) we split it conceptually
 * into a closer (qty = runningQty) and an opener of a new opposite position
 * (qty = fill.qty - runningQty, vwap = fill.price). The fill row itself stays
 * linked to the OLD (closed) position — the new opener has no fill row of its
 * own (`fillIds` starts empty). Slightly lossy on the side-flip fill, but
 * matches the Python aggregator and every position-builder it surveyed.
 *
 * Conventions
 * -----------
 *  - All money/qty arithmetic goes through `decimal.js` (`Decimal`). JS float
 *    math drifts on money values; the Python original uses `Decimal`.
 *  - Inputs/outputs carry decimals as strings (`Dec`), per the worker-ts rule.
 *    Strings cross the module boundary; `Decimal` is internal only.
 */
import { Decimal } from 'decimal.js';

import type {
  CanonicalFill,
  CanonicalInstrument,
  CanonicalPosition,
  Dec,
  PositionSide,
  Side,
} from './types.js';

// ---------------------------------------------------------------------------
// Public result shapes
// ---------------------------------------------------------------------------

/**
 * One aggregated position: a `CanonicalPosition` plus the lifecycle metadata
 * the pure aggregator tracks (`closedAt`, the contributing fills) and the
 * derived P&L/fee figures.
 *
 * `CanonicalPosition.qtyOpen` is `'0'` for a closed position and the live
 * remaining size for an open one. `CanonicalPosition.avgEntryPrice` is the
 * VWAP at open/grow time. `openedAt` is the first contributing fill's time.
 */
export interface AggregatedPosition {
  /** The canonical position row (decimals as strings). */
  position: CanonicalPosition;
  /** Close time, or `null` while the position is still open. */
  closedAt: Date | null;
  /** `'open'` | `'closed'` — convenience mirror of `closedAt != null`. */
  status: 'open' | 'closed';
  /** Lifetime quantity opened into this position (sum of growth qtys). */
  totalQty: Dec;
  /** VWAP of all reducing fills, or `null` if nothing was closed yet. */
  avgExitPrice: Dec | null;
  /** Realized P&L over the closed quantity (`'0'` while fully open). */
  realizedPnl: Dec;
  /** Sum of `fee` across every fill linked to this position. */
  feesPaid: Dec;
  /** `externalTradeId`s of the fills that contributed to this position. */
  fillIds: string[];
}

/** Bucket key for `groupFills` — `[connectionId, instrument, positionSide]`. */
export type GroupKey = readonly [string, string, PositionSide];

// ---------------------------------------------------------------------------
// Decimal helpers
// ---------------------------------------------------------------------------

/** Parse a `Dec` string into a `Decimal`. */
function dec(value: Dec): Decimal {
  return new Decimal(value);
}

const ZERO = new Decimal(0);

// ---------------------------------------------------------------------------
// Running position state
// ---------------------------------------------------------------------------

/**
 * In-memory representation of the position currently being built.
 *
 * TS port of Python's `_RunningPosition`. We accumulate fills until the running
 * `qty` reaches zero (close) or the side flips. `vwap` is the volume-weighted
 * average entry price; reductions shrink `qty` but never move `vwap`.
 *
 * The realized-P&L / exit-price / fee fields are TS additions (the Python pure
 * class carries only `side` / `qty` / `vwap` / `openedAt` / `fillIds`); they
 * accumulate as fills are folded and never influence open/grow/reduce logic.
 */
export class RunningPosition {
  side: PositionSide;
  /** Currently-open quantity. */
  qty: Decimal;
  /** Volume-weighted average entry price of the open quantity. */
  vwap: Decimal;
  openedAt: Date;
  /** `externalTradeId`s of contributing fills, in fold order. */
  fillIds: string[];

  /** Lifetime quantity opened (initial open qty + every growth qty). */
  totalQty: Decimal;
  /** Running sum of `exitPrice * reducedQty` over reducing slices. */
  exitNotional: Decimal;
  /** Running sum of `reducedQty` over reducing slices. */
  exitQty: Decimal;
  /** Running realized P&L over closed quantity. */
  realizedPnl: Decimal;
  /** Running sum of `fee` over every contributing fill. */
  feesPaid: Decimal;

  private constructor(args: {
    side: PositionSide;
    qty: Decimal;
    vwap: Decimal;
    openedAt: Date;
    fillIds: string[];
    totalQty: Decimal;
    exitNotional: Decimal;
    exitQty: Decimal;
    realizedPnl: Decimal;
    feesPaid: Decimal;
  }) {
    this.side = args.side;
    this.qty = args.qty;
    this.vwap = args.vwap;
    this.openedAt = args.openedAt;
    this.fillIds = args.fillIds;
    this.totalQty = args.totalQty;
    this.exitNotional = args.exitNotional;
    this.exitQty = args.exitQty;
    this.realizedPnl = args.realizedPnl;
    this.feesPaid = args.feesPaid;
  }

  /** Open a fresh position from a fill (Python `_RunningPosition.open`). */
  static open(positionSide: PositionSide, fill: CanonicalFill): RunningPosition {
    return new RunningPosition({
      side: positionSide,
      qty: dec(fill.qty),
      vwap: dec(fill.price),
      openedAt: fill.filledAt,
      fillIds: [fill.externalTradeId],
      totalQty: dec(fill.qty),
      exitNotional: ZERO,
      exitQty: ZERO,
      realizedPnl: ZERO,
      feesPaid: dec(fill.fee),
    });
  }

  /**
   * Open a synthetic position from a side-flip leftover.
   *
   * The closer fill is linked to the now-closed position, so the opener starts
   * with empty `fillIds` and no fee (the fee was charged to the closer). This
   * mirrors Python's flip branch, which sets `fill_ids=[]` for the new
   * `_RunningPosition`.
   */
  static openFromFlip(
    positionSide: PositionSide,
    leftoverQty: Decimal,
    price: Decimal,
    openedAt: Date,
  ): RunningPosition {
    return new RunningPosition({
      side: positionSide,
      qty: leftoverQty,
      vwap: price,
      openedAt,
      fillIds: [],
      totalQty: leftoverQty,
      exitNotional: ZERO,
      exitQty: ZERO,
      realizedPnl: ZERO,
      feesPaid: ZERO,
    });
  }

  /**
   * Add to the position (Python `_RunningPosition.grow`).
   *
   *   vwap' = (qty * vwap + fillQty * fillPrice) / (qty + fillQty)
   *
   * @throws {Error} if the combined qty is zero (degenerate input — `grow`
   *   must never produce zero; mirrors the Python defensive `RuntimeError`).
   */
  grow(fill: CanonicalFill): void {
    const fillQty = dec(fill.qty);
    const fillPrice = dec(fill.price);
    const newQty = this.qty.plus(fillQty);
    if (newQty.isZero()) {
      // Defensive: grow should never produce zero.
      throw new Error('grow() called with degenerate qtys');
    }
    this.vwap = this.qty.times(this.vwap).plus(fillQty.times(fillPrice)).div(newQty);
    this.qty = newQty;
    this.totalQty = this.totalQty.plus(fillQty);
    this.feesPaid = this.feesPaid.plus(dec(fill.fee));
    this.fillIds.push(fill.externalTradeId);
  }

  /**
   * Record a reducing slice: `reducedQty` units exited at `exitPrice`.
   *
   * Realized P&L for the slice:
   *   long : (exitPrice - vwap) * reducedQty
   *   short: (vwap - exitPrice) * reducedQty
   *
   * `vwap` is read BEFORE the caller shrinks `qty`, so it is the average entry
   * of the quantity being closed. TS-only bookkeeping; no Python equivalent.
   */
  recordReduction(reducedQty: Decimal, exitPrice: Decimal): void {
    const pnlPerUnit =
      this.side === 'long' ? exitPrice.minus(this.vwap) : this.vwap.minus(exitPrice);
    this.realizedPnl = this.realizedPnl.plus(pnlPerUnit.times(reducedQty));
    this.exitNotional = this.exitNotional.plus(exitPrice.times(reducedQty));
    this.exitQty = this.exitQty.plus(reducedQty);
  }
}

// ---------------------------------------------------------------------------
// Position-side derivation
// ---------------------------------------------------------------------------

/**
 * Return `'long'` or `'short'` for this fill's logical position bucket.
 *
 * TS port of Python `_derive_position_side`. Derivatives venues supply
 * `positionSide` directly; spot fills (no `positionSide`) always bucket as
 * `'long'` — buys grow it, sells reduce it.
 */
export function derivePositionSide(fill: CanonicalFill): PositionSide {
  if (fill.positionSide) {
    return fill.positionSide;
  }
  // Spot: one-way mode, everything is long.
  return 'long';
}

/**
 * True if this fill ADDS to the running position (Python `_is_growing`).
 *
 * For a `long` running side a `buy` grows and a `sell` reduces; for a `short`
 * running side a `sell` grows and a `buy` reduces.
 */
function isGrowing(runningSide: PositionSide, side: Side): boolean {
  if (runningSide === 'long') {
    return side === 'buy';
  }
  return side === 'sell';
}

/** Flip a position side (Python `_flip`). */
function flip(side: PositionSide): PositionSide {
  return side === 'long' ? 'short' : 'long';
}

// ---------------------------------------------------------------------------
// Per-group aggregation — the heart of the algorithm
// ---------------------------------------------------------------------------

/** One folded position plus its close time (`null` while open). */
export interface AggregateGroupEntry {
  position: RunningPosition;
  closedAt: Date | null;
}

/**
 * Fold-left a single group's fills into a sequence of positions.
 *
 * TS port of Python `_aggregate_group`. `fills` MUST already be sorted by
 * `filledAt` ascending and belong to one `(connection, instrument,
 * positionSide)` group. Returns one entry per emitted position; `closedAt` is
 * `null` for the still-open position (at most one per group in normal trading)
 * and a `Date` for every closed one.
 */
export function aggregateGroup(fills: readonly CanonicalFill[]): AggregateGroupEntry[] {
  if (fills.length === 0) {
    return [];
  }

  const out: AggregateGroupEntry[] = [];
  let running: RunningPosition | null = null;

  for (const fill of fills) {
    const targetSide = derivePositionSide(fill);

    if (running === null) {
      running = RunningPosition.open(targetSide, fill);
      continue;
    }

    // Sanity: if a fill's derived position_side disagrees with our running
    // side, the caller batched fills across position sides (grouping should
    // have separated them). Close the current position at this fill's time
    // and open a new one in the target side. Mirrors Python's guard branch.
    if (targetSide !== running.side) {
      out.push({ position: running, closedAt: fill.filledAt });
      running = RunningPosition.open(targetSide, fill);
      continue;
    }

    if (isGrowing(running.side, fill.side)) {
      running.grow(fill);
      continue;
    }

    // Reduction.
    const fillQty = dec(fill.qty);
    const fillPrice = dec(fill.price);
    const fillFee = dec(fill.fee);

    if (fillQty.lt(running.qty)) {
      // Partial close — position stays open.
      running.recordReduction(fillQty, fillPrice);
      running.qty = running.qty.minus(fillQty);
      running.feesPaid = running.feesPaid.plus(fillFee);
      running.fillIds.push(fill.externalTradeId);
      continue;
    }

    if (fillQty.equals(running.qty)) {
      // Clean close.
      running.recordReduction(running.qty, fillPrice);
      running.qty = ZERO;
      running.feesPaid = running.feesPaid.plus(fillFee);
      running.fillIds.push(fill.externalTradeId);
      out.push({ position: running, closedAt: fill.filledAt });
      running = null;
      continue;
    }

    // Side flip: close current, open new opposite position with leftover qty.
    const leftover = fillQty.minus(running.qty);
    running.recordReduction(running.qty, fillPrice);
    running.qty = ZERO;
    running.feesPaid = running.feesPaid.plus(fillFee);
    running.fillIds.push(fill.externalTradeId);
    out.push({ position: running, closedAt: fill.filledAt });

    // The closer fill belongs to the now-closed position; the new opener has
    // no fill row of its own (and the flip fill's fee was already charged to
    // the closer). Mirrors Python: `fill_ids=[]` for the flipped position.
    running = RunningPosition.openFromFlip(
      flip(running.side),
      leftover,
      fillPrice,
      fill.filledAt,
    );
  }

  if (running !== null && running.qty.gt(ZERO)) {
    out.push({ position: running, closedAt: null });
  } else if (running !== null && running.qty.isZero()) {
    // Shouldn't happen — we close eagerly. Tolerate, mirroring Python.
    const last = fills[fills.length - 1];
    out.push({ position: running, closedAt: last ? last.filledAt : null });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** A `GroupKey` plus the fills bucketed under it. */
export interface FillGroup {
  key: GroupKey;
  fills: CanonicalFill[];
}

/** Stable string form of a `GroupKey` for `Map` use. */
function groupKeyId(connectionId: string, instrument: string, side: PositionSide): string {
  return JSON.stringify([connectionId, instrument, side]);
}

/**
 * Identify a `CanonicalInstrument` for grouping.
 *
 * The Python loader groups by the `instrument` text column (the venue symbol,
 * e.g. `"BTC/USDT:USDT"`). `CanonicalInstrument` carries `rawSymbol`, the same
 * venue symbol, so we group by that.
 */
function instrumentId(instrument: CanonicalInstrument): string {
  return instrument.rawSymbol;
}

/**
 * Bucket fills by `(exchangeConnectionId, instrument, derivedPositionSide)`.
 *
 * TS port of Python `_group_fills`. Grouping uses the DERIVED position side
 * (spot → `'long'`) so the aggregator never has to know about spot vs.
 * derivatives. Insertion order of fills within a bucket is preserved (the
 * caller is responsible for chronological order).
 *
 * @param fills - fills to bucket.
 * @param exchangeConnectionId - the connection these fills belong to. The
 *   Python loader reads this from each fill row; `CanonicalFill` has no such
 *   field, so the caller supplies it (one `aggregateFills` call is scoped to a
 *   single connection in the worker).
 */
export function groupFills(
  fills: readonly CanonicalFill[],
  exchangeConnectionId: string,
): FillGroup[] {
  const groups = new Map<string, FillGroup>();
  for (const fill of fills) {
    const side = derivePositionSide(fill);
    const instrument = instrumentId(fill.instrument);
    const id = groupKeyId(exchangeConnectionId, instrument, side);
    let group = groups.get(id);
    if (group === undefined) {
      group = { key: [exchangeConnectionId, instrument, side], fills: [] };
      groups.set(id, group);
    }
    group.fills.push(fill);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Public entry point — fills → aggregated positions
// ---------------------------------------------------------------------------

/**
 * Build a `CanonicalPosition` from a folded `RunningPosition`.
 *
 * `qtyOpen` is `'0'` for a closed position (Python `_insert_position` zeroes
 * it on close) and the live remaining quantity for an open one.
 */
function toAggregatedPosition(
  running: RunningPosition,
  closedAt: Date | null,
  instrument: CanonicalInstrument,
): AggregatedPosition {
  const status: 'open' | 'closed' = closedAt !== null ? 'closed' : 'open';
  const qtyOpen = status === 'closed' ? ZERO : running.qty;
  const avgExitPrice = running.exitQty.gt(ZERO)
    ? running.exitNotional.div(running.exitQty)
    : null;

  const position: CanonicalPosition = {
    externalPositionId: null,
    instrument,
    side: running.side,
    qtyOpen: qtyOpen.toString(),
    avgEntryPrice: running.vwap.toString(),
    unrealizedPnl: null,
    markPrice: null,
    leverage: null,
    liquidationPrice: null,
    openedAt: running.openedAt,
    raw: {},
  };

  return {
    position,
    closedAt,
    status,
    totalQty: running.totalQty.toString(),
    avgExitPrice: avgExitPrice !== null ? avgExitPrice.toString() : null,
    realizedPnl: running.realizedPnl.toString(),
    feesPaid: running.feesPaid.toString(),
    fillIds: running.fillIds,
  };
}

/**
 * Fold a chronological fill stream into positions — the public API.
 *
 * Pure: no DB, no I/O. The worker calls this after persisting raw fills, then
 * upserts the returned positions and links `fills.position_id`.
 *
 * Steps (mirroring Python `aggregate_positions`):
 *  1. Bucket fills by `(connection, instrument, positionSide)` (`groupFills`).
 *  2. Fold each bucket with `aggregateGroup`.
 *  3. Project each folded `RunningPosition` to an `AggregatedPosition`.
 *
 * @param fills - fills for ONE exchange connection. The caller MUST pass them
 *   sorted by `filledAt` ascending; ordering within a group is significant and
 *   is not re-sorted here (matching the Python loader, which sorts in SQL).
 * @param exchangeConnectionId - the connection id, used for the group key.
 * @returns one `AggregatedPosition` per emitted position. Empty input yields
 *   an empty array (the idempotent no-op case).
 */
export function aggregateFills(
  fills: readonly CanonicalFill[],
  exchangeConnectionId: string,
): AggregatedPosition[] {
  if (fills.length === 0) {
    return [];
  }

  const out: AggregatedPosition[] = [];
  for (const group of groupFills(fills, exchangeConnectionId)) {
    // The instrument is constant within a group (grouped by symbol). Use the
    // first fill's instrument for the emitted positions.
    const first = group.fills[0];
    if (first === undefined) {
      continue;
    }
    const instrument = first.instrument;
    for (const entry of aggregateGroup(group.fills)) {
      out.push(toAggregatedPosition(entry.position, entry.closedAt, instrument));
    }
  }
  return out;
}
