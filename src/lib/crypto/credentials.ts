/**
 * App-layer AES-256-GCM credential encryption.
 *
 * Used by API routes to encrypt exchange credentials before insert.
 * The master key (32 bytes, base64) lives in `CREDENTIALS_MASTER_KEY` env var.
 *
 * v1: master key in env. v2 migration: fetch from KMS at runtime.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const b64 = process.env.CREDENTIALS_MASTER_KEY;
  if (!b64) {
    throw new Error(
      'CREDENTIALS_MASTER_KEY env var is required. Generate with: openssl rand -base64 32'
    );
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_MASTER_KEY must decode to 32 bytes (base64 of openssl rand -base64 32)');
  }
  return key;
}

export interface EncryptedField {
  ciphertext: Buffer; // includes 16-byte auth tag appended
  nonce: Buffer;      // 12 bytes
}

export function encryptCredential(plaintext: string): EncryptedField {
  const key = getMasterKey();
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store ciphertext || tag as a single bytea
  return { ciphertext: Buffer.concat([encrypted, tag]), nonce };
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
