# Goal B Hardware Validation — Evidence Flow & Commissioning Checklist

Last updated: 2026-06-07
Status: **PROCEDURE DEFINITION — no hardware validation has been performed.**
Every shipped transport still reports `verified: false`, and nothing in the
repo may change that. This document defines exactly what evidence earns
`verified: true`, how it is recorded, and how a validated link is
commissioned on site. It is the operational companion to the two-tier ladder
in `controller-readonly-driver.md`.

## 1. What `verified` means — and what it does not

- `verified: true` means: **this exact comms stack was exercised against real
  Allen-Bradley hardware, in a lab, through the full test matrix below, with
  recorded results and a named sign-off.**
- It does NOT mean safe for writes (the read-only milestone has no write path
  at any layer), does not waive rule 7 (no project match proof ⇒ Online
  Read-Only), and does not transfer across firmware families not listed in
  the evidence record.
- Software evidence — unit suites, the fake target (`dist/fake-target.mjs`),
  loopback tests, browser E2E — is **never acceptable** for this flag. Those
  prove chain mechanics; the flag asserts hardware behavior.

## 2. Gate mechanics (where the flag lives, how it is guarded)

| Mechanism | Location | Effect |
|---|---|---|
| `TransportCapabilities.verified` | `@esco/controller-comm` | `resolveConnectState` reaches a Connected state only when `realControllerIo && verified` |
| `InjectedReadOnlyTransportOptions.verified` | `read-only-driver.ts` | defaults false; the only sanctioned way to pass true |
| `shipped-transports.guard.test.ts` | `@esco/controller-comm` | CI fails if any shipped/default construction sets verified |
| `createEthernetIpReadOnlyTransport()` | `@esco/driver-ethernetip-node` | deliberately has NO verified parameter (guarded by test) |

Flipping the flag therefore requires a **new, deliberate integration module**
that constructs `InjectedReadOnlyControllerTransport(comms, { verified: true })`
directly, citing an evidence record — see §6. No such module exists today.

## 3. Evidence package — required contents

One evidence record per controller family + firmware revision. A record is a
versioned document (committed under `docs/validation-records/`, none exist
yet) containing:

1. **Lab setup**
   - Controller catalog number, series, firmware revision, serial number.
   - Network topology (direct / through chassis EtherNet/IP module + slot),
     IP configuration, any switches between.
   - ESCO Studio commit hash and `@esco/driver-ethernetip*` package versions.
2. **Test matrix results** (every row pass/fail + notes; see §4)
3. **Artifacts**
   - Gateway audit log export covering the entire run.
   - Screenshots of the Online panel for identity/status/browse/watch states.
   - Optional but recommended: packet capture of one full session.
4. **Sign-off**
   - Executing engineer (name, date).
   - Independent reviewer (name, date) — must not be the executing engineer.
   - Scope statement: exact firmware revisions covered; everything else is
     explicitly NOT covered by the record.

## 4. Hardware test matrix (read-only milestone)

All through the full ESCO chain (panel → API → gateway → driver → wire),
never through ad-hoc scripts:

| # | Area | Test | Pass criteria |
|---|---|---|---|
| 1 | Session | Connect, idle 10 min, disconnect | clean register/unregister; no controller-side faults or hung connections |
| 2 | Identity | Identity card vs nameplate | vendor/product/serial/firmware match the physical device |
| 3 | Keyswitch | All physical positions (Run / Program / Remote ×each) | panel mode matches the physical keyswitch within one status refresh |
| 4 | Browse | Controller + program scopes vs project listing | names/types/dims match; system symbols excluded |
| 5 | Reads | Atomics (each CIP type in §4a), STRING, arrays | values match a trusted reference display |
| 6 | UDT | Nested UDT incl. packed BOOLs | dotted members correct; unresolvable members reported undecoded, never wrong |
| 7 | Large tag | Tag > 488 bytes (forces fragmented reads) | reassembled value correct |
| 8 | Batch | ≥ 25-tag watch (multi-service chunking) | one wire round trip per chunk; values correct |
| 9 | Subscription | Watch a changing tag for ≥ 10 min | change events arrive; no leaks; CPU/memory stable on both ends |
| 10 | Faults | Induce a recoverable controller fault | fault bits surface; status Faulted; clears reflected after fault reset |
| 11 | Link loss | Pull cable mid-watch | status → faulted/lost within watchdog; no stale "online"; reconnect works |
| 12 | Routing | Direct AND backplane path ("1,slot") | both paths pass tests 2/4/5 |
| 13 | Non-interference | Controller scan time + logic behavior during all of the above | no measurable disruption; no controller log entries caused by ESCO |
| 14 | Abuse safety | Driver killed mid-request; rapid connect/disconnect ×20 | controller never faults; connection slots recover |

§4a atomic coverage: BOOL, SINT, INT, DINT, LINT, USINT, UINT, UDINT, ULINT,
REAL, LREAL (skip types the project genuinely lacks; note skips in the record).

## 5. Site commissioning checklist (after a record exists)

1. Confirm the controller family + firmware appears in a signed evidence
   record; otherwise STOP — lab validation first.
2. Network review: ESCO API host reachable from the engineering workstation;
   controller reachable from the API host only (the browser never talks CIP).
3. Desktop CSP / preflight allowlist updated for the API origin in the same
   reviewed change (see `controller-readonly-driver.md` integration note).
4. Connect via the Online panel; verify identity vs nameplate (test 2) and
   keyswitch (test 3) before relying on any data.
5. Record the commissioning in the site log: who, when, controller serial,
   evidence record reference.
6. Abort criteria: any mismatch in step 4, any controller-side fault, or any
   write affordance appearing anywhere in the UI (there must be none).

## 6. Change-control to flip `verified`

A PR that introduces a verified construction MUST contain, atomically:
- The integration module constructing the transport with `verified: true`,
  referencing the evidence record path in a code comment.
- The evidence record itself under `docs/validation-records/`.
- No change to `shipped-transports.guard.test.ts` semantics — the default
  remains false; verified instances are opt-in constructions, never defaults.
- Reviewer sign-off from someone other than the author.

Revocation: any field incident attributable to the comms stack, or any
firmware revision outside the record's scope appearing on site, reverts the
deployment to the unverified (safety-blocked) path until a new record exists.

## 7. Current status — honest summary

- Evidence records: **none**. Validated firmware list: **empty**.
- `verified: true` constructions in the repo: **none** (guarded by CI).
- Everything in §§3–6 is forward procedure, not performed work.
