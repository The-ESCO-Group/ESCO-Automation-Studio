# Real L5X Project Gap Analysis — TAURA01_CR

This document records what a **real, large Studio 5000 project** (`TAURA01_CR.L5X`)
actually contains, what ESCO Automation Studio handles today, and where ESCO still
lacks parity. It is the human-readable companion to the
[`analyzeProjectStructure`](../packages/project-actions/src/project-structure-analysis.ts)
analyzer, which produces the same structural report programmatically from any
imported `PlcProject`.

> **Scope / honesty note.** This is an **analysis and reporting foundation only.**
> It measures the gap so the work can be prioritized. It does **not** implement
> FBD editing/execution, PlantPAx faceplates, drive/module Add-on Profiles, alarm
> definitions, or any controller-online behavior. Nothing here claims ESCO has
> reached parity in those areas — the opposite: it inventories what is missing.

## What was found in TAURA01_CR.L5X

A single ControlLogix/process application of substantial size:

| Metric | Count |
| --- | --- |
| Programs | 248 |
| Routines (total) | 1,714 |
| &nbsp;&nbsp;— Relay Ladder (RLL) | 1,097 |
| &nbsp;&nbsp;— Function Block (FBD) | 614 |
| &nbsp;&nbsp;— Structured Text (ST) | 3 |
| Rungs (RLL) | 5,856 |
| I/O modules | 311 |
| Add-On Instructions (AOIs) | 26 |
| User-Defined Types (UDTs) | 44 |

**Feature signals detected**

- **PlantPAx / process blocks** — process-library AOIs and UDTs (e.g. `P_*`,
  `raC_*`/`raP_*`, valve/analog/digital/PID objects). ~36% of routines are FBD,
  which is the hallmark of a PlantPAx process application.
- **Specialty modules requiring Add-on Profiles** — PowerFlex drives, 5094 FLEX
  5000 I/O, HART analog I/O, and EtherNet/IP bridge modules (EN2T/EN4TR family).
- **Large-project scale** — 248 programs / 1,714 routines / 311 modules is far
  above the size where naive in-memory navigation and search stay comfortable.

These same facts fall straight out of the analyzer's report fields
(`routineCountByLanguage`, `aoi`, `udt`, `io`, `processSignals`, `moduleSignals`,
`thresholds`) and its ordered `gaps[]` array.

## What ESCO already handles

ESCO imports and represents the **structure and metadata** of a project like this
faithfully and offline:

- **Project tree** — controllers, tasks (continuous/periodic/event), programs,
  routines, and tags (controller- and program-scoped), with descriptions.
- **Ladder (RLL)** — full import to an editable ladder AST, offline simulation of
  a broad instruction subset, and editing.
- **Structured Text** — import + editable source with a conservative offline
  execution subset.
- **FBD / SFC** — imported and **preserved read-only** for inspection (never
  executed or edited).
- **AOIs / UDTs** — imported as metadata: AOI parameters, local tags, routine
  names, protection flag; UDT members with data types, dimensions, radix, and
  bit-overlay layout. Largest definitions are surfaced by the analyzer.
- **I/O configuration** — module identity (catalog, vendor, product type/code,
  revision, keying), ports, and connections (RPI, type, priority, trigger) as
  read-only metadata.
- **Controller metadata** — redundancy, safety (GuardLogix), security, wall-clock,
  time-sync, CST, and Ethernet configuration, all preserved read-only.
- **Trends / Quick Watch lists**, when present.

The analyzer reports all of the above as presence flags and counts, so a reviewer
can see at a glance which Logix features a project leans on.

## What ESCO still lacks (the gaps)

The analyzer emits an ordered `gaps[]` array; for `TAURA01_CR` it produces (most
severe first):

1. **Function Block Diagram (FBD) — critical.** 614 FBD routines (≈36%) are
   preserved read-only. ESCO has no Studio-style FBD editor (sheets/blocks/wires/
   pins) and no offline FBD execution model.
2. **Large-project navigation / performance — critical.** 248 programs / 1,714
   routines / 311 modules exceed the navigation/search thresholds (100 programs /
   500 routines / 50 modules). No virtualized tree, indexed search, or lazy editor
   loading proven at this scale yet.
3. **PlantPAx / process library — high–critical.** Process AOIs/UDTs are imported
   as metadata, but there is no rich PlantPAx faceplate/block parameter workflow
   and no process-object runtime behavior.
4. **Advanced module profiles (AOP) — high.** Module identity/connection metadata
   exists, but there are no AOP-style configuration tabs/diagnostics for PowerFlex
   drives, 5094 FLEX I/O, HART I/O, or EN2T/EN4TR bridges.
5. **Alarm definitions / process alarms — high** (when detected). Alarm-bearing
   types/objects import as ordinary tags/UDTs; there is no first-class
   `AlarmDefinitions` model or alarm configuration/monitoring UI.
6. **PhaseManager / process / PID — medium–high** (when detected). Phase and PID
   logic import as routines/AOIs/tags, but loops and equipment phases have no
   dedicated review/tuning surface.

Each gap in the report carries `area`, `severity`, `evidence`,
`currentEscoSupport`, `missingForParity`, and `recommendedNextStep`, so the
inventory is actionable rather than just descriptive.

## Recommended priority order

Driven by prevalence in real process projects and by review value:

1. **FBD viewer/editor parity** — 614 FBD routines here are read-only today; a
   viewer (then editor/execution) is the single biggest fidelity gap.
2. **PlantPAx AOI/UDT/block inspector** — surface process-object parameters,
   members, and structure for the PlantPAx library this project is built on.
3. **PowerFlex / 5094 / HART module profile UI** — AOP-style tabs and diagnostics
   for the specialty modules detected in the I/O tree.
4. **AlarmDefinitions / process alarms UI** — a first-class alarm model and review
   surface.
5. **Large-project navigation / search performance** — virtualization, an
   incremental search/cross-reference index, and lazy editor loading at 200+
   programs / 1,500+ routines / 300+ modules.
6. **PhaseManager / process / PID review upgrades** — equipment-phase state-model
   review and PID/process-loop tuning/review.

## How to reproduce the analysis

```ts
import { analyzeProjectStructure } from "@esco/project-actions";

const report = analyzeProjectStructure(project); // project: imported PlcProject
console.log(report.routineCountByLanguage, report.gaps);
```

The function is pure and deterministic: the same project always yields the same
report, every ranked list is stably sorted, and no project state is mutated. See
`packages/project-actions/src/project-structure-analysis.test.ts` for synthetic
fixtures that exercise the language counts, top-type ranking, UDT/AOI sizing,
module detection, and each gap classification.
