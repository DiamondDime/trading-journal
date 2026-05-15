/**
 * Standard JSON response envelope: { data } or { error: { code, message, details? } }.
 */
import { NextResponse } from 'next/server';

export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiResponse<T = unknown> = { data: T } | { error: ApiError };

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T) {
  return ok(data, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function error(
  code: string,
  message: string,
  status: number,
  details?: unknown
) {
  const payload: { error: ApiError } = { error: { code, message } };
  if (details !== undefined) payload.error.details = details;
  return NextResponse.json(payload, { status });
}

export const errors = {
  unauthorized: () => error('UNAUTHORIZED', 'Authentication required', 401),
  forbidden: (msg = 'Forbidden') => error('FORBIDDEN', msg, 403),
  notFound: (msg = 'Not found') => error('NOT_FOUND', msg, 404),
  conflict: (code: string, msg: string, details?: unknown) =>
    error(code, msg, 409, details),
  badRequest: (code: string, msg: string, details?: unknown) =>
    error(code, msg, 400, details),
  unprocessable: (code: string, msg: string, details?: unknown) =>
    error(code, msg, 422, details),
  rateLimited: (retryAfter?: number) => {
    const res = error('RATE_LIMITED', 'Too many requests', 429);
    if (retryAfter) res.headers.set('Retry-After', String(retryAfter));
    return res;
  },
  internal: (msg = 'Internal server error') => error('INTERNAL', msg, 500),
};
