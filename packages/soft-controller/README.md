# @esco/soft-controller

The **ESCO SoftController** — an in-process, ESCO-native software controller and
the studio's first stateful software-only "Go Online"-style target.

It is **software, not hardware**. It never claims to be, nor to communicate with, a
physical PLC. Every identity is branded `ESCO SoftController` with `kind: "software"`
and the `ESCO-SOFT-CTRL` catalog number.

## What it does

- **Identity** — controller id, name, `ESCO-SOFT-CTRL` catalog, firmware/runtime
  version, serial number, and live runtime state.
- **Modes** — `program` · `run` · `stopped` · `faulted`.
- **Runtime loading** — accepts ESCO `.easruntime` payloads and validates the
  extension, schema version, integrity checksum, and ESCO-native provenance using
  the existing `@esco/project-actions` native runtime helpers. Invalid/corrupt
  runtimes are rejected honestly (raising a clearable validation fault).
- **Tag memory** — initialized from the runtime power-up image; read/write by
  controller name or program-scoped path (`Program:Name.Tag` or `Name::Tag`).
- **Deterministic scan** — start / stop / reset plus a fixed-step scan tick, driven
  by the existing routine executor (`scanProject`), so ladder and Structured Text,
  program scoping, JSR, and the timer model all run exactly as in offline
  simulation.
- **Software force table** — `forceTag`, `clearForce`, `clearForces`, and
  `listForces` apply local virtual forces before and after each software scan.
- **Fault model** — validation faults and runtime faults, each clearable or
  non-clearable; `clearFaults` recovers the controller only when nothing
  non-clearable remains.
- **Controller image** — `exportImage()` / `serializeImage()` produce a
  checksummed, serializable software image (identity, mode, loaded-runtime
  summary, verbatim runtime text, full tag image, faults) for software
  upload/reconstruction flows.

## Usage

```ts
import { EscoSoftController } from "@esco/soft-controller";

const controller = new EscoSoftController({ name: "Line 1" });
const load = controller.loadRuntimeText(easRuntimeText, "line1.easruntime");
if (!load.ok) throw new Error(load.message); // invalid runtimes are rejected honestly

controller.writeTag("StartPB", true);
controller.startScan();          // -> Run mode
controller.scanOnce(10);         // one deterministic 10ms scan tick
controller.readTag("MotorRun");  // true

const image = controller.exportImage(); // for software upload/reconstruction flows
```

## How it executes a runtime

A `.easruntime` stores routine logic flattened (ladder as neutral rung text,
Structured Text as source lines), ESCO-native UDT/AOI metadata, and compiled
power-up values. The loader rebuilds an executable `PlcProject`, parsing the
neutral rung text back into a ladder AST with `parseRungText` (the inverse of the
serializer that produced it), applies controller- and program-scoped startup
values, and drives the existing scan engine.

## Offline boundary

SoftController loads only ESCO-native `.easruntime` payloads. Its force table is
local software state only. It does not parse `.ACD` files, talk to a physical
controller, download to hardware, upload from hardware, go online, perform online
edits, or set/clear physical PLC forces.
