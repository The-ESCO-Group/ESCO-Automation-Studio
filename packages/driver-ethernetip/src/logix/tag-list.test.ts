import { describe, expect, it } from "vitest";
import { toHex } from "../bytes";
import { hexToBytes } from "../testing/hex";
import { CipResponseError, decodeMessageRouterResponse } from "../cip/message-router";
import { buildTagListRequest, isProgramSymbol, parseTagListReply } from "./tag-list";

describe("buildTagListRequest", () => {
  it("builds the golden controller-scope request from instance 0", () => {
    expect(toHex(buildTagListRequest())).toBe("55 02 20 6b 24 00 02 00 01 00 02 00");
  });

  it("uses a 16-bit instance segment for large start instances", () => {
    expect(toHex(buildTagListRequest(0x1234))).toBe("55 03 20 6b 25 00 34 12 02 00 01 00 02 00");
  });

  it("prefixes program scope with the program symbol", () => {
    const request = buildTagListRequest(0, "Program:Main");
    // "Program:Main" = 12 chars (even, no pad) → 7 words + class/instance 2 words.
    expect(toHex(request)).toBe(
      "55 09 91 0c 50 72 6f 67 72 61 6d 3a 4d 61 69 6e 20 6b 24 00 02 00 01 00 02 00",
    );
  });

  it("rejects program names without the Program: prefix", () => {
    expect(() => buildTagListRequest(0, "Main")).toThrow(/Program:Name/);
  });

  it("rejects negative start instances", () => {
    expect(() => buildTagListRequest(-1)).toThrow(/non-negative/);
  });
});

describe("parseTagListReply", () => {
  const PAGE =
    "d5 00 06 00 " + // reply 0x55|0x80, partial transfer → more pages
    "01 00 00 00 04 00 50 75 6d 70 c4 00 " + // instance 1, "Pump", atomic DINT
    "0a 00 00 00 05 00 54 61 6e 6b 31 23 a1"; // instance 10, "Tank1", struct dims=1 template 0x123

  it("decodes symbols, type words, and pagination", () => {
    const page = parseTagListReply(decodeMessageRouterResponse(hexToBytes(PAGE)));
    expect(page.symbols).toHaveLength(2);

    const pump = page.symbols[0];
    expect(pump).toMatchObject({
      instanceId: 1,
      name: "Pump",
      isStructure: false,
      dimensions: 0,
      atomicType: 0xc4,
      isSystem: false,
    });

    const tank = page.symbols[1];
    expect(tank).toMatchObject({
      instanceId: 10,
      name: "Tank1",
      isStructure: true,
      dimensions: 1,
      templateInstance: 0x123,
      isSystem: false,
    });

    expect(page.moreAvailable).toBe(true);
    expect(page.nextInstance).toBe(11);
  });

  it("reports a final page when status is success", () => {
    const finalPage = parseTagListReply(
      decodeMessageRouterResponse(hexToBytes("d5 00 00 00 01 00 00 00 04 00 50 75 6d 70 c4 00")),
    );
    expect(finalPage.moreAvailable).toBe(false);
    expect(finalPage.nextInstance).toBe(0);
  });

  it("marks system symbols by reserved bit and by __ prefix", () => {
    const reservedBit = parseTagListReply(
      decodeMessageRouterResponse(hexToBytes("d5 00 00 00 02 00 00 00 03 00 4d 61 70 c1 10")),
    );
    expect(reservedBit.symbols[0].isSystem).toBe(true);

    const dunder = parseTagListReply(
      decodeMessageRouterResponse(
        hexToBytes("d5 00 00 00 03 00 00 00 06 00 5f 5f 4d 65 74 61 c4 00"),
      ),
    );
    expect(dunder.symbols[0].name).toBe("__Meta");
    expect(dunder.symbols[0].isSystem).toBe(true);
  });

  it("identifies program symbols for recursive browsing", () => {
    const page = parseTagListReply(
      decodeMessageRouterResponse(
        // "Program:Main" → 12 chars, symbol type word with structure bit.
        hexToBytes("d5 00 00 00 05 00 00 00 0c 00 50 72 6f 67 72 61 6d 3a 4d 61 69 6e 68 80"),
      ),
    );
    expect(isProgramSymbol(page.symbols[0])).toBe(true);
  });

  it("throws CipResponseError on failure statuses", () => {
    const response = decodeMessageRouterResponse(hexToBytes("d5 00 08 00"));
    expect(() => parseTagListReply(response)).toThrow(CipResponseError);
    expect(() => parseTagListReply(response)).toThrow(/service not supported/);
  });

  it("throws on a truncated row instead of returning bad rows", () => {
    const truncated = decodeMessageRouterResponse(
      hexToBytes("d5 00 00 00 01 00 00 00 04 00 50 75"),
    );
    expect(() => parseTagListReply(truncated)).toThrow(RangeError);
  });
});
