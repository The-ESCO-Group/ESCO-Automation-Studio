# Read-only controller driver — build & validation guide

This is the implementation guide for a **verified, read-only** controller link
(EtherNet/IP/CIP monitor for ControlLogix/CompactLogix). It explains the seam
ESCO ships, how the ESCO-owned EtherNet/IP packages plug in, and the validation
ladder that earns `verified: true`.

> **Safety boundary.** ESCO now has an owned EtherNet/IP/CIP software path in
> `@esco/driver-ethernetip` plus backend TCP hosting in
> `@esco/driver-ethernetip-node`, but it is not physical-controller validated yet.
> Until a real link is hardware-validated, every physical-controller command stays
> visible-but-blocked. Read-only is structural: the seam interface has no
> write/download/online-edit method, and the transport hard-codes `canWrite: false`.
> Writes, downloads, online edits, mode changes, fault clearing, and forces remain a
> separate, later, last-tier effort.

## Architecture (where your code plugs in)

```
ControllerPanel / StatusBar (UI)
   ↓
evaluateCommand  ← gate: realControllerIo + verified + capability + connection + confirmation
   ↓
resolveConnectState  ← single chokepoint: Connected only if realControllerIo && verified
   ↓
InjectedReadOnlyControllerTransport   ← ESCO ships this (lifecycle only, no protocol)
   ↓
ReadOnlyControllerComms  ← inject ESCO backend gateway/driver implementation
   ↓
@esco/driver-ethernetip-node TCP transport
   ↓
@esco/driver-ethernetip CIP session/codecs
   ↓
ESCO fake target now; physical PLC only after lab validation
```

Everything above `ReadOnlyControllerComms` already exists and is tested. The current
software path is wired through the API/gateway and fake-target evidence; the remaining
work is physical hardware validation and broader read coverage, not a dependency on
vendor workstation software.

## What you implement: `ReadOnlyControllerComms`

Defined in `packages/controller-comm/src/read-only-driver.ts`. It is read-only by
construction — there is deliberately no write method.

| Member | Purpose | Maps to commands |
|---|---|---|
| `displayName` | Human label for the link | UI/audit |
| `capabilities` | What reads the stack actually supports (declare honestly) | gates each command |
| `open()` | Open TCP + register session + forward-open | `go-online` |
| `close()` | Forward-close + unregister | `go-offline` |
| `readIdentity()` | Identity object (catalog/rev/serial/mode) | identity panel |
| `readTag(path)` | Single tag value | `monitor` polling |
| `listTags()` | Enumerate readable tags | tag browser |

### Capability → command mapping

Declare only what you have validated. The gate enforces the rest:

| Declared capability | Unlocks | Notes |
|---|---|---|
| `canRead` | `monitor`, `fault-diagnostics`, `go-to-faults` | Monitor/fault reads fall back to `canRead` (`canMonitor ?? canRead`). |
| `canMonitor` (explicit) | reports a `connected-monitor` state | Optional; `canRead` already enables monitoring. |
| `canReadFaults` (explicit) | fault reads even if you later restrict `canRead` | Optional refinement. |
| *(not exposed by this seam)* | `upload`, `network-browser`, `select-recent-path`, `path-diagnostics` | Always `capability-missing` for this monitor-only transport, even if an injected object over-declares them. |
| *(none — there is no write capability here)* | `download`, `online-edit`, `*-edits`, `*-mode`, `lock-controller`, `clear-faults` | Always `capability-missing`. A write link is a different transport, not this one. |

## The read-only CIP sequence to implement

1. **Connect** — open TCP to the controller IP (EtherNet/IP, port 44818), `RegisterSession`.
2. **Open a connection** — `Forward_Open` with an RPI/timeout. Respect the controller's
   connection-slot limit; always pair with `Forward_Close`.
3. **Identity** — read the Identity object (vendor/product/revision/serial/mode).
4. **Tag list** — enumerate the symbol table + data types.
5. **Read values** — `Read Tag` (use multi-service requests / fragmented reads for large data).
6. **Keep-alive** — send periodic packets so the connection does not time out.
7. **Close** — `Forward_Close` + `UnregisterSession`. Never leak connection slots.

Decode atomic types, arrays, strings, and **UDTs/structures** correctly — UDT decode is
its own significant effort.

## Build plan

1. **Prove ESCO-owned behavior in software.** Use the ESCO fake target/loopback tests
   to exercise encapsulation framing, session lifecycle, CIP request/response decode,
   gateway driver behavior, API hosting, and web client state.
2. **Keep the shipping stack ESCO-owned.** Use `@esco/driver-ethernetip` for pure
   codecs/session state and `@esco/driver-ethernetip-node` for backend-only TCP
   transport. Do not require FactoryTalk, RSLinx, Studio 5000, `.ACD`, or third-party
   helper libraries as product dependencies.
3. **Inject `ReadOnlyControllerComms`** from the backend/gateway path. No write
   methods.
4. **Wrap it:** `new InjectedReadOnlyControllerTransport(comms /*, { verified: false } */)`.
   Leave `verified` false. Run the conformance suite (`read-only-driver.test.ts`) against
   your comms — it must clear only monitor/fault reads and block upload, browse, path,
   and every write command.
5. **Lab-validate** (see ladder below). Only then construct it with `{ verified: true }`,
   sourced from evidence — never hardcoded.

## Verification ladder (what earns `verified: true`)

| Tier | Evidence | `verified` |
|---|---|---|
| Software loopback | ESCO fake-target reads, codec/session tests, API/gateway/client tests, and conformance suite green | **false** (software proof != plant hardware) |
| Hardware-validated | Reads correctly against real controllers across firmware revisions; clean connect/keepalive/teardown; provably never faults the controller (connection limits, malformed-request handling); recorded sign-off per controller family/firmware | **true** (this tier only) |

`verified: true` is the single act that lets `resolveConnectState` reach a Connected
state. It is the meaning of "validated against tested hardware." Drive it from signed
lab evidence via the `@esco/controller-comm` online-readiness evidence inputs — do not
set it as a convenience, and keep the first online release **read-only** (identity /
diagnostics / live monitor).

The operational procedure — required evidence package, 14-row hardware test
matrix, site commissioning checklist, and the change-control that flips the
flag — is defined in `goal-b-hardware-validation.md`.

## Integration note (web/desktop)

ESCO Studio is a TypeScript app. Controller communication belongs in the backend/API
host, not in React and not through vendor workstation services. The desktop CSP allows
`connect-src` only for `'self'`, the local ESCO API loopback origins
(`http://localhost:4000`, `http://127.0.0.1:4000`), and the opt-in AI hosts. The
preflight **fails CI** on any other host, so adding any new external endpoint must
update both the CSP and the preflight allowlist in the same reviewed change. This seam
does not enable that by itself.

## What stays blocked regardless

Upload from controller, network browse, path selection/diagnostics, download, online
edits, mode changes, lock controller, fault clearing, real PLC forces, and
`.ACD`/proprietary-binary access. They require separate designs, separate validation
evidence, and explicit command-specific gates — out of scope for the monitor-only
readiness milestone.
