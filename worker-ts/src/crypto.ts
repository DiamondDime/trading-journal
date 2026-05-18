/**
 * App-layer AES-256-GCM credential encryption (worker side, TS port).
 *
 * Byte-compatible with:
 *  - src/lib/crypto/credentials.ts (Next.js side, Node `crypto`)
 *  - worker/csj_worker/crypto.py  (legacy Python worker, `cryptography.AESGCM`)
 *
 * Format spec
 * -----------
 * The cipher state is stored across two `bytea` columns in
 * `exchange_connections`:
 *
 *   - `..._ciphertext`  — `ciphertext || tag` (16-byte GCM tag appended)
 *   - `..._nonce`       — 12-byte random nonce
 *
 * Key derivation: the master key is the base64-decoded value of the
 * `CREDENTIALS_MASTER_KEY` env var (must be exactly 32 bytes, generated via
 * `openssl rand -base64 32`). No KDF is applied — the env var IS the key.
 *
 * Encryption: `AES-256-GCM(key, nonce, plaintext, aad=None)`. The Python side
 * uses `AESGCM.encrypt(nonce, plaintext, associated_data=None)` which returns
 * `ciphertext || tag`; Node's `cipher.getAuthTag()` returns the tag separately
 * and we concatenate to mirror the Python layout.
 *
 * v1: master key in env. v2 migration: fetch from KMS at startup.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm' as const;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const b64 = process.env.CREDENTIALS_MASTER_KEY;
  if (!b64) {
    throw new Error(
      'CREDENTIALS_MASTER_KEY env var is required. Generate with: openssl rand -base64 32',
    );
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'CREDENTIALS_MASTER_KEY must decode to 32 bytes (base64 of openssl rand -base64 32)',
    );
  }
  return key;
}

export interface EncryptedField {
  /** ciphertext || 16-byte auth tag */
  ciphertext: Buffer;
  /** 12-byte random nonce */
  nonce: Buffer;
}

export function encryptCredential(plaintext: string): EncryptedField {
  const key = getMasterKey();
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([enc, tag]), nonce };
}

export function decryptCredential(field: EncryptedField): string {
  const key = getMasterKey();
  const { ciphertext, nonce } = field;
  if (ciphertext.length < TAG_LENGTH) {
    throw new Error('Ciphertext too short');
  }
  const tag = ciphertext.subarray(ciphertext.length - TAG_LENGTH);
  const body = ciphertext.subarray(0, ciphertext.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

/** Generate a hint suffix for UI display (last 4 chars). Never log the full key. */
export function apiKeyHint(apiKey: string): string {
  return '••••' + apiKey.slice(-4);
}

/** Mask any secret for safe logging — preserve last 4 chars only. */
export function maskSecret(secret: string | null | undefined): string {
  if (!secret) return '<empty>';
  if (secret.length <= 4) return '****';
  return '****' + secret.slice(-4);
}
