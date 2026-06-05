# ESCO Automation Studio — MCP server (`@esco/mcp`)

Exposes the **offline ESCO IDE** as [Model Context Protocol](https://modelcontextprotocol.io)
tools so an MCP client (**Claude Code in PowerShell/terminal**, or Claude Desktop)
can inspect and edit PLC projects and drive the Simulation Lab — **using your own
Claude**. No API key lives in this server and no model is called here; it only
exposes tools that reuse the existing `@esco/*` packages.

> **Cost/keys:** this is the zero-key path. The model is whatever your Claude
> client already uses; the Studio holds no key and does no per-token billing.

## Boundaries (unchanged)
Offline/virtual only — no controller communication, no go-online/upload/download,
no `.ACD` or vendor binaries. Every edit is local and review-before-use.

## Build
```powershell
corepack pnpm --filter @esco/mcp build
```
This bundles the server + the ESCO TypeScript packages into a single
`apps/mcp/dist/server.mjs` (plain Node, no runtime deps). Rebuild after changing
any `@esco/*` package.

## Connect from Windows PowerShell (Claude Code)
A project-scoped `.mcp.json` is already at the repo root:
```json
{ "mcpServers": { "esco": { "command": "node", "args": ["apps/mcp/dist/server.mjs"] } } }
```
1. Build once (above).
2. In PowerShell, start Claude Code **in the repo root**:
   ```powershell
   cd "C:\Users\nmodha\Projects\ESCO Automation Studio\02_Source\esco-automation-studio"
   claude
   ```
3. The `esco` server starts automatically and its tools appear as `mcp__esco__*`.
   Ask, e.g.: *"Using the esco tools, create a pump-station simulation, run the
   trip-overload scenario, and give me the report."*

## Live editing — watch Claude work in the open Studio
The server runs a localhost **live bridge** (SSE on `http://127.0.0.1:7393`). When
a Studio window is open, it auto-subscribes and shows a top-center
**"Live: connected to Claude (MCP)"** badge; as Claude edits (create tag, add
rung, open/import project) the Studio updates in real time and flashes
**"Claude is editing…"** — you watch the changes happen.

- **Open the Studio from Claude:** the `esco_open_studio` tool launches it. Point
  it at your install:
  ```powershell
  # desktop app:
  $env:ESCO_STUDIO_PATH = "C:\Path\To\ESCO Automation Studio.exe"
  # or the web app:
  $env:ESCO_STUDIO_URL = "http://localhost:5173"
  ```
  (or pass `{ "path": "..." }` to the tool). Then ask Claude: *"Open the Studio,
  create a tag StartPB, and add a seal-in rung to MainRoutine."*
- **Check who's watching:** `esco_live_status`.
- Override the bridge port with `ESCO_BRIDGE_PORT`. Localhost-only, offline.

### Claude Desktop (optional)
Add to your Claude Desktop MCP config (use an absolute path):
```json
{ "mcpServers": { "esco": { "command": "node",
  "args": ["C:\\Users\\nmodha\\Projects\\ESCO Automation Studio\\02_Source\\esco-automation-studio\\apps\\mcp\\dist\\server.mjs"] } } }
```

## Tools (27)
**Session:** `esco_status`, `esco_boundaries`.
**Live Studio:** `esco_open_studio` (launch the installed Studio), `esco_live_status`.
**PLC project:** `esco_new_project`, `esco_open_project`, `esco_save_project`,
`esco_project_overview`, `esco_list_routines`, `esco_get_routine`, `esco_list_tags`,
`esco_validate`, `esco_create_tag`, `esco_add_rung`.
**L5X (offline XML):** `esco_import_l5x`, `esco_export_l5x`.
**Simulation Lab:** `esco_sim_create`, `esco_sim_status`, `esco_sim_add_device`,
`esco_sim_add_logic`, `esco_sim_add_scenario`, `esco_sim_list_scenarios`,
`esco_sim_run_scenario`, `esco_sim_run_all`, `esco_sim_report`, `esco_sim_save`,
`esco_sim_open`.

## Protocol
Newline-delimited JSON-RPC 2.0 over stdio (`initialize`, `tools/list`,
`tools/call`, `ping`) — zero external dependencies. Logs go to stderr; stdout
carries only protocol messages.
