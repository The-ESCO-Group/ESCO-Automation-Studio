# Goal B Online Architecture

Last updated: 2026-06-08

Goal B changes ESCO Automation Studio from an offline-only IDE into a phased
online PLC engineering/monitoring tool. Allen-Bradley is the first high-value
adapter track, but the architecture is vendor-neutral: the existing Studio UI
remains the front end, and PLC traffic must flow through an ESCO-controlled
gateway with per-family target adapters. The current implementation is
ESCO-owned: no FactoryTalk, RSLinx, Studio 5000, `.ACD`, vendor binary, or
Rockwell runtime dependency is required for the shipped read-only architecture.
The multi-PLC download direction is tracked separately in
`vendor-neutral-plc-download-architecture.md`.

## Target Stack

```text
ESCO Automation Studio UI
  -> ESCO Online Session Manager
  -> ESCO Controller Gateway
  -> Driver adapters
  -> PLC family connection paths / ESCO runtime targets
```

React components must not talk directly to PLC drivers. UI actions route through
the gateway/session layer, which owns state, match checks, audit, confirmation,
read-back, and permission gates.

## Current Implementation

- New `@esco/controller-gateway` package.
- Goal B online states:
  `Offline`, `Connecting`, `Online Read-Only`, `Online Matched`,
  `Online Mismatched`, `Online Monitor`, `Online Controlled Write`, `Faulted`,
  and `Disconnected`.
- `ControllerDriver` contract with connect/disconnect, identity/status/faults,
  browse/read/write/subscribe, upload snapshot, and compare hooks.
- `ControllerGateway` service that owns connect, compare, read, watch, upload
  snapshot, controlled write, and audit flow.
- Simulator driver remains for offline/virtual testing.
- Driver path registry exists for simulator, generic OPC UA, legacy OPC DA
  placeholder, EtherNet/IP/CIP, and L5X sync.
- Vendor-neutral PLC `TargetAdapterMetadata`, `TargetAdapterSafetyProfile`,
  registry, and blocked `DownloadPreflightResult` contracts now exist in
  `@esco/controller-gateway`. The API exposes metadata through
  `GET /api/gateway/target-adapters` (`/download-adapters` remains a legacy
  alias) and structured blocked preflight through
  `POST /api/gateway/download/preflight`. `POST /api/gateway/download` is
  explicitly blocked, and all physical-download descriptors remain
  non-executable and unverified until a target family passes compile, compare,
  backup, permission, audit, read-back, and lab/field validation gates.
- Generic OPC UA is a backend-only read-only driver path; it uses OPC UA
  directly and does not require FactoryTalk, RSLinx, Studio 5000, `.ACD`, or
  vendor runtime software. OPC DA remains a neutral placeholder.
- New `@esco/driver-ethernetip` package (2026-06-07): ESCO-owned EtherNet/IP /
  CIP protocol codecs written from the public ODVA specifications — no Rockwell
  software, binaries, or services. Implemented and unit-tested as pure byte
  codecs (no sockets): encapsulation header + RegisterSession/UnregisterSession/
  ListIdentity, TCP stream framing, CPF/SendRRData (UCMM), EPATH logical +
  symbolic segments with Logix tag-address parsing, message router + CIP status
  decoding, Unconnected Send backplane routing, atomic CIP value decoding
  (arrays + Logix STRING; unknown structures stay raw bytes), Read Tag (0x4C) /
  Read Tag Fragmented (0x52) builders + reply parsing, Symbol Object tag-list
  paging (0x55 on class 0x6B) with symbol-type decode, and Identity object
  parsing with fault-bit decode. Read-only by construction: no write/download/
  mode-change builders exist, enforced by a regression guard test.
- `@esco/driver-ethernetip` sans-I/O session core (2026-06-07, same day, second
  slice): `LogixSessionCore` protocol state machine — session registration,
  single-in-flight UCMM request/response correlation (protocol violations fail
  the session honestly; per-request CIP errors do not), transparent
  fragmented-read reassembly with no-progress guards, full tag-list pagination
  with program-scope recursion (`browseAllTags`), identity reads, and clean
  close/fail semantics. Still no sockets: a transport drives it via
  `receive()`/`takeOutbound()`/`fail()`.
- New `@esco/driver-ethernetip-node` package (2026-06-07, third slice): the
  BACKEND-ONLY TCP transport (`node:net`, port 44818) driving the session core
  — `LogixTcpClient` with connect/close lifecycle, frame flushing via the
  core's `onOutbound` hook, connect timeout, an inactivity watchdog that fails
  the session when a target stops answering, and read-only delegation
  (identity, ListIdentity, tag read incl. fragmented, tag list, full browse).
  Tested over real loopback TCP against a test-only fake target built from the
  same ESCO codecs (canned CIP responses — not a controller emulator). This
  package must never be imported by browser code.
- `EthernetIpReadOnlyComms` adapter (2026-06-07, fourth slice): the ESCO
  EtherNet/IP implementation of the `ReadOnlyControllerComms` safety seam from
  `@esco/controller-comm`, in the backend-only package. Conservative
  capabilities (`canRead` only — no monitor, no fault surface claimed),
  `open()` reports failures without throwing, identity mapped into the seam
  shape (controller mode is never faked — only "Faulted" from real fault
  bits), scalar tag reads (arrays/structures return undefined rather than
  mangled data), controller+program tag listing with system symbols excluded.
  `createEthernetIpReadOnlyTransport()` builds the injected transport with NO
  verified parameter — the result always carries `verified: false`, so the
  safety gate routes connects to safety-blocked until real hardware evidence
  constructs the transport deliberately at an integration point.
- `EthernetIpGatewayDriver` (2026-06-07, fifth slice): the `ControllerDriver`
  implementation for the gateway, living in the BACKEND-ONLY package so
  `@esco/controller-gateway` stays browser-safe. Same id as the placeholder
  (`ethernetip-cip-readonly`) so a backend host swaps it into the registry;
  the browser bundle keeps the placeholder. Endpoint config via
  `endpointUrl` ("host[:port]" / "enip://…"), CIP route via `path` ("1,0"
  port,link pairs → Unconnected Send). Identity maps vendor/product/type/
  firmware/serial and deliberately omits ALL project fields — the CIP
  Identity object cannot prove which project is loaded, so the gateway
  compare always lands on "match cannot be proven → Online Read-Only":
  `online-matched` is structurally unreachable through this driver (rule 7,
  enforced by integration tests through a real `ControllerGateway`).
  `writeTag`/`uploadSnapshot`/`compareProject` are intentionally absent;
  `subscribeTags` is polling-backed read-only watch, not Forward Open /
  class-1 controller push. Browse reports `writable: false` on every tag;
  undecoded UDT reads return null with quality "uncertain"; identity fault
  bits surface as device-level (non-clearable) faults.
- Backend API host (2026-06-07, sixth slice): `apps/api` now composes the
  Goal B stack — it constructs the `ControllerGateway` with the default
  registry where backend-only drivers replace browser-safe placeholders
  (EtherNet/IP via `EthernetIpGatewayDriver`; OPC UA via
  `OpcUaGatewayDriver`), and
  serves ESCO-owned JSON routes under `/api/gateway`: drivers, session
  snapshot, connect/disconnect, identity, status, faults, tag browse, tag
  read, and the audit log. NO write route exists — `POST /api/gateway/write`
  answers 405 with the read-only-milestone reason. The gateway gained
  audit-recorded `getIdentity`/`getStatus`/`getFaults` proxies so the host
  never touches drivers directly. Build/run mirrors apps/mcp:
  `pnpm --filter @esco/api build && pnpm --filter @esco/api start`
  (vite bundle → `node dist/index.mjs`), port 4000 (`PORT` env), permissive
  CORS for the local dev servers.
- Web-side gateway client (2026-06-07, seventh slice):
  `apps/web/src/gateway-client.ts` — `EscoGatewayClient`, the fetch-based web
  half of the ESCO Online Session Manager. Typed against the browser-local
  gateway contract (`apps/web/src/gateway-contract.ts`), base URL from
  `VITE_ESCO_API_URL` (per stacked dev server) defaulting to the apps/api port.
  Failed connects return the
  driver's `ConnectionResult` (UI shows the reason); operational errors map
  to `GatewayApiError` with the server message. NO write method exists on
  the client (guarded by test). React components are expected to call this
  client/hooks built on it — never drivers (rule 6). An end-to-end suite
  (`apps/api/src/end-to-end.test.ts`) now proves the entire chain with
  production code at every layer: web client → real HTTP → API host →
  gateway → EtherNet/IP driver → TCP → fake target, landing in Online
  Read-Only with audit entries for every step.
- ESCO Online Session Manager, web front half (2026-06-07, eighth slice):
  `apps/web/src/esco-online-session.ts` — framework-free `EscoOnlineSession`
  state owner (availability check with actionable "start the API host"
  guidance, connect/disconnect with failed-connects-as-results, status +
  faults refresh that never queries faults offline, tag browse/read cache,
  audit trail, busy/error state, subscriber notification) plus the
  `useEscoGateway()` React hook (`use-esco-gateway.ts`,
  `useSyncExternalStore`-based, shared default session). NO write action
  exists on the session manager (guarded by test). React components are
  expected to consume the hook; the visible Online panel that mounts it is
  the next slice.
- Visible ESCO Online panel (2026-06-07, ninth slice):
  `apps/web/src/components/online/EscoOnlinePanel.tsx` (+ namespaced
  `esco-online.css`), reached via ribbon **View → "ESCO Online (Gateway)"**
  (`setView("esco-online")`, mirroring the Simulation Lab mount). Renders
  only what `useEscoGateway()` exposes: read-only milestone banner, API-down
  guidance with retry, driver/endpoint/CIP-path connection form, Goal B
  state badge + Read-Only chip, failed-connect reasons, identity/status
  card (mode shown as "not read … not implemented yet" — never faked),
  device-fault table, read-only tag browser with per-tag reads, managed watch
  list, saved/restored browser watch list, read-only polling, per-tag
  quality/timestamp/source/write-status columns, stale/no-sample state, and
  changed-value highlighting. Undecoded structures render as "not decoded; no
  fake value shown". No write affordance exists anywhere in the panel. If the
  controller/session identity cannot be proven to match the local project, the
  gateway defaults to read-only.
- Driver/session capability metadata (2026-06-07, current slice):
  `ControllerDriverSummary` and `ControllerDriverCapabilities` are now emitted
  by the gateway and API. `/api/gateway/drivers` returns capability summaries,
  and session snapshots carry the active driver capabilities plus the
  read-only reason. Read-side features are explicit (status/faults/browse/read/
  batch read/stream/upload/compare); public mutation features are explicitly
  false (tag write, download, online edit, force, mode change, clear fault).
  The Online panel renders those capabilities and disables unsupported actions
  from the gateway contract rather than inferring from driver names.
- Gateway path setup routing (2026-06-07, current slice): the Online toolbar's
  **Set Path** command now opens the ESCO Online gateway connection form and
  focuses the endpoint field. This routes B1 path setup into the gateway UI
  without enabling network browse, RSLinx/FactoryTalk dependencies, or direct
  browser-to-driver traffic. The status/path bar and route-browser commands
  remain guarded hardware operations.
- B5 identity refresh evidence (2026-06-07, current slice): the web session
  manager now exposes a dedicated read-only `refreshIdentity()` action that
  calls `GET /api/gateway/identity` and stores a fresh session snapshot. The
  visible Online panel has a **Refresh identity** button, and
  **Refresh identity & compare** refreshes online identity evidence before
  running the local-project compare. This tightens match evidence without
  adding writes, downloads, online edits, forces, mode changes, or clear-fault
  commands.
- OPC UA API/SSE integration proof (2026-06-07, current slice): the API
  end-to-end suite now exercises the real `GatewayHost` + `ControllerGateway` +
  backend-only `OpcUaGatewayDriver` through HTTP JSON routes and the SSE tag
  subscription route using an injected fake OPC UA adapter. It proves
  read-only connect, identity mapping, capability metadata, browse, single
  reads, batch reads, upload-snapshot refusal, and monitored value changes
  through the same API paths the web client uses. This is still a software
  endpoint proof, not plant validation.
- B4 stale/disconnected monitor evidence (2026-06-07, current slice): the web
  `EscoOnlineSession` now keeps explicit per-tag stale reasons separate from
  driver quality. Gateway transport failures, polling self-stop, stream
  disconnect, and manual watch stop mark the affected watched tags stale; the
  next successful read/stream/sample clears the marker. A polling generation
  guard ignores late samples from stopped/restarted watches. Status refresh is
  now also a watch-loop circuit breaker: disconnected/offline/faulted status
  closes active polling or streaming and marks watched values stale. The visible
  Online tag monitor shows stale quality/state so old values do not look live,
  and `bad`/`uncertain` samples are no longer labeled as live even while a watch
  loop is active.
- L5X sync driver path (2026-06-07, current slice): `l5x-sync` is now an
  offline `ControllerDriver` implementation instead of a dead placeholder. It
  accepts an ESCO project model produced by the existing L5X import/export
  layer, exposes controller/program tag definitions, read-only stale-quality
  snapshot values, batch reads, upload snapshot, and local-project compare
  through the same gateway/API contract. It is explicitly not a live controller
  transport and receives the local project only when its driver kind is `l5x`.
  The Online panel presents this driver as an offline project snapshot and hides
  controller endpoint/CIP route fields for it.
- B5 project-signature hardening (2026-06-07, current slice): the ESCO
  local-project signature now includes controller programs, routines,
  Structured Text/source text, scrubbed ladder structure, program tags, tasks,
  UDTs, and AOI structure in addition to controller tags and identity fields.
  Generated object ids are stripped before hashing so equivalent imports do not
  mismatch only because ids changed. Routine/program structure changes now force
  an Online Mismatched/read-only result instead of slipping through tag-only
  signature evidence.
- OPC UA mapping controls (2026-06-07, current slice): the visible Online panel
  now presents OPC UA as an OPC UA endpoint URL plus read-only browse root,
  sampling interval, and tag-name-to-node-id JSON map. The config is validated
  locally and then sent through `EscoOnlineSession`/`EscoGatewayClient` to the
  backend gateway; React still never imports or talks to the OPC UA driver.
- Controlled writes require proven match, confirmation, permission, audit reason,
  write result, and read-back verification.
- The web shell now projects the Goal B online-state labels and the Online
  toolbar shows the B1 command set: Set Path, Go Online, Go Offline, Upload
  Snapshot, Download, Compare, Read Tags, Watch Tags, Faults, Controller
  Status. Set Path, Go Online, Go Offline, Upload Snapshot, Compare, Read Tags,
  Watch Tags, Faults, and Controller Status open the ESCO Online gateway panel;
  the real-controller Download command stays disabled/guarded.

## Driver Path Status

| Driver path | Current state |
|---|---|
| ESCO simulator | Implemented as gateway adapter for offline testing |
| Generic OPC UA | Backend-only read-only driver implemented (`@esco/driver-opcua-node`) with generic OPC UA connect, browse, read, batch read, and monitored-item subscriptions through the gateway/API/SSE path. No vendor runtime dependency; no writes; plant validation still open |
| Legacy OPC DA | Registered placeholder only; no vendor service dependency ships |
| EtherNet/IP/CIP direct | ESCO stack implemented + tested end-to-end against an in-process fake target: codecs + sans-I/O session core (`@esco/driver-ethernetip`), backend-only TCP transport, `ReadOnlyControllerComms` seam adapter, gateway `ControllerDriver` (`@esco/driver-ethernetip-node`), backend API host, web gateway client, session manager, visible ESCO Online panel, and polling-backed read-only subscriptions. Still missing true Forward Open/push subscriptions, desktop CSP approval, real-hardware validation, and any write path; browser bundle keeps the placeholder |
| L5X import/export/sync | Implemented as an offline gateway driver over the ESCO project model produced by L5X import/export. Supports project-structure compare, tag browse/read/batch-read, and read-only upload snapshots with stale-quality values. Not a live driver; no `.ACD`, no vendor runtime, no physical transport |

Concrete online drivers live in backend-only packages or the API host, not in
the browser bundle. Today that is true for EtherNet/IP/CIP and generic OPC UA;
OPC DA remains a placeholder until ESCO approves a legacy design.

## Safety Rules

- If ESCO cannot prove the online controller matches the local project, default
  to read-only mode.
- Real download, online edit, mode changes, forces, and fault clearing stay
  unavailable until separate write-path validation exists.
- Controlled writes are not casual writes: they require confirmation, permission,
  audit, read-back verification, and surfaced errors.
- Imported L5X path metadata is review data only. It must not become trusted
  connection authority by itself.

## Verification

- `@esco/controller-gateway` typecheck passed.
- `packages/controller-gateway/src/gateway.test.ts` passed 9/9.
- `@esco/web` typecheck passed.
- Focused web/gateway tests passed 15/15 after adding the Goal B toolbar
  inventory check.
- Local UI sanity check at `http://localhost:5173/` confirmed the Online toolbar
  renders the B1 command set and the shell shows the Goal B `Offline` state.
- Browser E2E reruns passed for the changed shell/status surfaces:
  `ribbon` 49/49, `controller` 36/36, `eassnap` 7/7, `easx` 9/9, and `ide`
  58/58.
- 2026-06-07: `@esco/driver-ethernetip` typecheck passed; its codec test suite
  passed 89/89 across 12 files (golden byte vectors for encapsulation, framing,
  CPF, EPATH, message router, unconnected send, data types, read tag, tag list,
  identity, plus the read-only/no-transport regression guards). Re-ran
  `packages/controller-comm` + `packages/controller-gateway` suites after the
  change: 372/372 passed.
- 2026-06-07 (second slice): session core added — typecheck passed; package
  suite now 107/107 across 13 files (18 new `LogixSessionCore` tests covering
  registration, frame golden bytes, serialization, queued-during-registration
  release, routing, CIP-error isolation, encapsulation-error poisoning,
  protocol-violation handling, fragmented reassembly + no-progress rejection,
  pagination, program recursion, identity, ListIdentity, close/fail).
- 2026-06-07 (third slice): `@esco/driver-ethernetip-node` — both driver
  packages typecheck clean; combined suite 122/122 across 14 files (15 new
  loopback-TCP tests: session registration, registration-failure poisoning,
  UnregisterSession on close, DINT read, split-segment reassembly, fragmented
  continuation over the wire, tag-list paging, identity, ListIdentity,
  CIP-error isolation, request serialization, no-response watchdog,
  mid-flight connection drop, read-only export guard). Loopback tests prove
  transport mechanics only — NOT hardware validation.
- 2026-06-07 (fourth slice): seam adapter — node package typecheck clean; 10
  new adapter tests green (capability conservatism, non-throwing open
  failures, identity mapping incl. Faulted mode, scalar reads + non-scalar
  refusal, LINT precision handling, system-symbol exclusion, transport
  verified:false + canWrite:false by construction, connected-unavailable on
  unreachable target, no-verified-parameter factory guard). Re-ran
  `@esco/controller-comm` suite incl. the shipped-transports verified guard:
  363/363 green alongside.
- 2026-06-07 (fifth slice): gateway driver — node package typecheck clean; 11
  new tests green (read-only connect + identity without project fields,
  config validation without throwing, unreachable-target failure result,
  Unconnected Send routing from a "1,0" path, honest browse types +
  writable:false, per-shape read quality incl. null/uncertain for UDTs,
  identity-fault surfacing, absent write/subscribe/snapshot/compare surface,
  idempotent disconnect, and two gateway-integration tests proving rule 7:
  Online Read-Only without a project AND never online-matched + controlled
  writes blocked even with a matching-type local project). Gateway suite
  9/9 green alongside.
- 2026-06-07 (sixth slice): backend API host — api/gateway/driver-node
  typechecks clean; 8 new host tests green (registry replacement, non-gateway
  paths ignored + unknown routes 404, connect validation + offline errors as
  JSON, write route 405, failed connect → 502 with driver result, full-stack
  EtherNet/IP flow HTTP→gateway→driver→TCP→fake target with audit assertions,
  simulator flow through the same routes). `vite build` produced
  dist/index.mjs (294 modules) and a live smoke test against the built server
  verified /health, the 5-driver registry, offline read-only snapshot, and
  the 405 write refusal over real HTTP.
- 2026-06-07 (seventh slice): web gateway client — `@esco/web` and
  `@esco/api` typecheck clean; 7 client tests green (URL normalization +
  GETs, connect POST body + failed-connect-as-result, tag-name URL encoding,
  GatewayApiError mapping, unexpected-payload rejection, non-JSON rejection,
  no-write-surface guard) plus 2 end-to-end tests green running production
  code at every ESCO layer over real HTTP and real TCP (full read-only flow
  with audit assertions; failed connect surfaced as a result). API host
  refactored to export `createApiServer()` (src/server.ts) so the entry
  point and integration tests share the exact wiring; rebuild verified.
- 2026-06-07 (eighth slice): web session manager — `@esco/web` typecheck
  clean; 11 new `EscoOnlineSession` tests green (availability up/down with
  guidance, connect result + identity + snapshot storage, failed connect as
  renderable result, per-session data cleared on connect/disconnect,
  status+faults refresh with no fault queries while offline, tag value
  caching, gateway-error surfacing, audit storage, subscriber notification +
  busy toggling, unsubscribe, no-write-surface guard).
- 2026-06-07 (ninth slice): visible Online panel — `@esco/web` typecheck
  clean, full web unit suite 137/137 green (no ribbon/command inventory
  regressions), production `vite build` green. Mount points: App.tsx
  CenterView "esco-online" + render branch + `onEscoOnline` ribbon prop;
  RibbonToolbar View menu gained "ESCO Online (Gateway)". Browser E2E for
  the panel not yet run — noted as open verification.
- 2026-06-07 (tenth slice): browser E2E — new `e2e/escoonline.mjs` passed
  13/13 against the live stack (own vite dev server on :5199 with
  `VITE_ESCO_API_URL`, real apps/api host on :4471): View-menu entry, panel
  opens, read-only banner wording, backend driver registry visible
  (EtherNet/IP + simulator), simulator connect → Online Read-Only badge +
  Read-Only chip, status/identity via gateway, audit trail shows connect,
  zero write affordances, clean disconnect. Found and fixed a BROWSER-ONLY
  bug the unit suites could not catch: the client stored `window.fetch`
  unbound ("Illegal invocation" in browsers; Node's undici tolerates it) —
  now `fetch.bind(globalThis)`. Ribbon suite re-run 49/49 after the new
  View-menu item; client/API unit suites re-run green; `@esco/web`
  typecheck clean.
- 2026-06-07 (eleventh slice): batched read-only tag polling, end to end —
  `ControllerGateway.readTags()` (per-tag failures reported per tag, one
  audited batch entry), `POST /api/gateway/tags/read-batch` (validated,
  max 200 names), `EscoGatewayClient.readTags()`, session-manager
  `readTags`/`startTagPolling`/`stopTagPolling` (immediate first sample,
  interval loop, self-stop after 3 consecutive transport failures, stop on
  disconnect and on leaving the panel), and a "Watch all (poll 2 s)" toggle
  in the panel with per-tag error cells. Client-side polling is the honest
  stand-in until a real subscription path (Forward Open) exists — the panel
  labels it as polling. Verification: gateway/api/web typechecks clean; 4
  new gateway tests, 2 new host tests (validation + full-stack mixed batch
  over TCP with per-tag CIP error), 1 new client test, 5 new session tests
  with fake timers — touched suites 48/48 green; API bundle rebuilt.
- 2026-06-07 (twelfth slice): CIP Multiple Service Packet (0x0A) — batched
  tag polling now costs ONE wire round trip per chunk instead of one per
  tag. New `cip/multi-service.ts` codec (request/reply split with offset
  validation; outer status 0x00 and 0x1E accepted; reply encoder exported
  for the fake target), `LogixSessionCore.readTagsBatch()` (chunking,
  default 20/chunk; invalid tag paths reported without sending; embedded
  partial transfers re-read through the fragmented path; targets rejecting
  0x0A fall back to per-tag reads transparently), `LogixTcpClient`
  delegation, optional `ControllerDriver.readTags?` in the gateway contract
  (gateway prefers driver batching, falls back to per-tag loop), and
  `EthernetIpGatewayDriver.readTags` mapping batch outcomes to gateway
  values/errors. Still read-only everywhere. Verification: 5 packages
  typecheck clean; 3 new codec tests (golden bytes for 0x0A request/reply),
  5 new session-core batch tests (golden frame, chunking, 0x08 fallback,
  embedded-partial re-read, invalid-path reporting), driver loopback batch
  test (asserts exactly one multi-service request on the wire), gateway
  driver-preference test; full-stack host test updated to answer 0x0A like
  a real target — touched suites 179/179 green; API bundle rebuilt.
- 2026-06-07 (thirteenth slice): UDT template protocol support — protocol
  details checked against public protocol behavior before coding; known read-size
  discrepancies are documented in-source and handled with defensive parsing.
  New `logix/templates.ts`: Template object (0x6C) Get Attribute List
  (definition size, structure size, member count, handle), paged Read
  Template (offset+bytes) with no-progress guards, member-entry parsing
  (8-byte info/type/offset rows + null-separated names with placeholder
  degradation), and `decodeStructureValue()` — atomic members, atomic
  arrays (info = element count), and packed BOOLs (offset byte + info bit)
  decode; NESTED STRUCTURES are reported as undecoded, never guessed.
  `LogixSessionCore.readTemplate()` orchestrates attribute + paged reads.
  Verification: typecheck clean; 10 new template tests (golden request
  bytes, attribute reply triplets, failure/missing-attribute rejection,
  name parsing + truncation degradation, struct/array/BOOL/out-of-range
  decode) + 2 session paging tests (offset/size continuation golden bytes,
  no-progress rejection) — package suites 168/168 green. NOT yet wired into
  the gateway driver (struct tag reads still return null/uncertain) — that
  mapping is the next slice.
- 2026-06-07 (fourteenth / B4 slice): managed Online Tag Monitor watch-list
  surface in the ESCO Online panel. Added user-selected watched tags, typed
  tag-name entry, search/filter over browsed tags, add/remove, save/restore
  through browser storage, watch selected polling, read-only
  source/quality/timestamp/write-status columns, stale/no-sample/live state,
  and changed-value tracking in `EscoOnlineSession`. The safe default simulator
  now exposes four read-only gateway tags so the monitor has a useful offline
  path. Online toolbar Read Tags/Watch Tags now route to the gateway-backed
  ESCO Online panel, and the command-surface audit has a `gateway-online`
  category. Verification: `@esco/web` and `@esco/controller-gateway`
  typechecks clean; focused unit suites passed 49/49, command/session/client
  suites passed 32/32, `e2e/ribbon` passed 51/51, and `e2e/escoonline` passed
  22/22 against the live API path.
- 2026-06-07 (fifteenth slice): template-decoded structure reads in the
  EtherNet/IP gateway driver — struct tag reads now return named member
  records instead of null. The driver learns tag→template-instance mappings
  from the symbol table (populated by browse; lazily browsed once on the
  first struct read), fetches and caches template definitions through
  `LogixTcpClient.readTemplate`, and decodes ONLY when the read reply's
  structure handle equals the template CRC — a mismatch stays
  null/"uncertain", never decoded against the wrong layout. Partially
  decodable structures (nested templates) report quality "uncertain";
  member arrays render as JSON text (gateway structure payloads hold
  primitives). Caches clear on disconnect. Verification: driver-node
  typecheck clean; 2 new loopback tests (full decode flow asserting the
  symbol table and template are fetched exactly once across repeated reads;
  handle-mismatch refusal) — suites 181/181 green; API bundle rebuilt.
  Found via test: UDT fixtures must not reuse handle 0x0FCE (the Logix
  STRING handle) or value decoding correctly treats them as STRINGs.
- 2026-06-07 (sixteenth slice): controller keyswitch/mode reading — the
  identity status word's public byte-pair behavior decodes to Run / Remote
  Run / Program / Remote Program.
  `decodeKeyswitchPosition()` + `CipIdentity.keyswitch` in the codec
  package; the gateway driver reports `ControllerStatus.mode`
  (Faulted wins over keyswitch; unlisted encodings stay undefined — never
  guessed) and the controller-comm seam reports `controllerMode`. The
  Online panel's mode field now shows real keyswitch state. Verification:
  both driver packages typecheck clean; 3 new identity tests (all eight
  documented byte pairs, unlisted-value refusal incl. fault words, parsed
  identity flow) + 1 driver loopback test (mode "Remote Run" from status
  bytes 60 30) — suites 186/186 green; API bundle rebuilt.
- 2026-06-07 (seventeenth / B5+B1 slice): explicit local-project match check
  and read-only upload snapshot now reach the visible Online panel through the
  backend gateway. Added API routes `POST /api/gateway/compare` and
  `POST /api/gateway/snapshot/upload`, browser client/session/hook methods,
  panel buttons for "Refresh identity & compare" and "Upload snapshot", local
  project injection from `App.tsx`, and Online toolbar routing so Upload
  Snapshot/Compare/Read Tags/Watch Tags all open the gateway-backed Online
  surface. Go Online now sends the local project when one is open; a simulator
  identity mismatch lands in Online Mismatched with Read-Only enforced. The
  snapshot action is read-only and merges captured tag values into the monitor
  cache. Verification: `@esco/web`, `@esco/api`, and
  `@esco/controller-gateway` typechecks clean; focused unit suites passed
  54/54; `e2e/ribbon` passed 53/53; `e2e/escoonline` passed 24/24 against the
  live API path.
- 2026-06-07 (nested-template recursive decode): single nested structures
  inside UDTs now decode through their own templates and flatten to dotted
  member paths ("Inner.Count") in gateway tag values. The codec gained
  `DecodeStructureOptions` (`resolveTemplate` callback + `maxDepth` guard,
  default 4; cycles terminate with dotted undecoded paths); the driver
  fetches the template CLOSURE transitively (16-template cap; root fetch
  failure → no decode, nested failure → that branch stays undecoded while
  the rest decodes). Struct ARRAYS remain honestly undecoded — element
  stride/alignment is not claimed knowledge. Verification: both driver
  packages typecheck clean; 2 new codec tests (recursive decode via
  resolver, self-referential depth-cap termination with dotted paths) + 1
  driver loopback test (two-template closure fetched exactly once, payload
  `{"Inner.Count": 7, "Total": 9}`, quality good) — suites 189/189 green;
  API bundle rebuilt.
- 2026-06-07 (polling-backed EtherNet/IP subscriptions): the EtherNet/IP
  driver gained `subscribeTags` — POLLING-BACKED and labeled as such, NOT a
  CIP class-1 / Forward Open push subscription (that remains future work
  with an unchanged contract). Each tick samples the watched tags through
  the batched Multiple-Service read path (one wire round trip), emits on
  value/quality CHANGE plus one initial sample per tag, reports read-error
  transitions as one bad-quality null, and halts on unsubscribe and on
  disconnect. This connects gateway `watchTags` → the API SSE subscribe
  route for real EtherNet/IP sessions end to end. Verification: driver-node
  typecheck clean; 2 new loopback tests (initial sample before the handle
  resolves, change dedup across idle ticks, single emit per change,
  unsubscribe halt; disconnect halt) plus the absence guard updated to
  assert subscriptions exist while write/snapshot/compare remain absent —
  suites green; API bundle rebuilt.
- 2026-06-07 (EtherNet/IP SSE end-to-end): the end-to-end suite now proves
  live subscription streaming across EVERY layer for the real driver path —
  HTTP SSE subscribe route → gateway watchTags → EtherNet/IP polling
  subscription → Multiple-Service batch reads → TCP → fake target — with a
  MUTABLE target value: the stream carries the initial sample (1234) and
  then the changed value (5678) emitted by the next poll tick. api suite
  14/14 green (the SSE simulator test from the parallel work plus this
  EtherNet/IP one both passing).
- 2026-06-07 (B4 stream UX/API slice): gateway subscriptions now reach the
  visible Online Tag Monitor through the API SSE route
  `GET /api/gateway/tags/subscribe` and the browser client/session/hook. The
  panel exposes **Stream selected** and **Stop stream** beside polling; streamed
  values update quality/timestamp/source/live state, clear stale per-tag errors,
  and still show read-only write status. Unsupported drivers surface an error
  and leave **Watch selected (poll 2 s)** available as the honest fallback.
  Verification: `@esco/web`, `@esco/api`, and `@esco/controller-gateway`
  typechecks clean; `@esco/driver-ethernetip-node` typecheck clean; focused
  client/session/API/gateway/driver suites passed 65/65, including EventSource
  parsing, session stream lifecycle, SSE watch-list validation, simulator SSE,
  and EtherNet/IP polling-backed SSE; `e2e/escoonline.mjs` passed 26/26 against
  the live API path.
- 2026-06-07 (live link-state status honesty): the EtherNet/IP driver's
  `getStatus()` now consults the ACTUAL TCP session state instead of only
  checking that a client object exists — a session lost to the inactivity
  watchdog or a peer drop reports `faulted` / `connected: false` with
  "go offline and reconnect" guidance, never a stale online status.
  Verified over loopback by dropping the connection mid-session
  (driver-node + api suites 59/59 green; API bundle rebuilt).
- 2026-06-07 (EtherNet/IP browser E2E + standalone fake target): `apps/api`
  now also builds `dist/fake-target.mjs` — a TEST-ONLY canned-CIP target
  (NOT a controller emulator; proves chain mechanics, never hardware
  validation) on `ESCO_FAKE_TARGET_PORT` (default 44991);
  `FakeLogixServer.listen` gained an optional fixed port. New
  `e2e/escoonline-enip.mjs` drives the real panel UI against it through the
  full production stack: Online Read-Only connect, identity card
  (vendor/product/firmware/serial), keyswitch Mode Run, symbol browse with
  honest `DINT[]` typing, wire-value tag read (1234), audit trail recording
  the connect, zero write affordances, clean disconnect — 11/11 checks in a
  real browser (vite :5198 + api :4472 + target :44991). Build note: the
  api bundle was unblocked by externalizing the OPC UA stack's optional
  `proper-lockfile` dynamic import (documented in vite.config.ts for the
  OPC UA slice owner).
- 2026-06-07 (B3 OPC UA read-only slice): new backend-only
  `@esco/driver-opcua-node` package with `OpcUaGatewayDriver` replacing the
  generic OPC UA placeholder inside `apps/api` only. It validates
  `opc.tcp://` endpoints, connects through `node-opcua-client` (MIT),
  reads standard OPC UA server identity nodes, browses object/variable trees
  into read-only ESCO tag definitions, maps explicit `nodeMap` entries, reads
  live values with quality/timestamp/data type, supports OPC UA monitored-item
  subscriptions through the gateway stream path, and deliberately exposes no
  write/upload/compare surface. Verification: `@esco/driver-opcua-node`,
  `@esco/api`, and `@esco/controller-gateway` typechecks clean; focused OPC UA
  driver/API/gateway suites passed 28/28 with an injected fake OPC UA adapter.
- 2026-06-07 (capability contract slice): gateway driver summaries and session
  snapshots now expose explicit public capabilities. Placeholder paths report
  no live transport; simulator/EtherNet/IP/OPC UA expose their read-side
  support; write/download/online-edit/force/mode-change/clear-fault stay false
  in the public online surface. The web panel shows the contract and gates
  unsupported buttons from it. Verification: gateway/api/web typechecks clean;
  focused capability assertions added at gateway, API, web-client, and session
  layers.
- 2026-06-07 (B5 identity refresh slice): identity refresh is now visible
  end-to-end through API → web client → session manager → hook → panel. The
  panel can refresh identity separately, and compare refreshes identity first
  before asking the gateway to compare local/controller identity fields.
  Verification added at API, web-client, session, and browser E2E layers.
- 2026-06-07 (B1 Set Path routing slice): Online toolbar **Set Path** now opens
  the gateway-backed Online panel and focuses endpoint/path setup instead of
  logging a guarded hardware path-selection block. The command-surface audit
  classifies this single toolbar command as `gateway-online`; real network
  browse/path discovery remains guarded.
- 2026-06-08 (B1 Online toolbar routing slice): Online toolbar **Go Online**,
  **Go Offline**, **Faults**, and **Controller Status** now route to the same
  ESCO Online gateway panel as Upload Snapshot/Compare/Read Tags/Watch Tags.
  The toolbar's real-controller **Download** button is disabled and still
  classified as guarded hardware; simulator/runtime download remains on the
  separate ESCO Virtual Controller/SoftController surfaces.
- 2026-06-07 (gateway lost-status cleanup slice): when a driver status refresh
  reports disconnected after a successful connect, `ControllerGateway` now calls
  the active driver's `disconnect()` before publishing the disconnected state.
  This keeps backend OPC UA/CIP session resources from lingering after the
  gateway heartbeat has failed.
- 2026-06-07 (web capability fail-closed slice): the Online panel now
  normalizes partial or missing backend capability metadata into a complete
  fail-closed capability contract. Missing browse/read/watch/upload/compare
  booleans are treated as unavailable, and all mutation booleans still default
  blocked, so incomplete driver summaries cannot make unsupported controls look
  usable.
- 2026-06-07 (monitor unsubscribe lifecycle slice): `ControllerGateway` now
  tracks active backend watch subscriptions. It enters `Online Monitor` while
  one or more subscriptions are active, leaves that state after the final
  unsubscribe, and does not revive an online state if an old handle unsubscribes
  after disconnect. `GatewayHost.subscribeTags()` has a regression test for the
  same lifecycle used by the HTTP/SSE route.
- 2026-06-07 (per-client session isolation slice): `GatewayHost` now owns a
  separate `ControllerGateway` per normalized ESCO client session id instead of
  one process-wide online session. JSON routes carry `x-esco-session-id`; the
  SSE watch route accepts the same id as a `session` query parameter; the web
  client creates/persists a browser-session id and sends it on both request
  types. This prevents one tab/client from accidentally subscribing against or
  disconnecting another tab/client's active gateway state. This is client-state
  isolation only: production auth, ownership, and operator coordination are
  still future work.
- 2026-06-07 (backend session idle cleanup slice): `GatewayHost` now tracks
  last use and active subscription count per ESCO client session. The API host
  runs an unref'd cleanup loop that disconnects and removes idle inactive
  gateway sessions; active SSE/watch subscriptions hold their session open until
  unsubscribe/close. This is backend resource hygiene, not a production
  operator-ownership model.
- 2026-06-07 (session-id contract hardening slice): gateway session ids now use
  one exported normalizer for header, query, JSON, and SSE paths. Query `session`
  wins over `x-esco-session-id`, blank query values fall back to the header, and
  unsafe characters are mapped to a bounded ASCII key. The default API host
  remains per-client isolated through a gateway factory; passing a prebuilt
  `ControllerGateway` is treated as a single-gateway test/custom harness, not a
  fake multi-session mode. Regression tests also prove multiple active watch
  subscriptions keep `Online Monitor` alive until the final unsubscribe.

## What Is Not Done

- No field-validated generic OPC UA plant connection yet. A backend-only
  read-only driver now exists and is test-backed through an injected adapter;
  testing against a real approved OPC UA endpoint is still required.
- No OPC DA legacy adapter implementation yet (placeholder only; same rule).
- EtherNet/IP/CIP read-only driver: protocol codecs, the sans-I/O session
  core, the backend-only TCP transport, the `ReadOnlyControllerComms` seam
  adapter, the gateway `ControllerDriver`, the backend API host, the
  web-side gateway client, the web session-manager state layer, and the
  visible ESCO Online panel (View → "ESCO Online (Gateway)") are done and
  tested end to end against an in-process fake target, INCLUDING browser E2E
  of the panel against the live stack (`e2e/escoonline.mjs`, 38/38, simulator
  driver flow; `e2e/escoonline-enip.mjs`, 15/15, EtherNet/IP fake-target wire
  flow with connect, identity/status, browse, read, watch polling, read-only
  status, stale-on-stop, audit, and disconnect checks). Reaching a real
  controller still requires starting the
  backend API host alongside the web shell, and the desktop CSP does not
  yet allow the API origin. Also still missing:
  controller-PUSH subscriptions — CIP has none for tag data (class-1 is I/O
  assemblies only), so tag watching is polling-backed even though class-3
  CONNECTED messaging now exists (see goal-b-forward-open-design.md: it makes
  polling cheaper, it is not a push). Still missing: hardware-validated
  streaming, nested/full UDT decoding beyond the current guarded template support,
  production multi-user session management (auth, operator ownership, conflict
  handling, and coordination beyond the current per-client gateway state
  isolation plus backend idle cleanup),
  desktop CSP allowance for the API origin (deliberate security review),
  and hardware validation. `verified` stays false everywhere, and
  `online-matched` is structurally unreachable through the EtherNet/IP
  driver until a trusted project-identity proof exists. The evidence flow
  that would change the hardware-validation status (lab test matrix,
  evidence records, sign-off, commissioning checklist, change control) is
  now DEFINED in `goal-b-hardware-validation.md` — defined, not performed:
  no evidence records exist and the validated firmware list is empty.
- No field-validated live tag streaming from physical PLC hardware yet.
- No physical download adapter is validated for any PLC family yet; the
  multi-vendor download architecture is defined in
  `vendor-neutral-plc-download-architecture.md`.
- No controlled write path to real PLCs yet — and `@esco/driver-ethernetip`
  deliberately contains no write builders at all.
- No field validation or commissioning acceptance package yet; every shipped
  transport still reports `verified: false`.
