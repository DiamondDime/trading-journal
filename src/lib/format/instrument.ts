/**
 * Display formatting for instrument symbols.
 *
 * The worker stores instruments in ccxt's unified notation —
 * `BASE/QUOTE:SETTLE` for perps (e.g. `OPENAI/USDT:USDT`) and
 * `BASE/QUOTE:SETTLE-EXPIRY` for dated futures. The `:SETTLE` segment is the
 * settlement currency: it is load-bearing as a grouping/matching key (and
 * must never be mutated in stored data) but is noise in the UI — a linear
 * perp's settle currency always equals its quote, so `OPENAI/USDT:USDT`
 * shows the user `USDT` twice for no information.
 *
 * `stripSettleSuffix` removes only the `:SETTLE` token, leaving the base,
 * quote, and any `-EXPIRY` tail intact. It is a no-op for non-ccxt forms
 * (`BTC-PERP`, `BTCUSDT`, bare `BTC`), so it is safe to call unconditionally
 * at any render site. This is a display transform only — never persist the
 * result.
 */
export function stripSettleSuffix(symbol: string): string {
  if (!symbol) return symbol;
  // Remove a `:SETTLE` token: a colon followed by an alphanumeric run, up to
  // end-of-string or a `-EXPIRY` tail. `BTC/USDT:USDT-260925` → `BTC/USDT-260925`.
  return symbol.replace(/:[A-Za-z0-9]+(?=$|-)/, "");
}
