# E2E smoke harness

Browser-driven smoke tests that exercise the running app end to end. They cover
the Studio shell, menus/dialogs, ladder editing, instruction authoring,
simulation, tags, properties, cross-reference, guarded controller workflows,
AI assistant, HMI authoring/live preview, project persistence, L5X/component
flows, and desktop startup. They complement the in-process unit tests
(`pnpm test`) by checking the real DOM and user flows.

Controller smoke tests exercise guarded UI/session behavior only. They do not
connect to, upload from, download to, or online-edit a physical PLC.

## Prerequisites

- **Dev server running** on `http://localhost:5173`:
  ```
  pnpm dev
  ```
- **Microsoft Edge** installed — the drivers launch Chromium via
  `channel: "msedge"` (no separate browser download needed). `playwright-core`
  is installed as a dev dependency.

## Run

In a second terminal, with the dev server up:

```
pnpm e2e
```

The runner executes each driver and prints an aggregate summary, e.g.:

```
PASS  welcome.mjs      12/12
PASS  controller.mjs   31/31
...
ALL DRIVERS PASS  —  1208/1208 checks across 90 drivers
```

Exit code is `0` only if every driver passes (`2` if the dev server is not
reachable). To run a single driver: `node e2e/driver.mjs`.

Set `E2E_URL` to point the suite at a non-default server:

```
$env:E2E_URL="http://localhost:5174/"; pnpm e2e
```

Goal B's real EtherNet/IP browser smoke (`escoonline-enip.mjs`) also needs the
ESCO API host and the test-only loopback target:

```
pnpm --filter @esco/api dev
node apps/api/dist/fake-target.mjs
node e2e/escoonline-enip.mjs
```

`E2E_ENIP_TARGET` can point it at a different `host:port`. This driver proves
the ESCO UI -> API -> gateway -> EtherNet/IP driver -> TCP loopback path only;
it is not hardware validation and does not use vendor runtime software.

## Drivers

The aggregate runner orders known high-signal flows first, then auto-discovers
any other `.mjs` driver in this directory. Current coverage includes:

| Group | Representative drivers |
|---|---|
| Shell and navigation | `desktop-startup.mjs`, `welcome.mjs`, `dialogs.mjs`, `ribbon.mjs`, `scrollbars.mjs`, `shortcuts.mjs`, `workbench.mjs`, `ui-layout.mjs` |
| Ladder authoring | `driver.mjs`, `instr.mjs`, `newinstr.mjs`, `ladderedit.mjs`, `branchedit.mjs`, `nestedbranch.mjs`, `laddertoolbar.mjs`, `laddercontext.mjs`, `ladder-offline-edits.mjs`, `ladder-add-delete.mjs` |
| Editing state | `undoredo.mjs`, `copypaste.mjs`, `dirtystate.mjs`, `recovery.mjs`, `persist.mjs` |
| Data and diagnostics | `tags.mjs`, `props.mjs`, `inspector.mjs`, `search.mjs`, `xref.mjs`, `arrayvalues.mjs`, `structure.mjs`, `structureedit.mjs`, `verifyoutput.mjs`, `diagnostics.mjs` |
| Controller and runtime | `controller.mjs`, `virtualcontroller.mjs`, `readonly-monitoring.mjs`, `taskmonitor.mjs`, `taskscanstats.mjs`, `forcetrace.mjs`, `easrt.mjs` |
| Import/export | `l5x.mjs`, `l5x-branch.mjs`, `binaryguard.mjs`, `component-export.mjs`, `component-import.mjs`, `stsource.mjs` |
| HMI and assistant | `hmidesigner.mjs`, `hmilive.mjs`, `hmilive-authoring.mjs`, `hmi-layout.mjs`, `ai.mjs`, `aiagent.mjs` |

Artifacts (screenshots, exported fixtures) are written next to the drivers and
are git-ignored.
