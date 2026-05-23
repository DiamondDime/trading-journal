/**
 * Next.js instrumentation — captures every server-side render error with its
 * full stack, route, and digest. Without this hook, Next 16's standalone
 * production build masks server errors to a digest only, leaving "Something
 * broke on this page" with no way to trace the root cause.
 *
 * The error.tsx UI still shows the same digest to the user. We just also
 * emit a complete server-side log so the desktop's parent process sees the
 * stack in its captured stderr.
 *
 * `instrumentation.ts` runs in BOTH the nodejs and edge runtimes; we only
 * print on the server (Node) where there's a console to log to.
 */
export async function register() {
  // In the desktop build, expose the in-process PGlite to the sync worker
  // subprocess via a UNIX socket. Boot the DB eagerly so the socket file
  // exists before Electron main spawns the worker (which polls for it).
  //
  // No-op in webapp mode (PGLITE_SOCKET_DIR unset) and in the edge runtime.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.DESKTOP_MODE === "1" &&
    process.env.PGLITE_SOCKET_DIR
  ) {
    try {
      const [{ getPGliteInstance }, { startPgliteSocketServer }] =
        await Promise.all([
          import("./lib/db/client"),
          import("./lib/db/pglite-socket-server"),
        ]);
      const db = await getPGliteInstance();
      await startPgliteSocketServer(db);
    } catch (err) {
      // Surface loudly — the desktop install relies on this for sync.
      // Don't throw: Next.js should still serve the UI even without the
      // worker bridge (manual logging still works).
      console.error("[instrumentation] pglite-socket startup failed:", err);
    }
  }
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string> },
  context: { routeType: string; routePath?: string },
) {
  const e = err as { message?: string; stack?: string; digest?: string };
  const lines = [
    `[server-error] ${request.method} ${request.path} (${context.routeType})`,
    `  digest:  ${e.digest ?? "—"}`,
    `  message: ${e.message ?? String(err)}`,
  ];
  if (e.stack) {
    lines.push(
      "  stack:",
      ...e.stack
        .split("\n")
        .slice(0, 20)
        .map((l) => `    ${l}`),
    );
  }
  console.error(lines.join("\n"));
}
