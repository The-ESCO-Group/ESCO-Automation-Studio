import { defineConfig } from "vite";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) => resolve(here, `../../packages/${name}/src/index.ts`);

// Bundle the API host (and the ESCO TypeScript source packages it uses) into a
// single Node ESM file, mirroring apps/mcp. Node builtins stay external. The
// result runs with `node dist/index.mjs` — no per-package build.
export default defineConfig({
  resolve: {
    alias: {
      "@esco/controller-comm": pkg("controller-comm"),
      "@esco/controller-gateway": pkg("controller-gateway"),
      "@esco/core": pkg("core"),
      "@esco/driver-ethernetip": pkg("driver-ethernetip"),
      "@esco/driver-ethernetip-node": pkg("driver-ethernetip-node"),
      "@esco/driver-opcua-node": pkg("driver-opcua-node"),
    },
  },
  build: {
    target: "node20",
    outDir: "dist",
    minify: false,
    emptyOutDir: true,
    lib: {
      entry: {
        index: resolve(here, "src/index.ts"),
        // TEST-ONLY standalone fake EtherNet/IP target for browser E2E/demos.
        "fake-target": resolve(here, "src/fake-target.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.mjs`,
    },
    rollupOptions: {
      external: [
        /^node:/,
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        // Dynamic OPTIONAL import inside the OPC UA stack's mutex dependency
        // (@ster5/global-mutex → proper-lockfile). Rollup cannot resolve it
        // statically; leaving it external keeps the bundle building. The OPC
        // UA certificate-store path that would exercise it is not used by the
        // current read-only routes — revisit when the OPC UA driver slice
        // wires real endpoints.
        "proper-lockfile",
      ],
    },
  },
});
