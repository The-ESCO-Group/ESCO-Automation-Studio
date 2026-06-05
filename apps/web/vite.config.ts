import { defineConfig, type Plugin, type Connect } from "vite";
import type { ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgSrc = (name: string) => resolve(here, `../../packages/${name}/src/index.ts`);
const monorepoRoot = resolve(here, "../..");

// Same-origin proxy for the opt-in online AI assistant. The browser posts the
// Messages-API body to /api/ai; this middleware injects ANTHROPIC_API_KEY from
// the server environment and forwards to Anthropic, so the key NEVER reaches the
// browser. Keep this in sync with AGENT_PROXY_PATH in @esco/ai-assistant. For a
// production deployment, replicate this as a real server route (see docs).
const AI_PROXY_PATH = "/api/ai";

function aiProxyPlugin(): Plugin {
  const handle = async (req: Connect.IncomingMessage, res: ServerResponse) => {
    const sendJson = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      sendJson(500, { error: { message: "AI proxy not configured: set ANTHROPIC_API_KEY in the server environment." } });
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: Buffer.concat(chunks).toString("utf8"),
      });
      sendJson(upstream.status, await upstream.json());
    } catch {
      sendJson(502, { error: { message: "AI proxy upstream error." } });
    }
  };
  const mount = (server: { middlewares: Connect.Server }) => {
    server.middlewares.use(AI_PROXY_PATH, (req, res, next) =>
      req.method === "POST" ? void handle(req, res) : next(),
    );
  };
  return { name: "esco-ai-proxy", configureServer: mount, configurePreviewServer: mount };
}

// Resolve @esco/* workspace packages straight to their TypeScript sources so
// the dev shell runs with no per-package build step.
export default defineConfig({
  plugins: [react(), aiProxyPlugin()],
  resolve: {
    alias: {
      "@esco/ai-assistant": pkgSrc("ai-assistant"),
      "@esco/compare": pkgSrc("compare"),
      "@esco/controller-comm": pkgSrc("controller-comm"),
      "@esco/core": pkgSrc("core"),
      "@esco/hmi-model": pkgSrc("hmi-model"),
      "@esco/shared": pkgSrc("shared"),
      "@esco/ladder": pkgSrc("ladder"),
      "@esco/instructions": pkgSrc("instructions"),
      "@esco/simulator": pkgSrc("simulator"),
      "@esco/validator": pkgSrc("validator"),
      "@esco/parser-l5x": pkgSrc("parser-l5x"),
      "@esco/project-actions": pkgSrc("project-actions"),
      "@esco/project-store": pkgSrc("project-store"),
      "@esco/soft-controller": pkgSrc("soft-controller"),
      "@esco/sim-lab": pkgSrc("sim-lab"),
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
