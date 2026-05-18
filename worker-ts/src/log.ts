/**
 * Structured logger (pino). One shared root logger; modules call
 * `log.child({...})` for context-specific scoping.
 *
 * Output mode is picked at startup:
 *  - `WORKER_LOG_PRETTY=1` (or `NODE_ENV !== 'production'` by default) →
 *    `pino-pretty` for human eyes.
 *  - Otherwise → newline-delimited JSON (one line per record) so the
 *    Electron main process can forward stdout straight to a log file or
 *    structured aggregator.
 */
import pino, { type Logger, type LoggerOptions } from 'pino';

const level = process.env.WORKER_LOG_LEVEL ?? 'info';

const pretty =
  process.env.WORKER_LOG_PRETTY === '1' ||
  (process.env.NODE_ENV !== 'production' && process.env.WORKER_LOG_PRETTY !== '0');

const opts: LoggerOptions = {
  level,
  base: { service: 'csj-worker-ts' },
  // ISO-8601 timestamps so they sort the same in JSONL viewers and human logs.
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  ...(pretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname,service',
          },
        },
      }
    : {}),
};

export const log: Logger = pino(opts);

export type { Logger };
