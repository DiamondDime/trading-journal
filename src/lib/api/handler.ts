/**
 * Wrap an API route handler with auth + error handling.
 */
import { AuthError, requireAdmin, requireUser } from '@/lib/auth/server';
import { errors } from '@/lib/api/response';
import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

export type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
export type AuthedHandler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>>; userId: string }
) => Promise<Response>;

export function withAuth(handler: AuthedHandler): Handler {
  return async (req, ctx) => {
    try {
      const user = await requireUser();
      return await handler(req, { ...ctx, userId: user.id });
    } catch (e) {
      return handleError(e);
    }
  };
}

export function withAdmin(handler: AuthedHandler): Handler {
  return async (req, ctx) => {
    try {
      const user = await requireAdmin();
      return await handler(req, { ...ctx, userId: user.id });
    } catch (e) {
      return handleError(e);
    }
  };
}

function handleError(e: unknown): Response {
  if (e instanceof AuthError) {
    return e.code === 'NOT_AUTHENTICATED' ? errors.unauthorized() : errors.forbidden();
  }
  if (e instanceof ZodError) {
    return errors.badRequest('VALIDATION', 'Invalid input', e.issues);
  }
  console.error('[api] unhandled', e);
  return errors.internal();
}

export async function parseBody<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  const json = await req.json().catch(() => ({}));
  return schema.parse(json);
}
