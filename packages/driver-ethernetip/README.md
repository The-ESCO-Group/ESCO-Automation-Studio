# @esco/driver-ethernetip

ESCO-owned EtherNet/IP / CIP protocol codecs for the Goal B read-only
Allen-Bradley driver. Written from the public ODVA EtherNet/IP and CIP
specifications — **no Rockwell software, binaries, files, or services are used
or required**, at build time or at runtime.

## What this package is (current slice)

Pure, deterministic protocol code — byte codecs plus a sans-I/O session state
machine. Everything is unit-testable with byte vectors and crafted frames, and
runs anywhere TypeScript runs. There is **no socket and no controller endpoint
in this package**.

| Layer | Module | Provides |
|---|---|---|
| Encapsulation | `enip/encapsulation` | header codec, RegisterSession / UnregisterSession / ListIdentity, status decode |
| Stream framing | `enip/framing` | TCP-fragmentation-safe packet reassembly (`EnipStreamFramer`) |
| CPF | `enip/cpf` | Common Packet Format items, SendRRData payloads (UCMM) |
| EPATH | `cip/epath` | logical/symbolic/port segments, Logix tag-address parsing (`Program:Main.Tank[2].Level`) |
| Message router | `cip/message-router` | request/response codec, CIP general status names, `CipResponseError` |
| Routing | `cip/unconnected-send` | Unconnected Send (0x52) wrapper with backplane/slot route paths |
| Values | `cip/data-types` | atomic CIP types, arrays, Logix STRING; unknown structures stay raw bytes |
| Logix services | `logix/read-tag` | Read Tag (0x4C) + Read Tag Fragmented (0x52) builders and reply parsing |
| Logix services | `logix/tag-list` | Symbol Object (0x6B) Get Instance Attribute List (0x55) paging, symbol-type decode |
| Logix services | `logix/identity` | Identity object Get Attributes All + ListIdentity item parsing, fault bits |
| Session core | `session/session-core` | sans-I/O protocol state machine: registration, single-in-flight UCMM correlation, fragmented-read reassembly, tag-list pagination + program recursion (`receive()`/`takeOutbound()` — a transport drives it) |

The backend-only TCP transport and gateway adapter now live in
`@esco/driver-ethernetip-node`. Browser code must not import that package; the
web UI reaches it only through `apps/api` and `@esco/controller-gateway`.

## What this package is NOT (yet)

- **No transport in this package.** TCP/44818 socket work stays in the separate
  backend-only `@esco/driver-ethernetip-node` package. Nothing in this pure
  package can reach a controller by itself.
- **No writes — by construction.** There is no Write Tag, Read-Modify-Write,
  download, online-edit, or mode-change builder in this package, and adding
  one is out of scope for the read-only milestone.
- **No subscriptions.** Connected (Forward Open / class 1) messaging is not
  implemented; the first online milestone polls via UCMM.
- **No UDT template decoding.** Structure reads return the raw bytes plus the
  template handle; only the standard Logix STRING is decoded today.
- **No hardware validation.** Nothing here flips `verified: true` in
  `@esco/controller-comm` — that requires real, signed hardware evidence.

## Where this fits

```text
ESCO Automation Studio UI
  -> ESCO Online Session Manager
  -> ESCO Controller Gateway        (@esco/controller-gateway)
  -> ESCO driver adapters           (@esco/controller-comm seam)
  -> EtherNet/IP / CIP codecs       (this package)
  -> backend transport              (@esco/driver-ethernetip-node, TCP 44818)
```

The backend adapter implements `ReadOnlyControllerComms` from
`@esco/controller-comm` using these codecs plus a Node-only TCP transport, and
stays `verified: false` until hardware validation.
