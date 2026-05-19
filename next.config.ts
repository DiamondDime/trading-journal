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
};

export default nextConfig;
