# Hardware Validation Records

This directory holds the **signed lab-evidence records** that are the *only*
thing permitted to earn a real controller transport `verified: true`. The
procedure, gate mechanics, and test matrix live in
[`../goal-b-hardware-validation.md`](../goal-b-hardware-validation.md); this
folder is where the resulting records are committed.

## Current status

- **Records on file: none.**
- **Validated controller family + firmware list: empty.**
- `verified: true` constructions in the repo: **none** (enforced by
  `shipped-transports.guard.test.ts` in `@esco/controller-comm`).

Because no record exists, every shipped transport reports `verified: false`,
so `resolveConnectState` can only reach the **safety-blocked** path for a real
controller link. Real PLC upload/download/online-write remain blocked. Adding a
file here does **not** by itself flip the flag — a separate, deliberate
integration module must construct the transport with `verified: true` and cite
the record path (see §6 of the procedure), reviewed by someone other than the
author.

## Index

| Record | Controller family | Firmware revision(s) | Executing engineer | Reviewer | Date |
|--------|-------------------|----------------------|--------------------|----------|------|
| _(none yet)_ | | | | | |

## How to add a record

1. Copy the template below to `docs/validation-records/<family>-<fw>.md`
   (e.g. `controllogix-5580-v36.md`).
2. Execute the full §4 hardware test matrix through the complete ESCO chain
   (panel → API → gateway → driver → wire) — never ad-hoc scripts.
3. Fill in every section. Software/loopback/fake-target evidence is **not**
   acceptable for this flag.
4. Get an independent reviewer (not the executing engineer) to sign off.
5. Add the row to the index table above in the same PR.

## Evidence record template

```markdown
# Validation Record — <controller family> <firmware revision>

Status: <DRAFT | SIGNED>
Scope: <exact firmware revision(s) covered>. Everything else is NOT covered.

## 1. Lab setup
- Controller catalog number / series / firmware / serial:
- Network topology (direct vs chassis EtherNet/IP module + slot), IP config, switches:
- ESCO Studio commit hash:
- @esco/driver-ethernetip / @esco/driver-ethernetip-node versions:

## 2. Test matrix results (see goal-b-hardware-validation.md §4)
| # | Area | Result (pass/fail) | Notes |
|---|------|--------------------|-------|
| 1 | Session connect/idle/disconnect | | |
| 2 | Identity vs nameplate | | |
| 3 | Keyswitch positions | | |
| 4 | Browse (controller + program scopes) | | |
| 5 | Reads (atomics §4a, STRING, arrays) | | |
| 6 | UDT incl. packed BOOLs | | |
| 7 | Large tag (>488 bytes, fragmented) | | |
| 8 | Batch (>=25-tag watch) | | |
| 9 | Subscription (>=10 min) | | |
| 10 | Faults induce/clear | | |
| 11 | Link loss mid-watch | | |
| 12 | Routing (direct AND backplane) | | |
| 13 | Non-interference (scan time/logic) | | |
| 14 | Abuse safety (kill mid-request, rapid reconnect) | | |

§4a atomic coverage (BOOL, SINT, INT, DINT, LINT, USINT, UINT, UDINT, ULINT, REAL, LREAL):
note any types skipped because the project lacks them.

## 3. Artifacts
- Gateway audit log export (path/attachment):
- Online panel screenshots (identity/status/browse/watch):
- Packet capture (optional but recommended):

## 4. Sign-off
- Executing engineer (name, date):
- Independent reviewer (name, date) — must not be the executing engineer:
```
