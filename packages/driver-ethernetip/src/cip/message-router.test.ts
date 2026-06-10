import { describe, expect, it } from "vitest";
import { toHex } from "../bytes";
import { hexToBytes } from "../testing/hex";
import { classSegment, instanceSegment, symbolSegment } from "./epath";
import {
  CipGeneralStatus,
  CipResponseError,
  cipStatusMessage,
  decodeMessageRouterResponse,
  encodeMessageRouterRequest,
  expectCipSuccess,
} from "./message-router";

describe("message router request", () => {
  it("encodes service, path words, path, and data", () => {
    const request = encodeMessageRouterRequest(
      0x55,
      [classSegment(0x6b), instanceSegment(0)],
      hexToBytes("02 00 01 00 02 00"),
    );
    expect(toHex(request)).toBe("55 02 20 6b 24 00 02 00 01 00 02 00");
  });

  it("encodes a request with no data", () => {
    const request = encodeMessageRouterRequest(0x01, [classSegment(0x01), instanceSegment(0x01)]);
    expect(toHex(request)).toBe("01 02 20 01 24 01");
  });

  it("supports symbolic paths", () => {
    const request = encodeMessageRouterRequest(0x4c, [symbolSegment("Count")], hexToBytes("01 00"));
    expect(toHex(request)).toBe("4c 04 91 05 43 6f 75 6e 74 00 01 00");
  });
});

describe("message router response", () => {
  it("decodes a success reply", () => {
    const response = decodeMessageRouterResponse(hexToBytes("cc 00 00 00 c4 00 d2 04 00 00"));
    expect(response.replyService).toBe(0xcc);
    expect(response.generalStatus).toBe(CipGeneralStatus.Success);
    expect(response.additionalStatus).toEqual([]);
    expect(toHex(response.data)).toBe("c4 00 d2 04 00 00");
  });

  it("decodes additional status words", () => {
    const response = decodeMessageRouterResponse(hexToBytes("cc 00 05 01 07 21"));
    expect(response.generalStatus).toBe(CipGeneralStatus.PathDestinationUnknown);
    expect(response.additionalStatus).toEqual([0x2107]);
    expect(response.data.length).toBe(0);
  });

  it("expectCipSuccess returns the payload on success", () => {
    const response = decodeMessageRouterResponse(hexToBytes("cc 00 00 00 aa"));
    expect(toHex(expectCipSuccess(response, "Read Tag"))).toBe("aa");
  });

  it("expectCipSuccess throws CipResponseError with status details", () => {
    const response = decodeMessageRouterResponse(hexToBytes("cc 00 05 01 07 21"));
    try {
      expectCipSuccess(response, "Read Tag 'Missing'");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CipResponseError);
      const cipError = error as CipResponseError;
      expect(cipError.message).toContain("Read Tag 'Missing'");
      expect(cipError.message).toContain("path destination unknown");
      expect(cipError.message).toContain("0x2107");
      expect(cipError.generalStatus).toBe(0x05);
    }
  });

  it("expectCipSuccess can allow partial transfers for paginated services", () => {
    const partial = decodeMessageRouterResponse(hexToBytes("d5 00 06 00 aa"));
    expect(() => expectCipSuccess(partial, "tag list")).toThrow(CipResponseError);
    expect(toHex(expectCipSuccess(partial, "tag list", { allowPartialTransfer: true }))).toBe("aa");
  });

  it("names common statuses and falls back for unknown ones", () => {
    expect(cipStatusMessage(0x04)).toContain("path segment error");
    expect(cipStatusMessage(0x99)).toBe("CIP general status 0x99");
  });
});
