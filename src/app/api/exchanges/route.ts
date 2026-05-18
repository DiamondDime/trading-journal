/**
 * GET  /api/exchanges — list user's connections
 * POST /api/exchanges — create a connection with encrypted credentials.
 *                       Validates with the worker BEFORE persisting `status=active`.
 *
 * Eager connect-time validation (W3a §5)
 * -------------------------------------
 * The old behaviour inserted with `status='pending'` and let the worker
 * cycle (up to 5 min later) decide. That broke the UX promise of
 * "rejected within seconds". The new flow:
 *   1. Insert the encrypted ciphertexts with `status='pending'`.
 *   2. Call the worker's POST /test-connection (loopback HTTP).
 *   3. On `ok=true` → flip `status='active'`, stamp `permissions_json`.
 *   4. On `ok=false` → soft-delete the row, return 400 with the reason.
 *
 * Unverified withdraw status (BingX/MEXC/Phemex):
 *   These venues expose no permission-introspection endpoint. The worker
 *   returns `unverified=['withdraw:unverified']` for them. We require the
 *   client to set `attest_read_only=true` in that case so the UI is forced
 *   to surface the warning + checkbox.
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, created, errors } from '@/lib/api/response';
import { sql } from '@/lib/db/client';
import { CreateExchangeConnectionBody } from '@/lib/db/zod-schemas';
import { encryptCredential, apiKeyHint } from '@/lib/crypto/credentials';
import { testConnectionViaWorker } from '@/lib/exchanges/worker-client';

export const GET = withAuth(async (_req, { userId }) => {
  const rows = await sql`
    SELECT id, exchange_code, label, connection_type, api_key_hint, wallet_chain,
           status, status_message, last_sync_at, last_fill_at, fills_synced,
           permissions_json, created_at, updated_at
    FROM public.exchange_connections
    WHERE user_id = ${userId}::uuid AND deleted_at IS NULL
    ORDER BY created_at DESC
  `;
  return ok(rows);
});

export const POST = withAuth(async (req, { userId }) => {
  const body = await parseBody(req, CreateExchangeConnectionBody);

  const catalog = await sql<{ authMode: string }[]>`
    SELECT auth_mode FROM public.exchange_catalog WHERE code = ${body.exchange}
  `;
  if (!catalog[0]) return errors.notFound(`Unknown exchange: ${body.exchange}`);
  if (catalog[0].authMode !== body.credentials.mode) {
    return errors.unprocessable(
      'CREDENTIAL_MISMATCH',
      `${body.exchange} requires ${catalog[0].authMode}, got ${body.credentials.mode}`
    );
  }

  // Insert the encrypted row first so the worker can read it back.
  // We always start as `pending` and flip to `active` only after the
  // worker validates the credentials.
  let connectionId: string;
  let createdRow: Record<string, unknown>;
  try {
    if (body.credentials.mode === 'api_key') {
      const k = encryptCredential(body.credentials.api_key);
      const s = encryptCredential(body.credentials.api_secret);
      const p = body.credentials.passphrase
        ? encryptCredential(body.credentials.passphrase)
        : null;
      const hint = apiKeyHint(body.credentials.api_key);

      const rows = await sql<{ id: string; [k: string]: unknown }[]>`
        INSERT INTO public.exchange_connections (
          user_id, exchange_code, label, connection_type, status,
          api_key_ciphertext, api_key_nonce,
          api_secret_ciphertext, api_secret_nonce,
          api_passphrase_ciphertext, api_passphrase_nonce,
          api_key_hint
        ) VALUES (
          ${userId}::uuid, ${body.exchange}, ${body.label}, 'api_key', 'pending',
          ${k.ciphertext}, ${k.nonce},
          ${s.ciphertext}, ${s.nonce},
          ${p?.ciphertext ?? null}, ${p?.nonce ?? null},
          ${hint}
        )
        RETURNING id, exchange_code, label, connection_type, api_key_hint,
                  wallet_chain, status, created_at
      `;
      connectionId = rows[0].id;
      createdRow = rows[0];
    } else {
      const w = encryptCredential(body.credentials.address);
      const rows = await sql<{ id: string; [k: string]: unknown }[]>`
        INSERT INTO public.exchange_connections (
          user_id, exchange_code, label, connection_type, status,
          wallet_address_ciphertext, wallet_address_nonce, wallet_chain
        ) VALUES (
          ${userId}::uuid, ${body.exchange}, ${body.label}, 'wallet_address', 'pending',
          ${w.ciphertext}, ${w.nonce}, ${body.credentials.chain ?? null}
        )
        RETURNING id, exchange_code, label, connection_type, api_key_hint,
                  wallet_chain, status, created_at
      `;
      connectionId = rows[0].id;
      createdRow = rows[0];
    }
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('uq_user_exchange_label')) {
      return errors.conflict(
        'DUPLICATE_LABEL',
        'A connection with that label already exists for this exchange'
      );
    }
    throw e;
  }

  // Eager validation — ask the worker to run adapter.connect().
  const probe = await testConnectionViaWorker(connectionId);

  if (!probe.ok) {
    // Soft-delete the row so the user can retry with a different key
    // without hitting the unique-label constraint immediately.
    await sql`
      UPDATE public.exchange_connections
      SET deleted_at = now(), status = 'auth_failed', status_message = ${probe.message ?? probe.error ?? 'connect failed'}
      WHERE id = ${connectionId}::uuid AND user_id = ${userId}::uuid
    `;

    if (probe.error === 'permission') {
      return errors.unprocessable(
        'WITHDRAW_PERMISSION_REJECTED',
        probe.message ?? 'API key has withdraw permission — please create a read-only key.'
      );
    }
    if (probe.error === 'auth_failed') {
      return errors.unprocessable(
        'AUTH_FAILED',
        probe.message ?? 'Authentication failed.'
      );
    }
    if (probe.error === 'rate_limited') {
      return errors.unprocessable(
        'RATE_LIMITED',
        probe.message ?? 'Exchange rate-limited the validation request.'
      );
    }
    return errors.unprocessable(
      'CONNECT_FAILED',
      probe.message ?? probe.error ?? 'Connection validation failed.'
    );
  }

  // Unverified-withdraw venues (BingX/MEXC/Phemex): require explicit
  // user attestation. Without it we refuse to persist as `active`.
  if (probe.unverified && probe.unverified.length > 0) {
    const attested = (body as { attest_read_only?: boolean }).attest_read_only === true;
    if (!attested) {
      await sql`
        UPDATE public.exchange_connections
        SET deleted_at = now(), status = 'pending',
            status_message = 'attestation required'
        WHERE id = ${connectionId}::uuid AND user_id = ${userId}::uuid
      `;
      return errors.unprocessable(
        'ATTESTATION_REQUIRED',
        `${body.exchange} does not expose a permission-introspection endpoint. Please confirm your API key is read-only by re-submitting with attest_read_only=true.`,
        { unverified: probe.unverified }
      );
    }
  }

  await sql`
    UPDATE public.exchange_connections
    SET status = 'active',
        status_message = NULL,
        permissions_json = ${JSON.stringify({ permissions: probe.permissions ?? [], unverified: probe.unverified ?? [] })}::jsonb
    WHERE id = ${connectionId}::uuid AND user_id = ${userId}::uuid
  `;

  return created({ ...createdRow, status: 'active' });
});
