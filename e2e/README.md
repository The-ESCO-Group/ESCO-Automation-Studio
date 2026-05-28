# E2E smoke harness

Browser-driven smoke tests that exercise the running app end to end (ladder
editing, simulation, tags, properties, cross-reference, AI assistant, and
L5X / project import-export). They complement the in-process unit tests
(`pnpm test`) by checking the real DOM and user flows.

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
PASS  welcome.mjs      8/8
PASS  driver.mjs       5/5
...
ALL DRIVERS PASS  —  68/68 checks across 10 drivers
```

Exit code is `0` only if every driver passes (`2` if the dev server is not
reachable). To run a single driver: `node e2e/driver.mjs`.

## Drivers

| Driver | Covers |
|---|---|
| `welcome.mjs` | Welcome dashboard, action cards, navigation |
| `driver.mjs` | Open routine, palette, operands, scan |
| `instr.mjs` | Instruction palette groups |
| `tags.mjs` | Tag table: create / rename / describe / delete |
| `props.mjs` | Properties panel per selection |
| `xref.mjs` | Cross reference |
| `ai.mjs` | AI assistant explain / generate / apply |
| `persist.mjs` | Edit → export → reload → import → scan |
| `l5x.mjs` | L5X import + simulation |
| `l5x-branch.mjs` | L5X import with parallel branches |

Artifacts (screenshots, exported fixtures) are written next to the drivers and
are git-ignored.
