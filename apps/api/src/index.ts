import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4000);

/**
 * Minimal API stub. Runs on Node's native TypeScript support (no build step).
 * Real routes (project CRUD, validation, simulation) are added in later phases.
 */
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "esco-automation-studio-api" }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`ESCO Automation Studio API listening on http://localhost:${PORT}`);
});
