import { describe, expect, it } from "vitest";
import { toHex } from "../bytes";
import { hexToBytes } from "../testing/hex";
import { buildReadTagRequest } from "../logix/read-tag";
import { backplaneRoute, encodeUnconnectedSendRequest } from "./unconnected-send";

describe("encodeUnconnectedSendRequest", () => {
  it("wraps an even-length embedded request with a backplane route", () => {
    const embedded = buildReadTagRequest("Count"); // 12 bytes, even
    const request = encodeUnconnectedSendRequest(embedded, backplaneRoute(0));
    expect(toHex(request)).toBe(
      "52 02 20 06 24 01 " + // Unconnected Send on Connection Manager
        "0a 05 0c 00 " + // priority/tick, timeout ticks, embedded length 12
        "4c 04 91 05 43 6f 75 6e 74 00 01 00 " + // embedded Read Tag request
        "01 00 01 00", // route words 1, reserved, port 1 / slot 0
    );
  });

  it("pads an odd-length embedded request before the route path", () => {
    const request = encodeUnconnectedSendRequest(hexToBytes("01 02 03"), backplaneRoute(3));
    expect(toHex(request)).toBe("52 02 20 06 24 01 0a 05 03 00 01 02 03 00 01 00 01 03");
  });

  it("honors priority and timeout overrides", () => {
    const request = encodeUnconnectedSendRequest(hexToBytes("01 02"), backplaneRoute(0), {
      priorityTimeTick: 0x07,
      timeoutTicks: 0xe9,
    });
    expect(toHex(request)).toBe("52 02 20 06 24 01 07 e9 02 00 01 02 01 00 01 00");
  });

  it("rejects an empty route", () => {
    expect(() => encodeUnconnectedSendRequest(hexToBytes("01 02"), [])).toThrow(
      /at least one route hop/,
    );
  });
});
