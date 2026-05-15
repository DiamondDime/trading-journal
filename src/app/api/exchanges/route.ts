/**
 * GET  /api/exchanges — list user's connections (metadata only — no ciphertext exposed)
 * POST /api/exchanges — create a connection with encrypted credentials
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, created, errors } from '@/lib/api/response';
import { createClient } from '@/lib/supabase/server';
import { CreateExchangeConnectionBody } from '@/lib/db/zod-schemas';
import { encryptCredential, apiKeyHint } from '@/lib/crypto/credentials';

export const GET = withAuth(async (_req, { userId }) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('exchange_connections')
    .select(
      'id, exchange_code, label, connection_type, api_key_hint, wallet_chain, status, status_message, last_sync_at, last_fill_at, fills_synced, permissions_json, created_at, updated_at'
    )
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) return errors.internal(error.message);
  return ok(data ?? []);
});

export const POST = withAuth(async (req, { userId }) => {
  const body = await parseBody(req, CreateExchangeConnectionBody);
  const supabase = await createClient();

  // Validate exchange code matches credentials.mode
  const { data: catalog } = await supabase
    .from('exchange_catalog')
    .select('auth_mode')
    .eq('code', body.exchange)
    .single();

  if (!catalog) return errors.notFound(`Unknown exchange: ${body.exchange}`);
  if (catalog.auth_mode !== body.credentials.mode) {
    return errors.unprocessable(
      'CREDENTIAL_MISMATCH',
      `${body.exchange} requires ${catalog.auth_mode}, got ${body.credentials.mode}`
    );
  }

  // Encrypt credentials at app layer
  const insertPayload: Record<string, unknown> = {
    user_id: userId,
    exchange_code: body.exchange,
    label: body.label,
    connection_type: body.credentials.mode,
    status: 'pending',
  };

  if (body.credentials.mode === 'api_key') {
    const k = encryptCredential(body.credentials.api_key);
    const s = encryptCredential(body.credentials.api_secret);
    insertPayload.api_key_ciphertext = k.ciphertext;
    insertPayload.api_key_nonce = k.nonce;
    insertPayload.api_secret_ciphertext = s.ciphertext;
    insertPayload.api_secret_nonce = s.nonce;
    insertPayload.api_key_hint = apiKeyHint(body.credentials.api_key);
    if (body.credentials.passphrase) {
      const p = encryptCredential(body.credentials.passphrase);
      insertPayload.api_passphrase_ciphertext = p.ciphertext;
      insertPayload.api_passphrase_nonce = p.nonce;
    }
  } else {
    const w = encryptCredential(body.credentials.address);
    insertPayload.wallet_address_ciphertext = w.ciphertext;
    insertPayload.wallet_address_nonce = w.nonce;
    insertPayload.wallet_chain = body.credentials.chain ?? null;
  }

  // chk_api_or_wallet constraint allows pending status with no ciphertext;
  // we're inserting both ciphertext + status='pending' in one shot, which satisfies it.
  const { data, error } = await supabase
    .from('exchange_connections')
    .insert(insertPayload)
    .select(
      'id, exchange_code, label, connection_type, api_key_hint, wallet_chain, status, created_at'
    )
    .single();

  if (error) {
    if (error.code === '23505') {
      return errors.conflict('DUPLICATE_LABEL', 'A connection with that label already exists for this exchange');
    }
    return errors.internal(error.message);
  }

  // Worker will pick this up on its next sync tick.
  return created(data);
});
