# ESCO Simulation Lab

The ESCO Simulation Lab is an **offline, virtual, deterministic** workspace for
automation engineers to create, configure, simulate, test, and report on virtual
automation systems. It is implemented in the original ESCO UI/UX with
ESCO-native file/state models and reuses the existing offline simulation engine.

## Boundaries (enforced, not advisory)

- **Offline / virtual only.** No real controller, no upload/download, no go
  online, no online edits, no physical-controller communication.
- **No `.ACD`** and no Rockwell/vendor proprietary binary formats.
- Compatibility helpers are **ESCO-owned review/export aids only** with
  copyright-safe labels — they reproduce no vendor UI, icons, sample projects,
  layouts, wording, file formats, or assets, and never open a real network
  endpoint:
  - ESCO HMI Runtime
  - SCADA Compatibility Export
  - OPC UA Simulator
  - Ignition Gateway Export Review
  - Optix Migration Review
  - Modbus TCP Simulator, MQTT / Sparkplug Simulator
- Every visible action either performs a real offline action or shows an
  explicit unsupported/offline boundary (`SIM_BLOCKED_REAL_OPERATIONS`).

The single boundary statement lives in `@esco/sim-lab` as
`SIM_LAB_OFFLINE_BOUNDARY` and is surfaced throughout the UI, exports, and
reports.

## Package: `@esco/sim-lab`

Pure, deterministic, framework-free model + engine (no DOM, no I/O). It reuses
`@esco/simulator` (`PlcRuntime` scan cycles against virtual tags),
`@esco/ladder` (logic AST), and `@esco/instructions` (the instruction registry).

| Module | Responsibility |
|---|---|
| `boundary.ts` | Offline boundary statements, blocked-operation list, copyright-safe compat labels, offline evidence. |
| `types.ts` | ESCO-native model (project, device, virtual tag, logic, HMI, scenario, timeline, report). |
| `ids.ts` | Deterministic, project-scoped ids (reproducible serialization/replay). |
| `catalog.ts` | Process types, offline controller models, device blueprints (tags/units/scaling/alarms/interlocks/faults). |
| `devices.ts` | Device factory + virtual-tag generation. |
| `project.ts` | `createSimProject` + immutable CRUD actions + `.escosim.json` serialization. |
| `logic-templates.ts` | 7 ESCO-owned templates that emit inspectable ladder + metadata. |
| `signal-generator.ts` | Deterministic waveforms (constant/ramp/sine/square/triangle/step/noise) + ramping. |
| `device-simulator` (in `engine.ts`) | Per-kind device dynamics (run feedback, VFD speed, valve travel, sensor PV). |
| `alarm-engine.ts` | Native active/ack/return alarm lifecycle with analog deadbands. |
| `fault-injection.ts` | Virtual-only fault descriptors. |
| `engine.ts` | `SimEngine` — the offline SoftController scan loop, historian, event log, timeline. |
| `scenarios.ts` | 7 FAT/SAT templates + the pass/fail scenario runner. |
| `validation.ts` | Diagnostics for bad device maps, missing tags, invalid units/scaling, impossible expectations. |
| `report.ts` | ESCO-native test report + JSON/CSV serializers. |
| `compat.ts` | ESCO-owned compatibility review/export helpers. |

## Workflow (UI: ribbon → View → "ESCO Simulation Lab")

1. **Create Simulation Project** — pick a process type (Pump Station, Conveyor,
   Tank Farm, Skid, Packaging Line, Utilities), an offline controller model,
   scan rate, I/O racks, and equipment counts (motors/drives/valves/meters/
   sensors/safety). State is stored in the ESCO-native `SimProject` model with an
   explicit *Offline Simulation Only* boundary.
2. **Build Device Map** — simulated motors, VFDs, valves, flow meters, level
   transmitters, temperature sensors, and safety inputs. Each device generates
   virtual tags with units, scaling/limits, fault states, signal behavior,
   interlocks/permissives, and alarm references. Edits mutate real project state
   (immutable actions), not UI-only state.
3. **Build Logic Model** — ESCO-owned templates (debounce input, motor holding
   circuit with interlocks, motor start counter, C↔F conversions, permissive
   chain, alarm trigger). Each emits inspectable ESCO logic metadata and runs
   against virtual tags only.
4. **Build HMI / SCADA Layer** — ESCO HMI Runtime preview bound to live
   simulation tags, plus the ESCO-owned compatibility review/export panels
   (mapping readiness, missing items, unsupported items, export notes).
5. **Scenario Runner** — FAT/SAT scenarios (start motor, trip overload, sensor
   failure, low flow, high tank level, E-stop, operator login/ack/reset) with
   initial conditions, timed actions, expected tag/alarm/event results, pass/fail
   status, and an evidence log.
6. **Run Simulation** — run / pause / step scan / rewind-reset / inject virtual
   faults; a timeline records scan cycles, tag changes, alarms, interlocks, HMI
   events, data-log rows, and scenario steps.
7. **Report** — generate an ESCO-native test report (devices tested, logic paths
   covered, alarms proven, HMI actions tested, failed expectations, timeline
   evidence, offline-only boundary), available in the UI and exportable as
   ESCO-native JSON/CSV.

## App layout

The lab is a self-contained center view reached from the ribbon (View → "ESCO
Simulation Lab"). It renders the workflow stages (Project · Devices · Logic ·
HMI · Run · Reports · Boundaries), a simulation tree, a simulation canvas/mimic
with fault-injection points and HMI preview, an inspector, and docked panels
(live tags, alarm/event log, trend/historian, diagnostics, scenario results,
output/build).

## Onsite-grade screens

Reached from the lab's **Onsite Screens** tab, these are original ESCO-native,
engine-driven HMI screens that make the lab feel like a real commissioning
environment. They are pure functions of the live engine snapshot — view-models
in `@esco/sim-lab` (`view-models.ts`) — so nothing is faked UI state. CSS is
isolated in `apps/web/src/components/simlab/screens/screens.css` (the `sim2-`
namespace) with original SVG equipment symbols and animations (motor rotor spin,
conveyor belt, flowing pipes, tank level fill, valve travel, LED pulse, fault
blink; all respect `prefers-reduced-motion`).

| Screen | Engine-driven view-model | Highlights |
|---|---|---|
| Process Overview | `processOverviewModel` + `deviceVisualState` | Animated mimic; Start/Stop/Reset/Open/Close/Ack/Inject controls that mutate virtual state; running/stopped/tripped/level/flow animation. |
| I/O Cabinet | `ioCabinetModel` | Controller/power/comm + DI/DO/AI/AO/safety modules; channel LEDs from virtual tags; click a module for raw/scaled/units/quality/forced/last-update channel detail. Labeled offline. |
| Device Detail | `deviceDetailModel` | Command/feedback, permissives/interlocks, faults, runtime hours, start count, last fault, alarms, scaling, maintenance, related tags/alarms, scenario evidence. VFD: speed cmd/fb, current, torque, fault code, ready/running/faulted, local/remote, accel/decel — ESCO-generic, no vendor keypad. |
| P&ID / Engineering | `pidViewModel` | ESCO-owned symbols + instrument bubbles, tags, signal lines, setpoints; filter toggles (tags/alarms/interlocks/live/failed); click a symbol selects the device. |
| Logic Debug | `logicDebugModel` | Live true/false contacts, energized coils, rung TRUE/FALSE, ESCO-native (no vendor ladder UI), with scan-step mode. |
| Alarm / Event Console | `alarmConsoleModel` | Active/acked/returned, event log, filters (severity/area/active/ack), Ack selected/all, export event log. |
| Trend / Historian | `historianModel` | Live + replay, scenario/alarm/operator/fault markers, min/max/current pens, run/pause/step/rewind/speed, CSV export. |
| FAT / SAT | scenario runner | Scenario cards: preconditions, steps, expected vs actual, pass/fail, evidence, related devices/alarms; Run All + Reset Simulation. |
| Field Technician | `fieldCheckoutModel` | Tablet-friendly loop check (simulate 4/12/20 mA), discrete toggles, force virtual fault, pass/fail checklist, notes, timestamped evidence. Clearly virtual/offline. |
| Report Preview | `generateSimReport` (+ I/O coverage, trends captured) | Professional commissioning report; JSON/CSV export; offline-only boundary. |

## Determinism

The engine advances on **logical simulation time only** (no wall clock,
`Math.random`, or `Date.now`), and ids are project-scoped counters, so a scenario
replays identically every run and reports/serialization are byte-stable.

## Tests

- Unit/integration (Vitest): `packages/sim-lab/src/*.test.ts` — logic templates,
  engine, scenarios (all 7 templates pass), validation, report, compat, project
  state.
- E2E (Playwright): `e2e/simlab.mjs` — open lab → create project → add device →
  add logic → add + run scenario → step the simulation/timeline → generate
  report → confirm blocked real operations.
