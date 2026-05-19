import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the workspace root so Next's standalone bundle layout doesn't nest
  // server.js under a project-name subdirectory. Next otherwise infers root
  // from the nearest lockfile, which on this machine is `~/package-lock.json`
  // — that pushes the bundle to `.next/standalone/crypto-spread-journal/server.js`
  // and breaks the electron main process's path resolution.
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
  // PGlite ships its WASM runtime + contrib extensions (citext.tar.gz,
  // pgcrypto.tar.gz, …) as side-loaded binary assets that the package's own
  // code resolves via `import.meta.url`. Next's bundler otherwise treats
  // those `.tar.gz` files as static assets and rewrites paths to
  // `/_next/static/media/<hash>.gz`, which PGlite then can't find at runtime.
  // Marking the package as server-external keeps the require() chain plain
  // CommonJS so PGlite's own loader finds its bundles in node_modules.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
