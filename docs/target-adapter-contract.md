# Target Adapter Contract

Last updated: 2026-06-08

This is the developer reference for ESCO's **formal target adapter contract** —
the typed boundary every PLC-family pack plugs into. It documents what the
contract *is*; the product rationale and target matrix live in
[`vendor-neutral-plc-download-architecture.md`](./vendor-neutral-plc-download-architecture.md),
and the online-session/reliability behavior lives in
[`goal-b-online-architecture.md`](./goal-b-online-architecture.md).

## Where it lives

| Concern | Location |
|---|---|
| Contract types | `packages/controller-gateway/src/types.ts` |
| Registries, planned packs, preflight | `packages/controller-gateway/src/download-adapters.ts` |
| Backend host wiring (routes) | `apps/api/src/gateway-host.ts` |
| Browser metadata/preflight client | `apps/web/src/gateway-client.ts` |

## Core principle

The ESCO project model is the source of truth. A target adapter is an **output
boundary**, not the product. Adapter metadata is *descriptive*: a browser client
receives JSON metadata and preflight results only — never an executable adapter,
and never a way to flip a backend safety flag. The only path that can ever touch
hardware lives behind the backend registry:

```text
UI -> ESCO Online Session Manager -> ESCO Controller Gateway -> Target Adapter -> wire
```

## Types

### `TargetAdapterMetadata`

Vendor-neutral, serializable description of a target pack. Carries `id`, `name`,
`vendor`, `families`, `strategy`, `validationState`, the `capabilities` and
`safety` records below, `realControllerIo`, human `notes`, an optional
`blockedReason`, and `requiredGates`. The top-level `executionAvailable`,
`physicalDownloadEnabled`, and `verified` booleans are compatibility mirrors of
the matching `safety` fields for older clients.

### `TargetAdapterCapabilities`

Explicit, all-boolean capability flags — no implicit truthiness:

```
projectModelImport   projectModelExport   validate              compile
compareOfflineOnline backup               uploadSnapshot        physicalDownload
onlineMonitor        onlineTagRead         onlineTagWrite        onlineEdit
modeChange           faultReset            ioTreeRead            ioTreeWrite
safetyControllerSupport                    motionSupport
```

A capability flag advertises *intent/shape*. It never by itself authorizes a
physical action — that is the safety profile's job, gated again at preflight.

### `TargetAdapterSafetyProfile`

```
executionAvailable             physicalDownloadEnabled       verified
requiresBackupBeforeDownload   requiresCompareBeforeDownload requiresExplicitUserApproval
supportsDryRun                 defaultMode                   riskLevel
safetyMessage
```

`defaultMode` is one of the read-only/simulation modes; `riskLevel` ranks the
declared risk of the adapter's physical-download path.

### `TargetAdapter` (executable)

Backend-only. Wraps `metadata` and exposes async operations
(`preflightDownload`, plus optional `validate`, `compile`, `compareOfflineOnline`,
`backup`, `uploadSnapshot`). These function handles **never** cross the API
boundary — see "Metadata / executable split" below.

### Registries

- `TargetAdapterRegistry` — read-only: `listMetadata`, `getMetadata`,
  `preflightDownload`. This is what the API and browser see.
- `ExecutableTargetAdapterRegistry extends TargetAdapterRegistry` — adds
  `listExecutableMetadata`, `getExecutableAdapter`, and `register`. Backend only.

Concrete classes: `MetadataOnlyTargetAdapterRegistry` (the default, exported as
`TARGET_ADAPTER_REGISTRY`) and `InMemoryExecutableTargetAdapterRegistry`.

### Preflight result

`DownloadPreflightResult` carries `targetAdapterId`, `ok`,
`physicalDownloadAllowed`, the `executionAvailable`/`physicalDownloadEnabled`/
`verified` flags, `defaultMode`, `riskLevel`, `requiredGates`, `gateResults`, a
`message`, a `checkedAt` timestamp, and two human-readable lists: `blockers`
(why the action is refused) and `warnings`.

Each `gateResults` row has `gate`, `state`, `required`, and `message`. Current
metadata-only physical PLC adapters return blocked/not-run gate rows; a future
download-capable backend adapter must produce passing gate evidence before the
preflight result can allow a physical action.

## Metadata / executable split

- The browser receives `TargetAdapterMetadata` and `DownloadPreflightResult`
  JSON only — both are plain data with no function values.
- The backend may hold executable adapters via the executable registry, but the
  API never serializes a function handle.
- A browser client cannot set `executionAvailable`, `physicalDownloadEnabled`,
  or `verified`. Those are owned by the backend safety profile and re-checked at
  preflight; frontend input cannot override them.

## Download preflight gates

`preflightDownload` blocks unless **every** gate is satisfied. The canonical
ordered list is `TARGET_ADAPTER_REQUIRED_GATES`:

1. `adapter-policy-approval`
2. `target-family-and-firmware-match`
3. `zero-blocking-project-diagnostics`
4. `target-compile-or-export-success`
5. `backup-or-approved-backup-skip`
6. `local-target-identity-compare`
7. `operator-permission`
8. `operator-confirmation`
9. `pre-action-audit`
10. `download-result-verification`
11. `post-action-audit`

`targetAdapterAllowsPhysicalDownload(metadata)` only returns true when
`capabilities.physicalDownload && safety.executionAvailable &&
safety.physicalDownloadEnabled && safety.verified` are all true. For every real
PLC adapter shipping today, at least one is false, so preflight returns
`ok: false` with the blockers explaining why. An unknown adapter id returns a
blocked result (never throws).

## Safety invariants for real PLC adapters

For every real-controller-I/O adapter in the current build:

- `capabilities.physicalDownload = false`
- `safety.executionAvailable = false`
- `safety.physicalDownloadEnabled = false`
- `safety.verified = false`
- `safety.defaultMode = "read-only"`
- `safety.riskLevel = "critical"` on any physical-download path

These hold until a specific backend adapter earns verified lab/field evidence.
No frontend toggle, no API field, and no metadata edit can flip them.

## API surface

- `GET /api/gateway/target-adapters` → `TargetAdapterMetadata[]`.
- `GET /api/gateway/download-adapters` → same payload (compatibility alias).
- `POST /api/gateway/download/preflight` → structured blocked
  `DownloadPreflightResult`.
- `POST /api/gateway/download` → **405**, physical download is never exposed.

## Adding a target pack

1. Add a `TargetAdapterMetadata` entry to `TARGET_ADAPTERS` with honest
   capability and safety flags (real I/O ⇒ all execution flags false).
2. Keep it metadata-only until a backend `TargetAdapter` exists.
3. When/if an executable adapter is built, register it on an
   `ExecutableTargetAdapterRegistry` on the backend only and let preflight gate
   it — never widen the API to return a handle.
4. `.ACD` is unsupported. L5X remains a legacy XML interchange/review path, not
   a proprietary workstation dependency. Read-only online monitoring must use
   ESCO-owned backend adapters or open protocols with explicit validation
   evidence.
