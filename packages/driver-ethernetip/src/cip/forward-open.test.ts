import { describe, expect, it } from "vitest";
import { toHex } from "../bytes";
import { hexToBytes } from "../testing/hex";
import {
  decodeSendUnitDataPayload,
  encodeSendUnitDataPayload,
} from "../enip/cpf";
import { decodeMessageRouterResponse } from "./message-router";
import {
  buildForwardCloseRequest,
  buildForwardOpenRequest,
  parseForwardCloseReply,
  parseForwardOpenReply,
} from "./forward-open";

const IDS = {
  originatorConnectionId: 0x11223344,
  connectionSerial: 0x5566,
  vendorId: 0x004d,
  originatorSerial: 0x778899aa,
};

describe("buildForwardOpenRequest", () => {
  it("builds the golden standard Forward Open", () => {
    expect(toHex(buildForwardOpenRequest(IDS))).toBe(
      "54 02 20 06 24 01 " + // service on Connection Manager
        "0a 05 " + // priority/time_tick, timeout ticks
        "00 00 00 00 44 33 22 11 " + // O→T (target assigns), T→O id
        "66 55 4d 00 aa 99 88 77 " + // serial, vendor, originator serial
        "07 00 00 00 " + // timeout multiplier + reserved
        "01 40 20 00 f4 43 " + // O→T RPI + net params (0x4200|500)
        "01 40 20 00 f4 43 " + // T→O RPI + net params
        "a3 " + // transport class 3, server
        "02 20 02 24 01", // path: 2 words → Message Router
    );
  });

  it("builds the golden Large Forward Open (u32 net params)", () => {
    expect(toHex(buildForwardOpenRequest({ ...IDS, large: true }))).toBe(
      "5b 02 20 06 24 01 0a 05 00 00 00 00 44 33 22 11 66 55 4d 00 aa 99 88 77 " +
        "07 00 00 00 01 40 20 00 a0 0f 00 42 01 40 20 00 a0 0f 00 42 a3 02 20 02 24 01",
    );
  });

  it("prefixes the chassis route in the connection path", () => {
    const request = buildForwardOpenRequest({ ...IDS, route: [{ port: 1, link: 0 }] });
    expect(toHex(request).endsWith("a3 03 01 00 20 02 24 01")).toBe(true);
  });

  it("rejects oversized standard connections", () => {
    expect(() => buildForwardOpenRequest({ ...IDS, connectionSizeBytes: 600 })).toThrow(
      /set large: true/,
    );
  });
});

describe("parseForwardOpenReply", () => {
  it("extracts connection ids, serials, and granted APIs", () => {
    const reply = parseForwardOpenReply(
      decodeMessageRouterResponse(
        hexToBytes(
          "d4 00 00 00 78 56 34 12 44 33 22 11 66 55 4d 00 aa 99 88 77 " +
            "01 40 20 00 01 40 20 00 00 00",
        ),
      ),
    );
    expect(reply).toEqual({
      otConnectionId: 0x12345678,
      toConnectionId: 0x11223344,
      connectionSerial: 0x5566,
      vendorId: 0x004d,
      originatorSerial: 0x778899aa,
      otApiMicroseconds: 0x00204001,
      toApiMicroseconds: 0x00204001,
    });
  });

  it("throws on failure statuses (e.g. connection refused)", () => {
    const failed = decodeMessageRouterResponse(hexToBytes("d4 00 01 01 00 01"));
    expect(() => parseForwardOpenReply(failed)).toThrow(/connection failure/);
  });
});

describe("Forward Close", () => {
  it("builds the golden Forward Close (size, reserved byte, path)", () => {
    expect(toHex(buildForwardCloseRequest(IDS))).toBe(
      "4e 02 20 06 24 01 0a 05 66 55 4d 00 aa 99 88 77 02 00 20 02 24 01",
    );
  });

  it("parses the close reply echo", () => {
    const reply = parseForwardCloseReply(
      decodeMessageRouterResponse(hexToBytes("ce 00 00 00 66 55 4d 00 aa 99 88 77 00 00")),
    );
    expect(reply).toEqual({
      connectionSerial: 0x5566,
      vendorId: 0x004d,
      originatorSerial: 0x778899aa,
    });
  });
});

describe("SendUnitData connected framing", () => {
  it("round-trips connection id, sequence, and message (golden bytes)", () => {
    const payload = encodeSendUnitDataPayload(0x12345678, 7, hexToBytes("de ad"));
    expect(toHex(payload)).toBe(
      "00 00 00 00 00 00 02 00 a1 00 04 00 78 56 34 12 b1 00 04 00 07 00 de ad",
    );
    const decoded = decodeSendUnitDataPayload(payload);
    expect(decoded.connectionId).toBe(0x12345678);
    expect(decoded.sequence).toBe(7);
    expect(toHex(decoded.message)).toBe("de ad");
  });

  it("rejects payloads missing the connected items", () => {
    expect(() =>
      decodeSendUnitDataPayload(hexToBytes("00 00 00 00 00 00 01 00 00 00 00 00")),
    ).toThrow(/connected address\/data/);
  });
});
