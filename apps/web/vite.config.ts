import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgSrc = (name: string) => resolve(here, `../../packages/${name}/src/index.ts`);
const monorepoRoot = resolve(here, "../..");

// Resolve @esco/* workspace packages straight to their TypeScript sources so
// the dev shell runs with no per-package build step.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@esco/core": pkgSrc("core"),
      "@esco/shared": pkgSrc("shared"),
      "@esco/ladder": pkgSrc("ladder"),
      "@esco/instructions": pkgSrc("instructions"),
      "@esco/simulator": pkgSrc("simulator"),
      "@esco/validator": pkgSrc("validator"),
      "@esco/parser-l5x": pkgSrc("parser-l5x"),
      "@esco/project-actions": pkgSrc("project-actions"),
      "@esco/project-store": pkgSrc("project-store"),
      "@esco/ui": pkgSrc("ui"),
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [monorepoRoot],
    },
  },
});
