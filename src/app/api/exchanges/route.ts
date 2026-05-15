/**
 * GET  /api/exchanges — list user's connections
 * POST /api/exchanges — create + sync-validate a new connection
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, created, errors } from '@/lib/api/response';
import { createClient } from '@/lib/supabase/server';
import { CreateExchangeConnectionBody } from '@/lib/db/zod-schemas';

export const GET = withAuth(async (_req, { userId }) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('exchange_connections')
    .select('id, exchange_code, label, connection_type, api_key_hint, wallet_chain, status, status_message, last_sync_at, last_fill_at, fills_synced, permissions_json, created_at, updated_at')
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
    .select('auth_mode, venue_type')
    .eq('code', body.exchange)
    .single();

  if (!catalog) return errors.notFound(`Unknown exchange: ${body.exchange}`);

  if (catalog.auth_mode !== body.credentials.mode) {
    return errors.unprocessable(
      'CREDENTIAL_MISMATCH',
      `${body.exchange} requires ${catalog.auth_mode}, got ${body.credentials.mode}`
    );
  }

  // Insert connection row
  const { data: conn, error: insertErr } = await supabase
    .from('exchange_connections')
    .insert({
      user_id: userId,
      exchange_code: body.exchange,
      label: body.label,
      connection_type: body.credentials.mode,
      status: 'pending',
    })
    .select('id')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      return errors.conflict('DUPLICATE_LABEL', 'A connection with that label already exists for this exchange');
    }
    return errors.internal(insertErr.message);
  }

  // Store secrets in Vault via security-definer RPC
  if (body.credentials.mode === 'api_key') {
    const { error: vaultErr } = await supabase.rpc('store_exchange_api_credentials', {
      p_connection_id: conn.id,
      p_api_key: body.credentials.api_key,
      p_api_secret: body.credentials.api_secret,
      p_api_passphrase: body.credentials.passphrase ?? null,
    });
    if (vaultErr) {
      await supabase.from('exchange_connections').delete().eq('id', conn.id);
      return errors.internal(`Failed to store credentials: ${vaultErr.message}`);
    }
  } else {
    const { error: vaultErr } = await supabase.rpc('store_wallet_address', {
      p_connection_id: conn.id,
      p_wallet_address: body.credentials.address,
      p_chain: body.credentials.chain ?? null,
    });
    if (vaultErr) {
      await supabase.from('exchange_connections').delete().eq('id', conn.id);
      return errors.internal(`Failed to store wallet: ${vaultErr.message}`);
    }
  }

  // Worker will validate + first-sync this connection on its next tick.
  // For now we mark it pending; worker flips to active on successful first sync.

  const { data: finalConn } = await supabase
    .from('exchange_connections')
    .select('id, exchange_code, label, connection_type, api_key_hint, wallet_chain, status, created_at')
    .eq('id', conn.id)
    .single();

  return created(finalConn);
});
