import { defineConfig } from "vitest/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgSrc = (name: string) => resolve(here, `packages/${name}/src/index.ts`);

// Resolve @esco/* workspace packages to their TypeScript sources so tests run
// with no per-package build step, mirroring apps/web/vite.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      "@esco/core": pkgSrc("core"),
      "@esco/shared": pkgSrc("shared"),
      "@esco/ladder": pkgSrc("ladder"),
      "@esco/instructions": pkgSrc("instructions"),
      "@esco/simulator": pkgSrc("simulator"),
      "@esco/validator": pkgSrc("validator"),
      "@esco/parser-l5x": pkgSrc("parser-l5x"),
      "@esco/project-store": pkgSrc("project-store"),
      "@esco/ui": pkgSrc("ui"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
  },
});
