/**
 * GET  /api/exchanges — list user's connections
 * POST /api/exchanges — create a connection with encrypted credentials
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, created, errors } from '@/lib/api/response';
import { sql } from '@/lib/db/client';
import { CreateExchangeConnectionBody } from '@/lib/db/zod-schemas';
import { encryptCredential, apiKeyHint } from '@/lib/crypto/credentials';

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

  try {
    if (body.credentials.mode === 'api_key') {
      const k = encryptCredential(body.credentials.api_key);
      const s = encryptCredential(body.credentials.api_secret);
      const p = body.credentials.passphrase
        ? encryptCredential(body.credentials.passphrase)
        : null;
      const hint = apiKeyHint(body.credentials.api_key);

      const rows = await sql`
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
      return created(rows[0]);
    }

    const w = encryptCredential(body.credentials.address);
    const rows = await sql`
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
    return created(rows[0]);
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
});
