# @esco/driver-ethernetip-node

**Backend-only** TCP transport for the ESCO-owned EtherNet/IP / CIP read-only
driver. Drives the sans-I/O `LogixSessionCore` from `@esco/driver-ethernetip`
over `node:net` (TCP 44818). No Rockwell software, binaries, or services are
used or required.

## What this package is

- `LogixTcpClient` — connect/close lifecycle plus the read-only operations the
  session core exposes: `listIdentity`, `readIdentityObject`, `readTag`
  (with transparent fragmented-read reassembly), `listTags` (pagination),
  `browseAllTags` (program recursion). Frames are flushed via the session
  core's `onOutbound` hook; an inactivity watchdog fails the session when a
  target stops responding with requests pending.
- `src/testing/fake-logix-server.ts` — a TEST-ONLY loopback target built from
  the same ESCO codecs (server side). It replays canned CIP responses so the
  transport is exercised over real sockets without hardware. It is not a
  controller emulator and proves nothing about hardware validation.
- `EthernetIpGatewayDriver` — backend-only `ControllerDriver` implementation
  that replaces the browser placeholder when `apps/api` composes the gateway.
  It exposes identity, status, device-level identity fault bits, tag browse, and
  tag reads. It deliberately exposes no write, subscription, upload, or compare
  methods.

## What this package is NOT

- **Not browser code.** Importing this from `apps/web` is a boundary
  violation; the UI reaches controllers only via the ESCO gateway/session
  layers.
- **Not a write path.** Every operation delegates to the read-only session
  core; no write/download/mode-change method exists (guarded by test).
- **Not verified hardware support.** Loopback tests prove transport mechanics
  only. `verified: true` in `@esco/controller-comm` requires real, signed
  hardware-validation evidence and is never set by this package.
- **Not field-ready by itself.** The package is wired into `apps/api` for the
  read-only milestone, but that proves software wiring only. Real plant use
  still requires lab hardware validation, safety review, deployment guidance,
  and a signed acceptance package.

## Where this fits

```text
ESCO Automation Studio UI
  -> ESCO Online Session Manager
  -> apps/api                       (backend host)
  -> ESCO Controller Gateway        (@esco/controller-gateway)
  -> ESCO driver adapters           (this package replaces the placeholder)
  -> LogixTcpClient                 (this package, backend only)
  -> @esco/driver-ethernetip        (codecs + sans-I/O session core)
  -> TCP 44818 to an Allen-Bradley target
```
