/**
 * ESCO Automation Studio API host entry point.
 *
 * Serves the ESCO Controller Gateway over HTTP so the web UI reaches online
 * controller data only through ESCO-owned layers (Goal B rule 6). The real
 * EtherNet/IP driver lives behind the gateway in this process; the browser
 * bundle keeps placeholders.
 *
 * Build/run mirrors apps/mcp: `vite build` bundles workspace TS sources into
 * dist/index.mjs, then `node dist/index.mjs` runs it — no per-package build.
 */

import { createApiServer } from "./server";

const PORT = Number(process.env.PORT ?? 4000);

createApiServer().listen(PORT, () => {
  console.log(`ESCO Automation Studio API listening on http://localhost:${PORT}`);
  console.log(`ESCO Controller Gateway routes mounted at /api/gateway`);
});
