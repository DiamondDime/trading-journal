/**
 * Permission-check tests for the venue configs.
 *
 * The withdraw-rejection logic is the security-critical part of every
 * adapter — it is what stops a destructive API key from being used. These
 * tests exercise the `VenueConfig` predicates directly: no network, no ccxt.
 */
import { describe, expect, it } from 'vitest';
import { BYBIT_CONFIG } from '../src/adapters/configs/bybit.js';
import { MEXC_CONFIG } from '../src/adapters/configs/mexc.js';

describe('bybit permission checks', () => {
  it('accepts a read-only key with no withdraw scope', () => {
    expect(
      BYBIT_CONFIG.hasWithdrawPermission({ readOnly: 1, permissions: {} }),
    ).toBe(false);
  });

  it('rejects a key that is not read-only', () => {
    expect(
      BYBIT_CONFIG.hasWithdrawPermission({ readOnly: 0, permissions: {} }),
    ).toBe(true);
  });

  it('rejects a read-only key that still carries Wallet:Withdraw', () => {
    expect(
      BYBIT_CONFIG.hasWithdrawPermission({
        readOnly: 1,
        permissions: { Wallet: ['AccountTransfer', 'Withdraw'] },
      }),
    ).toBe(true);
  });

  it('rejects when the readOnly flag is absent', () => {
    expect(BYBIT_CONFIG.hasWithdrawPermission({})).toBe(true);
  });

  it('flattens granted scopes and never surfaces Withdraw', () => {
    expect(
      BYBIT_CONFIG.extractPermissions({
        readOnly: 1,
        permissions: {
          ContractTrade: ['Order', 'Position'],
          Wallet: ['AccountTransfer', 'Withdraw'],
        },
      }),
    ).toEqual([
      'ContractTrade:Order',
      'ContractTrade:Position',
      'Wallet:AccountTransfer',
    ]);
  });
});

describe('mexc permission checks', () => {
  it('never auto-rejects — withdraw scope is not introspectable', () => {
    expect(MEXC_CONFIG.hasWithdrawPermission({})).toBe(false);
    expect(MEXC_CONFIG.hasWithdrawPermission({ anything: true })).toBe(false);
  });

  it('always surfaces withdraw:unverified for UI attestation', () => {
    expect(MEXC_CONFIG.extractPermissions({})).toEqual([
      'read',
      'withdraw:unverified',
    ]);
  });
});
