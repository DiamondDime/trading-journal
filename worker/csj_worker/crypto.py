"""App-layer AES-256-GCM credential decryption (worker side).

Mirror of src/lib/crypto/credentials.ts on the TS side. Same key, same algorithm,
byte-compatible. Stores ciphertext || tag in a single bytea field (Node's
cipher.getAuthTag() appends the tag separately; we recombine on the write side).

v1: master key in env. v2: fetch from KMS at startup.
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

NONCE_LENGTH = 12
TAG_LENGTH = 16


@dataclass(frozen=True)
class EncryptedField:
    ciphertext: bytes  # ciphertext || tag
    nonce: bytes


def get_master_key() -> bytes:
    b64 = os.environ.get("CREDENTIALS_MASTER_KEY")
    if not b64:
        raise RuntimeError(
            "CREDENTIALS_MASTER_KEY env var is required. "
            "Generate with: openssl rand -base64 32"
        )
    key = base64.b64decode(b64)
    if len(key) != 32:
        raise RuntimeError("CREDENTIALS_MASTER_KEY must decode to 32 bytes")
    return key


def encrypt_credential(plaintext: str) -> EncryptedField:
    """Encrypt a credential string. Returns (ciphertext+tag, nonce)."""
    key = get_master_key()
    nonce = os.urandom(NONCE_LENGTH)
    aead = AESGCM(key)
    # AESGCM.encrypt returns ciphertext || tag (16-byte tag appended).
    ct_and_tag = aead.encrypt(nonce, plaintext.encode("utf-8"), associated_data=None)
    return EncryptedField(ciphertext=ct_and_tag, nonce=nonce)


def decrypt_credential(field: EncryptedField) -> str:
    """Decrypt. Worker calls this just before invoking exchange APIs."""
    key = get_master_key()
    aead = AESGCM(key)
    plaintext = aead.decrypt(field.nonce, field.ciphertext, associated_data=None)
    return plaintext.decode("utf-8")
