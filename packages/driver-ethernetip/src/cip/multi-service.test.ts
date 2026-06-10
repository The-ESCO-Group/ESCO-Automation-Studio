import { describe, expect, it } from "vitest";
import { toHex } from "../bytes";
import { hexToBytes } from "../testing/hex";
import { buildReadTagRequest } from "../logix/read-tag";
import { decodeMessageRouterResponse } from "./message-router";
import {
  encodeMultipleServicePacket,
  encodeMultipleServiceReply,
  parseMultipleServiceReply,
} from "./multi-service";

describe("encodeMultipleServicePacket", () => {
  it("builds the golden request for two embedded tag reads", () => {
    const request = encodeMultipleServicePacket([
      buildReadTagRequest("A"),
      buildReadTagRequest("B"),
    ]);
    expect(toHex(request)).toBe(
      "0a 02 20 02 24 01 " + // service 0x0A on Message Router class 2 instance 1
        "02 00 06 00 0e 00 " + // count 2, offsets 6 and 14
        "4c 02 91 01 41 00 01 00 " + // Read Tag "A"
        "4c 02 91 01 42 00 01 00", // Read Tag "B"
    );
  });

  it("rejects an empty batch", () => {
    expect(() => encodeMultipleServicePacket([])).toThrow(/at least one/);
  });
});

describe("parseMultipleServiceReply", () => {
  it("splits embedded replies positionally (golden bytes)", () => {
    const reply = decodeMessageRouterResponse(
      hexToBytes(
        "8a 00 1e 00 " + // outer: 0x0A|0x80, embedded service error
          "02 00 06 00 10 00 " + // count 2, offsets 6 and 16
          "cc 00 00 00 c4 00 01 00 00 00 " + // embedded DINT 1 (10 bytes)
          "cc 00 05 01 07 21", // embedded path-destination-unknown
      ),
    );
    const embedded = parseMultipleServiceReply(reply);
    expect(embedded).toHaveLength(2);
    expect(embedded[0].generalStatus).toBe(0x00);
    expect(toHex(embedded[0].data)).toBe("c4 00 01 00 00 00");
    expect(embedded[1].generalStatus).toBe(0x05);
    expect(embedded[1].additionalStatus).toEqual([0x2107]);
  });

  it("round-trips through the reply encoder used by the fake target", () => {
    const reply = encodeMultipleServiceReply(
      [hexToBytes("cc 00 00 00 c4 00 2a 00 00 00"), hexToBytes("cc 00 05 01 07 21")],
      0x1e,
    );
    const embedded = parseMultipleServiceReply(decodeMessageRouterResponse(reply));
    expect(embedded).toHaveLength(2);
    expect(embedded[0].generalStatus).toBe(0x00);
    expect(embedded[1].generalStatus).toBe(0x05);
  });

  it("rejects unexpected outer statuses and corrupt offsets", () => {
    const failed = decodeMessageRouterResponse(hexToBytes("8a 00 08 00"));
    expect(() => parseMultipleServiceReply(failed)).toThrow(/0x08/);

    const corrupt = decodeMessageRouterResponse(
      hexToBytes("8a 00 00 00 01 00 ff 00 cc 00 00 00"),
    );
    expect(() => parseMultipleServiceReply(corrupt)).toThrow(/invalid bounds/);
  });
});
