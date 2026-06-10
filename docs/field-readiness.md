# Offline and Field Readiness

Last reviewed: 2026-06-08

This file is the plain readiness answer for engineering handoff. The product
direction is now a vendor-neutral ESCO online/download platform: Allen-Bradley
is the first high-value PLC adapter track, but all physical PLC communication
must flow through the same ESCO gateway and per-target safety gates.

## Current verdict

ESCO Automation Studio is ready for offline and virtual engineering workflows:

- Offline project review and mock project creation.
- Ladder/rung editing and reviewed logic-pattern prototyping.
- Tags, data types, I/O profile, HMI, and Simulation Lab setup.
- SoftController virtual scans.
- Simulation Lab virtual FAT/SAT-style demos and reports.
- ESCO-native files and packages.

It is not ready yet for real-time online use or physical download with any PLC
family in the field. Goal B now includes an ESCO-owned EtherNet/IP/CIP read-only
backend path and visible Online panel for the Allen-Bradley track, but that path
is tested against loopback/fake targets only. It is software-wired, not plant
validated.

## Verification evidence

Current green verification from the 2026-06-05 local sweep:

- Workspace typecheck passed across 20 packages.
- Desktop scaffold preflight passed 52/52 checks.
- Unit/integration tests passed: 2543/2543 tests across 323 files.
- Web production build passed, with only the existing non-failing Vite chunk-size
  warning.
- Git whitespace check passed.
- Browser E2E passed: 1208/1208 checks across 90 drivers.
- Focused controller communication safety slice passed: 49/49 tests across the
  read-only seam, shipped-transport guard, and virtual-controller tests.
- `@esco/controller-comm` typecheck passed after the monitor-only seam update.
- Goal B gateway foundation passed: `@esco/controller-gateway` typecheck, 9/9
  gateway tests, `@esco/web` typecheck, and focused web/gateway tests 15/15.
- Goal B ESCO-owned EtherNet/IP/CIP path has passing tests for pure codecs,
  sans-I/O session core, backend-only TCP transport, gateway driver, API host,
  web gateway client, web session manager, and browser E2E of the visible ESCO
  Online panel. The browser fake-target smoke now covers connect, identity/
  status, browse, read, watch polling, read-only state, stale-on-stop, audit,
  and disconnect. These prove software wiring only, not hardware validation.
- Generic OPC UA has API-level end-to-end proof for read-only connect,
  identity, browse, single/batch reads, SSE subscription events, and blocked
  upload snapshots through the backend gateway with an injected fake OPC UA
  endpoint. It still needs validation against a real plant OPC UA server before
  field use. The Online panel now exposes OPC UA endpoint, browse root,
  sampling interval, and tag-node-map inputs, but these are still unvalidated
  against a real plant server.
- L5X import/export/sync is now represented as an offline gateway driver over
  the ESCO project model. It can browse/read stale-quality project tags, upload
  a read-only project snapshot, and compare project identity through the gateway.
  It is not a live transport and does not prove a physical controller match.
- Project-match evidence now hashes more than controller tags: program/routine
  structure, ST/source text, scrubbed ladder AST, tasks, UDTs, and AOIs are part
  of the local project signature. This makes offline compare/mismatch evidence
  stronger, but still does not validate a physical controller.
- Gateway driver/session capability metadata is visible through the API and
  Online panel, including blocked write/download/online-edit/force/mode-change/
  clear-fault operations. This is safety transparency, not field validation.
- Online identity can now be refreshed explicitly through the gateway and is
  refreshed before local-project compare. This improves B5 match evidence but
  does not prove a real plant controller is safe for writes or commissioning.
- Online Set Path now opens the gateway endpoint/path form. It does not browse
  plant networks, validate a workstation driver, or prove a controller route is
  field-ready.
- Online toolbar Go Online, Go Offline, Faults, and Controller Status now route
  to the ESCO Online gateway panel for read-only session work; real-controller
  Download remains disabled/guarded. This improves B1 UI-to-gateway wiring, not
  physical-controller readiness.
- Online Tag Monitor now marks watched values stale when polling fails, streams
  disconnect, or a watch is stopped, and clears that marker on the next good
  sample. Bad/uncertain samples are not labeled live. This improves operator
  honesty for software-wired monitoring; it is not a substitute for plant
  disconnect/failure-mode acceptance testing.
- The API/web gateway path now isolates online state per ESCO client session id
  for JSON routes and SSE streams, preventing one browser tab or client from
  accidentally using another tab/client's gateway session. Backend idle-session
  cleanup now disconnects inactive sessions while preserving active watch
  streams, and normalized session-id handling is consistent across headers,
  query strings, JSON routes, and SSE routes. This is not yet a production
  multi-user model: authentication, operator ownership, and coordination policy
  remain readiness gates.
- Local UI sanity checks at `http://localhost:5173/` confirmed the Goal B Online
  toolbar command set, `Offline` shell state, and ESCO Online Gateway panel.
- Vendor-neutral download direction is now documented in
  `docs/vendor-neutral-plc-download-architecture.md`: ESCO project model first,
  per-family target adapters second, browser metadata/preflight JSON only,
  backend executable adapters third, and every physical download disabled until
  that adapter has compile, compare, backup, permission, audit, and read-back
  gates proven.

The generated parity snapshot reports 91.8% offline / virtual parity. That number
does not include physical-controller parity.

## Real-controller boundary

These operations are blocked by design:

- Physical controller upload to any PLC family.
- Physical controller download to any PLC family.
- Go-online monitoring with a field PLC unless the selected adapter is validated.
- Online edits to a real controller.
- Physical controller forces.
- Real network browse.
- Real module commands.
- Runtime parameter transfer to a real controller.
- `.ACD` or proprietary controller binary read/write/compile/decompile/convert.

The new ESCO online stack defines the session architecture, driver contract,
simulator adapter, generic OPC UA read-only route, OPC DA placeholder,
Allen-Bradley/EtherNet/IP read-only adapter, match check, audit, and
controlled-write gates. It still does not include a field-validated plant
transport for any PLC family, a real write/download path, or any dependency on
FactoryTalk, RSLinx, Studio 5000, `.ACD`, or vendor binaries.

The controller communication package still requires both `realControllerIo: true`
and `verified: true` before any real connection state or physical-controller
command can run. No shipped concrete physical transport satisfies that gate.

The repo now includes a future read-only monitor seam at
`packages/controller-comm/src/read-only-driver.ts` and a build/validation guide at
`docs/controller-readonly-driver.md`. That seam is monitor-only: even with a fake
verified transport in tests, it keeps upload, network browse, path selection,
path diagnostics, writes, downloads, online edits, mode changes, and forces
blocked.

## Readiness gates for field use

The app should not be used as a production commissioning or live
troubleshooting tool until every gate below is complete:

[ ] Legal/licensing review for any vendor interoperability path.
[ ] A non-proprietary, ESCO-approved adapter design for the selected PLC family.
[ ] A concrete target adapter implementation for that PLC family.
[ ] Backend executable adapter registration that keeps browser clients on
    metadata/preflight JSON only.
[ ] Compile/export/download artifact validation for that target family.
[ ] Lab validation against physical test hardware for that target family.
[ ] Read-only live monitoring acceptance tests.
[ ] Failure-mode tests for disconnects, stale data, bad paths, wrong controller,
    incompatible firmware, permissions, and network loss.
[ ] Production session-management policy for multiple engineers/operators
    (authentication, ownership, conflict handling, and admin policy).
[ ] Independent safety review.
[ ] Operator confirmation and audit requirements for any command that can affect
    hardware.
[ ] Pilot with read-only monitoring before any write path is considered.
[ ] Separate acceptance package for upload/download/online-edit/force operations,
    if ESCO ever chooses to allow them.

Until those gates are complete, the answer for online real-time field usage is:
not field-ready yet.

## Practical handoff

Use it now for offline engineering, virtual FAT, and Goal B online architecture
review.

Do not promise physical commissioning, live online troubleshooting,
upload/download, online edit, real forces, or proprietary binary project support.
