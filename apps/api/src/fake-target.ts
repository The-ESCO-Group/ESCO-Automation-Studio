/**
 * TEST-ONLY standalone fake EtherNet/IP target — lets the browser E2E (and
 * manual demos) exercise the REAL EtherNet/IP driver path without hardware.
 *
 * This is NOT a controller emulator: it answers a small canned CIP database
 * built from the ESCO codecs (identity with keyswitch Run, a two-tag symbol
 * table, tag reads incl. the batched Multiple Service Packet the driver
 * uses). Passing against it proves the ESCO chain's mechanics only — it
 * proves nothing about hardware validation, and `verified` stays false.
 *
 * Run: node dist/fake-target.mjs   (port via ESCO_FAKE_TARGET_PORT, default 44991)
 */

import {
  bytesEqual,
  buildIdentityRequest,
  buildReadTagRequest,
  buildTagListRequest,
  encodeMultipleServicePacket,
  encodeMultipleServiceReply,
} from "@esco/driver-ethernetip";
import { FakeLogixServer } from "@esco/driver-ethernetip-node";

const PORT = Number(process.env.ESCO_FAKE_TARGET_PORT ?? 44991);

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.trim().split(/\s+/).map((pair) => Number.parseInt(pair, 16)));
}

// Identity: 1769-L33E, rev 33.11, status bytes "60 10" → keyswitch Run.
const IDENTITY_REPLY = hexToBytes(
  "81 00 00 00 01 00 0e 00 96 00 21 0b 60 10 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45",
);
// Controller-scope symbols: Pump (DINT), Vals (DINT[]) — final page.
const TAG_LIST_REPLY = hexToBytes(
  "d5 00 00 00 01 00 00 00 04 00 50 75 6d 70 c4 00 03 00 00 00 04 00 56 61 6c 73 c4 20",
);
const PUMP_REPLY = hexToBytes("cc 00 00 00 c4 00 d2 04 00 00"); // 1234
const VALS_REPLY = hexToBytes("cc 00 00 00 c4 00 01 00 00 00 02 00 00 00 03 00 00 00"); // [1,2,3]

// The driver batches watch polls as one Multiple Service Packet.
const BATCH_REQUEST = encodeMultipleServicePacket([
  buildReadTagRequest("Pump"),
  buildReadTagRequest("Vals"),
]);
const BATCH_REPLY = encodeMultipleServiceReply([PUMP_REPLY, VALS_REPLY]);

const server = new FakeLogixServer({
  handleCip: (request) => {
    if (bytesEqual(request, buildIdentityRequest())) return IDENTITY_REPLY;
    if (bytesEqual(request, buildTagListRequest(0))) return TAG_LIST_REPLY;
    if (bytesEqual(request, buildReadTagRequest("Pump"))) return PUMP_REPLY;
    if (bytesEqual(request, buildReadTagRequest("Vals"))) return VALS_REPLY;
    if (bytesEqual(request, BATCH_REQUEST)) return BATCH_REPLY;
    return undefined;
  },
});

server
  .listen(PORT)
  .then((port) => {
    console.log(`ESCO fake EtherNet/IP target (TEST-ONLY) listening on 127.0.0.1:${port}`);
    console.log("Tags: Pump (DINT=1234), Vals (DINT[3]=[1,2,3]); identity 1769-L33E, mode Run.");
  })
  .catch((error: unknown) => {
    console.error("fake target failed to start:", error);
    process.exit(1);
  });
