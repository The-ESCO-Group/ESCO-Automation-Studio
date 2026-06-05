import { defineConfig } from "vite";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) => resolve(here, `../../packages/${name}/src/index.ts`);

// Bundle the MCP server (and the ESCO TypeScript source packages it uses) into a
// single Node ESM file, mirroring apps/web's alias setup. Node builtins stay
// external. The result runs with `node dist/server.mjs` — no per-package build.
export default defineConfig({
  resolve: {
    alias: {
      "@esco/ai-assistant": pkg("ai-assistant"),
      "@esco/compare": pkg("compare"),
      "@esco/controller-comm": pkg("controller-comm"),
      "@esco/core": pkg("core"),
      "@esco/hmi-model": pkg("hmi-model"),
      "@esco/shared": pkg("shared"),
      "@esco/ladder": pkg("ladder"),
      "@esco/instructions": pkg("instructions"),
      "@esco/simulator": pkg("simulator"),
      "@esco/validator": pkg("validator"),
      "@esco/parser-l5x": pkg("parser-l5x"),
      "@esco/project-actions": pkg("project-actions"),
      "@esco/project-store": pkg("project-store"),
      "@esco/soft-controller": pkg("soft-controller"),
      "@esco/sim-lab": pkg("sim-lab"),
    },
  },
  build: {
    target: "node20",
    outDir: "dist",
    minify: false,
    emptyOutDir: true,
    lib: {
      entry: resolve(here, "src/server.ts"),
      formats: ["es"],
      fileName: () => "server.mjs",
    },
    rollupOptions: {
      external: [/^node:/, ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
  },
});
