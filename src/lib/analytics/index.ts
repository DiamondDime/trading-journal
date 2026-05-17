/**
 * Analytics barrel — re-exports everything so dashboard consumers can do:
 *
 *   import { computeDrawdown, computeSharpeSortino } from '@/lib/analytics';
 *
 * Keep this thin; downstream callers should not need to know the file split.
 */

export {
  computeDrawdown,
  computeStreaks,
  computeRDistribution,
  computeMoreMetrics,
  type DrawdownResult,
  type StreakResult,
  type RDistribution,
  type MoreMetrics,
} from './metrics';

export {
  computeSharpeSortino,
  type SharpeResult,
  type SharpeOptions,
} from './risk';

export {
  buildEquityPoints,
  buildUnderwaterPoints,
  buildRollingWinRate,
  pickTopBestWorst,
  computeCumulativeNet,
} from './series';
