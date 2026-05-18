/**
 * GET /api/mcp/v1/health
 *
 * Unauthenticated readiness probe. The stdio MCP binary calls this before any
 * real request so it can fail-fast with a useful error if the Next.js
 * subprocess hasn't finished booting yet.
 *
 * We intentionally do NOT call verifyMcpRequest here — the bridge needs to
 * confirm liveness before MCP_TOKEN propagation has settled. The response
 * exposes no privileged data.
 */
import { NextResponse } from 'next/server';
// resolveJsonModule is enabled in tsconfig; this picks up the project version
// without falling back to a runtime fs read. The path is relative because the
// JSON file is in the repo root and the `@/*` alias only covers src/*.
import packageJson from '../../../../../../package.json';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    result: {
      status: 'ok',
      version: packageJson.version,
      appReady: true,
    },
  });
}
