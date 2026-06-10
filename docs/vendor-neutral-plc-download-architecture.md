# Vendor-Neutral PLC Download Architecture

Last updated: 2026-06-08

ESCO Automation Studio should be an ESCO-owned automation platform first, with
PLC-family adapters behind it. Allen-Bradley is the first high-value adapter
track because it is common in the market, but the product direction is not
"Rockwell only" and not "copy a vendor workstation." The long-term target is:

```text
ESCO project model
  -> ESCO verify / compile / compare
  -> ESCO target adapter contract
  -> target-family package
  -> vendor-specific transport / file / runtime path
  -> verified PLC or ESCO runtime
```

No single protocol can safely download logic to every PLC. "Download to all PLCs"
means ESCO needs a separate target pack for each family, with honest capability
metadata and validation evidence.

## Target Adapter Contract

The shared contract lives in `packages/controller-gateway/src/types.ts` and is
centered on:

- `TargetAdapterMetadata`
- `TargetAdapterCapabilities`
- `TargetAdapterSafetyProfile`
- `TargetAdapter`
- `TargetAdapterRegistry`
- `ExecutableTargetAdapterRegistry`
- `DownloadPreflightResult`

Every physical-download adapter must declare:

- Target family and firmware/runtime range.
- Supported source languages and unsupported constructs.
- Compile/export artifact shape.
- Transport type: file export, runtime package, OPC UA service, vendor protocol,
  fieldbus service, or ESCO runtime deployment.
- Required external tools, if any. The preferred target is zero proprietary
  workstation dependency; any exception must be explicit.
- Read/compare support before download.
- Backup/snapshot support before download.
- Lab/field validation evidence.
- Whether the adapter can affect real hardware.
- Whether download, online edit, force, mode change, and clear-fault commands
  are allowed. Default is false.

For every real PLC adapter in the current build:

- `capabilities.physicalDownload: false`
- `safety.executionAvailable: false`
- `safety.physicalDownloadEnabled: false`
- `safety.verified: false`
- `safety.defaultMode: "read-only"`
- `safety.riskLevel: "critical"`

The UI should never call these adapters directly. All target actions still flow:

```text
UI -> ESCO Online Session Manager -> ESCO Controller Gateway -> Target Adapter
```

## Download Safety Gate

A real PLC download must stay disabled until the selected adapter proves every
gate below:

- Adapter is installed and allowed by ESCO policy.
- Target family, firmware, and project identity are known.
- Local project verifies with zero blocking diagnostics.
- Adapter compile/export succeeds with no unsupported logic left unresolved.
- Existing target state is backed up or intentionally skipped with approval.
- Local project and target identity are compared.
- Operator has permission for the target and action.
- Operator confirms target, path, project, and consequences.
- Audit record is written before and after the action.
- Download result is read back or otherwise verified by the adapter.
- Failure path leaves clear recovery instructions.

Until those gates are implemented and tested for a specific PLC family, the
button can exist only as a disabled/guarded command.

## Current Target Matrix

| Target family | Current status | Download status |
|---|---|---|
| ESCO SoftController / ESCO Runtime | Implemented for offline/virtual work | Virtual/runtime download works only inside ESCO-owned simulation/runtime paths |
| Allen-Bradley / Logix over EtherNet/IP | Read-only ESCO protocol stack is software-wired through the gateway/API; loopback fake-target proof exists | Physical PLC download blocked; no write/download builders ship |
| Generic OPC UA endpoint | Backend-only read/browse/subscribe path exists | OPC UA is not a universal PLC logic-download path; download blocked |
| L5X/imported project snapshot | Offline compare/sync/review path exists | Not a live PLC transport; no `.ACD`; no physical download |
| OPC DA legacy plants | Placeholder only | Blocked |
| Siemens | Planned target adapter | Blocked |
| CODESYS / IEC 61131 runtimes | Planned target adapter | Blocked |
| Beckhoff TwinCAT | Planned target adapter | Blocked |
| Schneider / Modicon | Planned target adapter | Blocked |
| Omron | Planned target adapter | Blocked |
| Mitsubishi | Planned target adapter | Blocked |
| Modbus TCP devices/meters | Data/device protocol path, not a logic-download path by itself | Logic download not applicable without a target runtime |
| MQTT / Sparkplug systems | Telemetry/integration path, not a logic-download path by itself | Logic download not applicable without a target runtime |

The codebase now exposes this direction as metadata only:

- `packages/controller-gateway/src/download-adapters.ts` hosts the metadata-only
  `TargetAdapterRegistry` and planned target packs.
- `GET /api/gateway/target-adapters` returns `TargetAdapterMetadata` only.
- `GET /api/gateway/download-adapters` remains as a compatibility alias.
- `POST /api/gateway/download/preflight` returns a structured blocked
  `DownloadPreflightResult` with per-gate `gateResults`.
- `POST /api/gateway/download` is explicitly blocked.
- The browser client can call `listTargetAdapters()` and
  `targetAdapterPreflight()`, but it receives JSON metadata/results only. It
  never receives an executable adapter and cannot override backend safety.
- Every real PLC adapter reports `executionAvailable: false`,
  `physicalDownloadEnabled: false`, `verified: false`, and
  `capabilities.physicalDownload: false` unless a future backend adapter earns
  validation evidence.

## Product Rule

The ESCO project format is the source of truth. Vendor files and protocols are
adapter outputs, not the core product. That keeps ESCO free to support multiple
PLC families without inheriting any one vendor's workstation, binary format, or
UI model.
