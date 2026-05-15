/**
 * Server-side auth helpers. Use from Server Components, API routes, server actions.
 */
import { createClient } from '@/lib/supabase/server';
import type { Profile, UserId } from '@/types/canonical';

export async function getCurrentUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('NOT_AUTHENTICATED');
  return user;
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, display_name, timezone, base_currency, created_at, updated_at')
    .eq('id', user.id)
    .single();

  return profile
    ? {
        ...profile,
        id: profile.id as UserId,
      }
    : null;
}

export async function isAdmin(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('is_admin', { p_user_id: userId });
  return !error && Boolean(data);
}

export async function requireAdmin() {
  const user = await requireUser();
  const admin = await isAdmin(user.id);
  if (!admin) throw new AuthError('NOT_ADMIN');
  return user;
}

export class AuthError extends Error {
  constructor(public code: 'NOT_AUTHENTICATED' | 'NOT_ADMIN') {
    super(code);
    this.name = 'AuthError';
  }
}
