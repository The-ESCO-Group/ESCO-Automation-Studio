# ESCO Automation Studio

> An ESCO-native PLC engineering IDE for authoring, simulating, validating, importing, and safely monitoring ladder logic.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-24C8DB?logo=tauri&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)
![Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)
![Status](https://img.shields.io/badge/status-internal%20preview-blue)

ESCO Automation Studio is a desktop and web engineering environment for
vendor-neutral PLC work without becoming a clone of any vendor workstation.
Engineers can author and review IEC/Logix-style control logic offline today,
while Goal B adds a phased, ESCO-owned online architecture with Allen-Bradley as
the first high-value adapter track and a formal Target Adapter contract for
future PLC families. The current stack includes an ESCO EtherNet/IP/CIP backend
path tested end-to-end against a loopback fake target, but it is not
field-validated against plant hardware and does not perform physical downloads,
online edits, forces, mode changes, or `.ACD` operations. Every change to a
project flows through a
single typed, validated action layer, so the model can never be mutated out from
under the IDE.

> ⚠️ **Safe phased online.** This is an engineering and simulation aid with a
> read-only ESCO gateway foundation — not a replacement for any commissioned
> vendor workstation, and not cleared for modifying physical hardware.

---

## Highlights

### ✍️ Author
- Editable **ladder logic** stored as a semantic AST (not text), with parallel/nested branch
  editing, copy / duplicate / paste, and full undo / redo.
- Editable **Structured Text** with conservative live structural warnings and `.L5X`
  line-by-line round-trip preservation.
- **120+ Logix instructions** executed offline across bit, timer/counter, math, trig, compare,
  data-movement, conversion, file/array, sequencer, bit-shift, string/ASCII, and program-control
  families — plus model-only families (PID, GuardLogix safety, motion, messaging) that are
  parsed, validated, and round-tripped.

### ▶️ Simulate
- **Scan-cycle simulation** with a Watch panel (Scan Once / Run / Reset), including array,
  UDT-member, and program-scoped tag paths.
- A conservative **Structured Text execution subset** (assignments, expressions, IF / CASE,
  bounded loops, and `JSR` / `SBR` / `RET` calls).
- **Debugging** via a per-instruction power-flow trace and a force table for what-if testing.
- **Sim Lab** — a process-simulation sandbox for exercising logic against modeled equipment.

### ✅ Validate
- Rule-based **validation engine**: undefined tags, type mismatches, missing operands,
  unresolved `JMP`/`LBL` labels, array-index bounds, duplicate / alias resolution, AOI / UDT /
  module / task capacity limits, and GuardLogix safety-partition constraints.

### 🔁 Interoperate
- **Studio 5000 L5X import / export** (export is review-only) preserving branch topology, tags,
  UDTs, Add-On Instructions, I/O modules, tasks, and extensive controller metadata.
- Versioned native **`.plcproj.json`** persistence with browser autosave, recovery, and a
  crash-safe error boundary.
- An offline, searchable **I/O device catalog** and module-tree builder.

### 🔎 Review & navigate
- **Cross-reference**, offline global **find / replace**, and **routine / project compare** by
  logic fingerprint with side-by-side diffs.
- **Structure viewers** for Add-On Instructions, UDTs, and I/O modules.
- An **HMI authoring** foundation — screens, bindings, model-only alarms / trends / data
  logs, and an offline runtime preview.

### 🤖 AI assistant
- Offline, rule-based by default, with an **optional opt-in** external-model seam. All changes
  are previewable plans applied only through the action layer — the assistant has no controller,
  `.ACD`, or filesystem access.

> Looking for the exhaustive, capability-by-capability list? See
> [`docs/current-features.md`](docs/current-features.md). Goal B online
> architecture is tracked in
> [`docs/goal-b-online-architecture.md`](docs/goal-b-online-architecture.md).

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Language | TypeScript (pnpm workspace monorepo) |
| Web IDE | React + Vite |
| Desktop | Tauri (Windows shell) |
| Testing | Vitest (unit) · Playwright (browser E2E) |
| Services | Node (API + MCP server boundaries) |

---

## Project structure

A pnpm monorepo built in dependency order; React lives only in `apps/web`.

```text
core → ladder → instructions → simulator → validator
                             → project-store → parser-l5x → project-actions → ai-assistant

apps/* depend on packages/*  (never the reverse)
```

### Apps

| App | Description |
| --- | --- |
| `apps/web` | React + Vite IDE shell |
| `apps/desktop` | Tauri Windows desktop build |
| `apps/api` | Backend service |
| `apps/mcp` | Model Context Protocol server boundary |

### Packages

| Package | Responsibility |
| --- | --- |
| `core` | PLC domain model + data-type catalog |
| `ladder` | Semantic ladder AST + immutable edits |
| `instructions` | Instruction registry — the single source of instruction metadata |
| `simulator` | Offline scan-cycle runtime |
| `validator` | Rule-based validation |
| `project-store` | `.plcproj.json` serialize / deserialize |
| `parser-l5x` | Studio 5000 L5X import and review-only export |
| `project-actions` | **The only sanctioned way to mutate a project** (typed, immutable, validated) |
| `controller-comm` | Controller-command safety gate / online-readiness scaffold (physical commands blocked by default) |
| `controller-gateway` | Goal B online session/gateway foundation, driver contract, simulator adapter, match-check gates |
| `driver-ethernetip` | ESCO-owned EtherNet/IP/CIP codecs and sans-I/O read-only session core |
| `driver-ethernetip-node` | Backend-only TCP transport and gateway driver for the read-only EtherNet/IP path |
| `hmi-model` | HMI View Designer model, bindings, alarms / trends, runtime preview |
| `sim-lab` | Process-simulation sandbox |
| `soft-controller` | Soft-controller runtime build / load |
| `compare` | Routine / project diff by logic fingerprint |
| `ai-assistant` | Offline assistant + optional external-model seam |
| `ui` / `shared` | Shared UI components and utilities |

---

## Getting started

### Prerequisites

- **Node.js ≥ 20** (developed on Node 24)
- **pnpm 9** — available through Corepack (`corepack pnpm …`)

### Install & run

```bash
corepack pnpm install     # install dependencies
corepack pnpm dev         # start the web IDE at http://localhost:5173
```

> If `pnpm` is already on your `PATH`, you can drop the `corepack` prefix.

### Try the demo

1. Run `corepack pnpm dev` and open <http://localhost:5173>.
2. The **Welcome dashboard** lists what the tool does, plus quick actions.
3. **Open Demo Routine** → toggle `StartPB` in **Watch** → **Scan Once** → `MotorRun`
   energizes (a seal-in starter).

Full walkthrough: [`docs/demo-script.md`](docs/demo-script.md).

---

## Scripts

| Command | Description |
| --- | --- |
| `corepack pnpm dev` | Start the web IDE (port 5173) |
| `corepack pnpm dev:desktop` | Run the Tauri desktop shell |
| `corepack pnpm build` | Build the web app |
| `corepack pnpm build:desktop` | Build the desktop app |
| `corepack pnpm typecheck` | Type-check every package |
| `corepack pnpm test` | Run the Vitest suite |
| `corepack pnpm e2e` | Browser E2E smoke tests (requires the dev server) |

---

## Safety & limitations

- **Goal B online is phased.** The ESCO Controller Gateway foundation, Online
  toolbar/state surface, backend API host, web gateway client, and ESCO
  EtherNet/IP/CIP read-only path and a backend-only generic OPC UA read-only
  path exist. The EtherNet/IP path is tested against an in-process fake target;
  OPC UA is tested through an injected client adapter, not field-validated
  hardware. OPC DA remains a generic placeholder, and none of these paths
  introduce FactoryTalk/RSLinx runtime dependencies. Physical download, online
  editing, mode changes, forces, and fault clearing remain blocked unless a
  future validated gateway path
  explicitly enables them.
- **No `.ACD` compile / decompile.** Only `.plcproj.json` (read / write) and review-only
  `.L5X` import / export.
- **AI is offline / local by default.** The optional online AI agent is off by default, uses
  *your own* API key (never bundled or committed), and still edits only by proposing actions you
  explicitly **Apply** through `project-actions`.
- **Not a replacement for Studio 5000** — an offline engineering and simulation aid.

More detail: [`docs/limitations.md`](docs/limitations.md) ·
[`docs/online-ai-safety.md`](docs/online-ai-safety.md) ·
[`docs/roadmap.md`](docs/roadmap.md).

---

## Documentation

| Topic | Document |
| --- | --- |
| Architecture | [`docs/current-architecture.md`](docs/current-architecture.md) |
| Full feature list | [`docs/current-features.md`](docs/current-features.md) |
| Project actions (mutation layer) | [`docs/project-actions.md`](docs/project-actions.md) |
| AI assistant | [`docs/ai-assistant.md`](docs/ai-assistant.md) |
| Online AI safety | [`docs/online-ai-safety.md`](docs/online-ai-safety.md) |
| Sim Lab | [`docs/sim-lab.md`](docs/sim-lab.md) |
| Native file formats | [`docs/esco-native-formats.md`](docs/esco-native-formats.md) |
| Demo script | [`docs/demo-script.md`](docs/demo-script.md) |
| Limitations | [`docs/limitations.md`](docs/limitations.md) |
| Roadmap | [`docs/roadmap.md`](docs/roadmap.md) |

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Pull requests must respect the core architecture rules:

- The UI must **not** own the PLC model — it lives in `packages/core`.
- All project mutations go through `packages/project-actions`.
- The semantic ladder AST and the instruction registry are the **sources of truth**.

Changes are tracked in [`CHANGELOG.md`](CHANGELOG.md).

---

## License

Internal / proprietary engineering tool. All rights reserved. Not licensed for redistribution.
