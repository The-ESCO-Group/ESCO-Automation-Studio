# Goal B — Forward Open / Connected Messaging Design

Last updated: 2026-06-07
Status: **DESIGN ONLY — nothing below is implemented.** This document records
protocol facts verified against public open-source EtherNet/IP stacks, the
facts still to verify, and the slice plan. Per Goal B rule 9, nothing here
may be described as done until each slice lands with tests.

## 1. What "Forward Open subscriptions" actually means — honest framing

CIP has **no tag-level server push** for Logix tag data. Class-1 cyclic
(UDP) connections carry I/O assemblies, not arbitrary tag reads; engineering
and HMI tools watch tags by **polling over class-3 CONNECTED explicit
messaging** opened with Forward Open. Therefore:

- The deliverable is **connected class-3 messaging**, which makes the
  existing polling cheaper and more robust (sequenced exchanges, a
  connection-scoped timeout instead of per-request watchdogs, and a larger
  packet budget via Large Forward Open).
- The Online panel's "polling" label REMAINS ACCURATE after this lands. No
  UI may start calling tag watching "push".

## 2. Verified protocol facts (public open-source behavior)

### Forward Open (service 0x54; Large Forward Open 0x5B)
On Connection Manager (class 0x06, instance 0x01), UCMM. Request data order:

| Field | Type | Notes |
|---|---|---|
| priority/time_tick | u8 | exact value to verify (§3) |
| timeout ticks | u8 | exact value to verify |
| O→T connection ID | u32 | 0 in request (target assigns) |
| T→O connection ID | u32 | originator-chosen ID |
| connection serial number | u16 | originator-chosen, unique per connection |
| originator vendor ID | u16 | |
| originator serial number | u32 | |
| timeout multiplier | u8 | exact value to verify |
| reserved | 3 bytes | zeros |
| O→T RPI | u32 µs | reference stack uses a fixed value |
| O→T network parameters | u16 (0x54) / u32 (0x5B) | see below |
| T→O RPI | u32 µs | |
| T→O network parameters | u16 / u32 | |
| transport class/trigger | u8 | expected 0xA3 (class 3, server); VERIFY |
| connection path | padded EPATH | route + Message Router (class 0x02, inst 1) |

Network parameters (verified pattern): base bits `0b0100_0010_0000_0000`
(variable size + class/priority bits) OR'd with the connection size —
size & 0x01FF in the u16 form (default 500), or `(base << 16) | (size & 0xFFFF)`
in the u32 Large form (default 4000).

Success reply carries the target-assigned O→T connection ID (used in CPF
addressing), echoes serial/vendor/originator-serial, and the actual RPIs.

### Connected requests (after Forward Open)
- Encapsulation command **SendUnitData (0x70)**.
- CPF: **connected address item 0x00A1** (data = 4-byte connection ID) +
  **connected data item 0x00B1** (data = **u16 sequence count** followed by
  the ordinary message-router request).
- Replies mirror the structure; the sequence count echoes back and is the
  request/response correlator (cycles 1..65535).

### Forward Close (service 0x4E)
Request data: priority/time_tick, timeout ticks, connection serial number,
originator vendor ID, originator serial number, then the connection path
(same as opened). Sent via UCMM.

## 3. Verification status

VERIFIED (2026-06-07, reference-stack constants module): priority/time_tick
0x0A, timeout ticks 0x05, timeout multiplier 0x07, transport class/trigger
0xA3, connection path = route + Message Router (class 0x02, instance 1).
Forward Close path field encoded as size-in-words u8 + reserved u8 + path.

STILL TO VERIFY before the session-core slice:
- Keepalive expectations against real targets (RPI × multiplier timeout —
  whether class-3 requires periodic traffic to stay open; the polling tick
  likely satisfies it, but this must be observed, not assumed).
- Connected-reply sequence offset consistency across firmware (loopback
  fake-target tests cannot prove this; hardware validation matrix row).

## 4. Proposed ESCO slices (each small, tested, read-only)

1. **Codec slice** — DONE (2026-06-07): `cip/forward-open.ts` ships
   builders/parsers for Forward Open 0x54, Large Forward Open 0x5B (u16/u32
   network parameters with the verified base bits), and Forward Close 0x4E
   (size + reserved + path form); `enip/cpf.ts` gained
   `encodeSendUnitDataPayload`/`decodeSendUnitDataPayload` (connection ID +
   u16 sequence + embedded message). 10 golden-vector tests; package suite
   190/190 green. Nothing consumes these yet — slices 2–4 remain.
2. **Session-core slice** — DONE (2026-06-07): `openConnected(options)` /
   `closeConnected()` / `isConnectedMode` on `LogixSessionCore`. UCMM stays
   the default; with a channel open, ALL existing request methods (reads,
   batches, tag lists, templates, identity) route through SendUnitData with
   a 1..65535 sequence cycle; sequence mismatches fail the session honestly;
   a refused Forward Open surfaces as a per-request error and the session
   stays usable over UCMM; Forward Close reverts routing; close()/fail()
   clear the channel. 5 new crafted-frame tests; package suite 195/195,
   downstream driver/api suites 60/60 unchanged. NOT yet used by the
   transport/driver — slices 3 (fake target) and 4 (driver opt-in) remain.
3. **Fake-target slice** — DONE (2026-06-07): `FakeLogixServer` answers
   Forward Open (allocates an O→T id, echoes serial/vendor/originator),
   routes SendUnitData connected requests through the same canned `handleCip`
   with sequence echo, and honors Forward Close (`forwardOpenCount` /
   `forwardCloseCount` counters for assertions). `LogixTcpClient` gained
   `openConnected`/`closeConnected`/`isConnectedMode` delegations. A loopback
   test opens a channel, reads a tag over connected messaging, and closes —
   driver-node suite 45/45, codec+api 212/212, api bundle rebuilt.
4. **Driver slice** — DONE (2026-06-07): `EthernetIpGatewayDriver` opt-in
   `connectedMessaging` option (default OFF). On connect it attempts Forward
   Open after the identity read; on ANY failure it stays on UCMM transparently
   and the connection message says so; `connectedMessagingActive` surfaces the
   outcome; disconnect sends a polite Forward Close first. 2 new loopback
   tests (negotiate + read + close; default-off no-Forward-Open invariant);
   driver-node + api suites 63/63; api bundle rebuilt.

**The Forward Open / connected-messaging chapter is complete** — all four
slices landed, read-only throughout, default behavior unchanged, every layer
tested. What remains is genuinely hardware-only: keepalive observation and
cross-firmware reply-offset checks (§3) belong to the hardware-validation
matrix, not to more loopback code.

Invariants across all slices: read-only surface unchanged (no write
builders), `verified: false` semantics untouched, the panel's polling label
stays, and every layer's existing tests keep passing.

## 5. Explicitly not in scope

- Class-1 cyclic I/O (UDP 2222, assemblies) — different milestone, if ever.
- Any write path. Forward Open does not change rule 8.
- Multi-session isolation (separate, coordination-gated work).
