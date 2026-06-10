import { describe, expect, it } from "vitest";
import { toHex } from "../bytes";
import { hexToBytes } from "../testing/hex";
import { CipResponseError, decodeMessageRouterResponse } from "../cip/message-router";
import {
  buildReadTagFragmentedRequest,
  buildReadTagRequest,
  parseReadTagReply,
} from "./read-tag";

describe("buildReadTagRequest", () => {
  it("builds the golden request for a controller-scope tag", () => {
    expect(toHex(buildReadTagRequest("Count"))).toBe(
      "4c 04 91 05 43 6f 75 6e 74 00 01 00",
    );
  });

  it("includes the element count for array reads", () => {
    expect(toHex(buildReadTagRequest("Pump", 3))).toBe("4c 03 91 04 50 75 6d 70 03 00");
  });

  it("rejects invalid element counts", () => {
    expect(() => buildReadTagRequest("Count", 0)).toThrow(/1\.\.65535/);
    expect(() => buildReadTagRequest("Count", 1.5)).toThrow(/1\.\.65535/);
  });
});

describe("buildReadTagFragmentedRequest", () => {
  it("appends the 32-bit byte offset", () => {
    expect(toHex(buildReadTagFragmentedRequest("Pump", 3, 0x100))).toBe(
      "52 03 91 04 50 75 6d 70 03 00 00 01 00 00",
    );
  });

  it("rejects invalid offsets", () => {
    expect(() => buildReadTagFragmentedRequest("Pump", 1, -1)).toThrow(/byte offset/);
  });
});

describe("parseReadTagReply", () => {
  it("decodes a DINT reply", () => {
    const response = decodeMessageRouterResponse(hexToBytes("cc 00 00 00 c4 00 d2 04 00 00"));
    const result = parseReadTagReply(response);
    expect(result.typeName).toBe("DINT");
    expect(result.value).toBe(1234);
    expect(result.partial).toBe(false);
  });

  it("flags partial transfers so callers continue with fragmented reads", () => {
    const response = decodeMessageRouterResponse(hexToBytes("d2 00 06 00 c4 00 01 00 00 00"));
    const result = parseReadTagReply(response, "Read Tag Fragmented");
    expect(result.partial).toBe(true);
    expect(result.value).toBe(1);
  });

  it("throws CipResponseError for missing tags", () => {
    const response = decodeMessageRouterResponse(hexToBytes("cc 00 05 01 07 21"));
    expect(() => parseReadTagReply(response)).toThrow(CipResponseError);
    expect(() => parseReadTagReply(response)).toThrow(/path destination unknown/);
  });
});

describe("read-only by construction", () => {
  it("exports no write/download/mode-change builders", async () => {
    const module = await import("./read-tag");
    const writeLike = Object.keys(module).filter((name) => /write|download|mode/i.test(name));
    expect(writeLike).toEqual([]);
  });
});
