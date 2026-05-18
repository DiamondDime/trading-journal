/**
 * Binance adapter — minimal wrapper around `CcxtGenericAdapter`.
 *
 * Equivalent to the Python `binance.py` shim. All real logic lives in
 * `CcxtGenericAdapter` + `BINANCE_CONFIG`. Existing tests may import this
 * directly; new code should prefer `getAdapter('binance')` (see `index.ts`).
 */
import { CcxtGenericAdapter } from './ccxt-generic.js';
import { BINANCE_CONFIG } from './configs/binance.js';

export class BinanceAdapter extends CcxtGenericAdapter {
  constructor() {
    super(BINANCE_CONFIG);
  }
}

export { BINANCE_CONFIG };
