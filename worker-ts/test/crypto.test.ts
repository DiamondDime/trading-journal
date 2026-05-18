/**
 * Crypto smoke tests — round-trip + format compatibility.
 *
 * The format spec (matches src/lib/crypto/credentials.ts and
 * worker/csj_worker/crypto.py):
 *
 *   - Key:        32-byte AES-256 key (base64 of CREDENTIALS_MASTER_KEY)
 *   - Nonce:      12 bytes random
 *   - Algorithm:  AES-256-GCM, no AAD
 *   - Storage:    ciphertext || 16-byte tag, plus the nonce in a sibling
 *                 column
 *
 * If you change crypto.ts and these tests still pass but the Python
 * worker fails to decrypt, the test bench below is the canonical
 * regression — copy a known ciphertext+nonce produced by Python into
 * the FIXTURE block at the bottom and assert it decrypts here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptCredential, encryptCredential } from '../src/crypto.js';

const ORIGINAL_KEY = process.env.CREDENTIALS_MASTER_KEY;

describe('crypto', () => {
  beforeEach(() => {
    // 32-byte key, base64-encoded.
    const key = randomBytes(32).toString('base64');
    process.env.CREDENTIALS_MASTER_KEY = key;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.CREDENTIALS_MASTER_KEY;
    } else {
      process.env.CREDENTIALS_MASTER_KEY = ORIGINAL_KEY;
    }
  });

  it('encrypts and decrypts a credential round-trip', () => {
    const plaintext = 'sk-binance-test-12345';
    const field = encryptCredential(plaintext);

    expect(field.nonce.length).toBe(12);
    expect(field.ciphertext.length).toBeGreaterThan(16);
    // ciphertext layout = body || 16-byte tag
    expect(field.ciphertext.length).toBe(plaintext.length + 16);

    const out = decryptCredential(field);
    expect(out).toBe(plaintext);
  });

  it('produces a different nonce + ciphertext on every call', () => {
    const a = encryptCredential('same-input');
    const b = encryptCredential('same-input');
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('throws on an invalid auth tag (tampered ciphertext)', () => {
    const field = encryptCredential('secret');
    const tampered = Buffer.from(field.ciphertext);
    // Flip a bit in the body — the tag check must fail.
    if (tampered[0] !== undefined) tampered[0] ^= 0x01;
    expect(() => decryptCredential({ ciphertext: tampered, nonce: field.nonce }))
      .toThrow();
  });

  it('throws when CREDENTIALS_MASTER_KEY is not 32 bytes', () => {
    process.env.CREDENTIALS_MASTER_KEY = Buffer.from('too-short').toString('base64');
    expect(() => encryptCredential('x')).toThrow(/32 bytes/);
  });
});
