import { describe, expect, it } from "vitest";
import { toHex } from "../bytes";
import { hexToBytes } from "../testing/hex";
import { CpfItemType } from "../enip/cpf";
import { decodeMessageRouterResponse } from "../cip/message-router";
import {
  buildIdentityRequest,
  decodeIdentityStatus,
  decodeKeyswitchPosition,
  formatSerialNumber,
  parseIdentityReply,
  parseListIdentityItem,
} from "./identity";

// vendor 1, device type 0x0e, product code 150, revision 33.11,
// status 0x0400 (major recoverable fault), serial 0x12345678, "1769-L33E".
const IDENTITY_CORE =
  "01 00 0e 00 96 00 21 0b 00 04 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45";

describe("buildIdentityRequest", () => {
  it("targets Get Attributes All on Identity instance 1", () => {
    expect(toHex(buildIdentityRequest())).toBe("01 02 20 01 24 01");
  });
});

describe("parseIdentityReply", () => {
  it("decodes vendor, revision, serial, product name, and fault bits", () => {
    const response = decodeMessageRouterResponse(hexToBytes(`81 00 00 00 ${IDENTITY_CORE}`));
    const identity = parseIdentityReply(response);
    expect(identity.vendorId).toBe(1);
    expect(identity.vendorName).toBe("Rockwell Automation/Allen-Bradley");
    expect(identity.deviceType).toBe(0x0e);
    expect(identity.productCode).toBe(150);
    expect(identity.revision).toBe("33.11");
    expect(identity.productName).toBe("1769-L33E");
    expect(identity.serialNumber).toBe(0x12345678);
    expect(formatSerialNumber(identity.serialNumber)).toBe("12345678");
    expect(identity.faulted).toBe(true);
    expect(identity.faults.majorRecoverable).toBe(true);
    expect(identity.faults.majorUnrecoverable).toBe(false);
  });

  it("leaves vendorName undefined for vendors it does not recognize", () => {
    const response = decodeMessageRouterResponse(
      hexToBytes("81 00 00 00 63 00 0e 00 96 00 01 00 00 00 01 00 00 00 02 58 59"),
    );
    const identity = parseIdentityReply(response);
    expect(identity.vendorId).toBe(0x63);
    expect(identity.vendorName).toBeUndefined();
    expect(identity.productName).toBe("XY");
    expect(identity.faulted).toBe(false);
  });

  it("throws on failure statuses", () => {
    const response = decodeMessageRouterResponse(hexToBytes("81 00 08 00"));
    expect(() => parseIdentityReply(response)).toThrow(/service not supported/);
  });
});

describe("parseListIdentityItem", () => {
  it("decodes the 0x000c item, skipping the big-endian sockaddr", () => {
    const item = {
      typeId: CpfItemType.ListIdentityResponse,
      data: hexToBytes(
        "01 00 " + // protocol version
          "00 02 af 12 c0 a8 01 0a 00 00 00 00 00 00 00 00 " + // sockaddr (skipped)
          "01 00 0e 00 96 00 21 0b 60 00 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45 " +
          "03", // state
      ),
    };
    const info = parseListIdentityItem(item);
    expect(info.protocolVersion).toBe(1);
    expect(info.productName).toBe("1769-L33E");
    expect(info.revision).toBe("33.11");
    expect(info.status).toBe(0x0060);
    expect(info.faulted).toBe(false);
    expect(info.state).toBe(3);
  });

  it("rejects items that are not ListIdentity responses", () => {
    expect(() =>
      parseListIdentityItem({ typeId: CpfItemType.NullAddress, data: new Uint8Array(0) }),
    ).toThrow(/expected ListIdentity item/);
  });
});

describe("decodeKeyswitchPosition", () => {
  it("decodes the documented status byte pairs", () => {
    expect(decodeKeyswitchPosition(0x1060)).toBe("Run");
    expect(decodeKeyswitchPosition(0x1160)).toBe("Run");
    expect(decodeKeyswitchPosition(0x3060)).toBe("Remote Run");
    expect(decodeKeyswitchPosition(0x3160)).toBe("Remote Run");
    expect(decodeKeyswitchPosition(0x2070)).toBe("Program");
    expect(decodeKeyswitchPosition(0x2170)).toBe("Program");
    expect(decodeKeyswitchPosition(0x3070)).toBe("Remote Program");
    expect(decodeKeyswitchPosition(0x3170)).toBe("Remote Program");
  });

  it("returns undefined for anything unlisted — never guesses", () => {
    expect(decodeKeyswitchPosition(0x0000)).toBeUndefined();
    expect(decodeKeyswitchPosition(0x0060)).toBeUndefined();
    expect(decodeKeyswitchPosition(0x0400)).toBeUndefined(); // faulted word
    expect(decodeKeyswitchPosition(0x3050)).toBeUndefined(); // unknown group
  });

  it("flows into parsed identities", () => {
    const response = decodeMessageRouterResponse(
      // status bytes "60 10" (low, high) → Run
      hexToBytes("81 00 00 00 01 00 0e 00 96 00 21 0b 60 10 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45"),
    );
    const identity = parseIdentityReply(response);
    expect(identity.keyswitch).toBe("Run");
    expect(identity.faulted).toBe(false);
  });
});

describe("decodeIdentityStatus", () => {
  it("decodes each fault bit independently", () => {
    expect(decodeIdentityStatus(0x0100).minorRecoverable).toBe(true);
    expect(decodeIdentityStatus(0x0200).minorUnrecoverable).toBe(true);
    expect(decodeIdentityStatus(0x0400).majorRecoverable).toBe(true);
    expect(decodeIdentityStatus(0x0800).majorUnrecoverable).toBe(true);
    const clean = decodeIdentityStatus(0x0060);
    expect(Object.values(clean).every((flag) => flag === false)).toBe(true);
  });
});
