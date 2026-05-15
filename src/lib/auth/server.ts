/**
 * v1 auth = none. Single-user local app. User ID comes from APP_USER_ID env var.
 *
 * To re-enable auth later: replace getCurrentUser with a real session lookup,
 * keep this module's signatures unchanged, and existing API routes still work.
 */
import { sql } from '@/lib/db/client';
import type { Profile, UserId } from '@/types/canonical';

function getAppUserId(): UserId {
  const id = process.env.APP_USER_ID;
  if (!id) {
    throw new AuthError('NOT_AUTHENTICATED');
  }
  return id as UserId;
}

export async function getCurrentUser(): Promise<{ id: UserId; email: string } | null> {
  const id = process.env.APP_USER_ID;
  if (!id) return null;

  const rows = await sql<{ id: string; email: string }[]>`
    SELECT u.id, u.email
    FROM auth.users u
    WHERE u.id = ${id}::uuid
  `;
  return rows[0] ? { id: rows[0].id as UserId, email: rows[0].email } : null;
}

export async function requireUser() {
  const id = getAppUserId();
  return { id };
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const id = process.env.APP_USER_ID;
  if (!id) return null;

  const rows = await sql<Profile[]>`
    SELECT id, email, display_name, timezone, base_currency, created_at, updated_at
    FROM public.profiles
    WHERE id = ${id}::uuid
  `;
  return rows[0] ?? null;
}

export async function isAdmin(userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM public.allowlist a
    JOIN public.profiles p ON p.email = a.email
    WHERE p.id = ${userId}::uuid AND a.role = 'admin'
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!(await isAdmin(user.id))) throw new AuthError('NOT_ADMIN');
  return user;
}

export class AuthError extends Error {
  constructor(public code: 'NOT_AUTHENTICATED' | 'NOT_ADMIN') {
    super(code);
    this.name = 'AuthError';
  }
}
