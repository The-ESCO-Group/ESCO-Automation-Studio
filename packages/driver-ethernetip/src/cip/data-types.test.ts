import { describe, expect, it } from "vitest";
import { toHex } from "../bytes";
import { hexToBytes } from "../testing/hex";
import {
  CipType,
  LOGIX_STRING_STRUCTURE_HANDLE,
  STRUCTURE_TYPE_CODE,
  cipScalarSize,
  cipTypeName,
  decodeTypedValue,
} from "./data-types";

describe("decodeTypedValue", () => {
  it("decodes a DINT scalar", () => {
    const decoded = decodeTypedValue(hexToBytes("c4 00 d2 04 00 00"));
    expect(decoded.typeCode).toBe(CipType.DINT);
    expect(decoded.typeName).toBe("DINT");
    expect(decoded.value).toBe(1234);
    expect(decoded.elementCount).toBe(1);
  });

  it("decodes negative integers", () => {
    expect(decodeTypedValue(hexToBytes("c3 00 ff ff")).value).toBe(-1);
    expect(decodeTypedValue(hexToBytes("c2 00 80")).value).toBe(-128);
  });

  it("decodes a DINT array", () => {
    const decoded = decodeTypedValue(
      hexToBytes("c4 00 01 00 00 00 02 00 00 00 03 00 00 00"),
    );
    expect(decoded.value).toEqual([1, 2, 3]);
    expect(decoded.elementCount).toBe(3);
  });

  it("decodes BOOL truthiness from the wire byte", () => {
    expect(decodeTypedValue(hexToBytes("c1 00 ff")).value).toBe(true);
    expect(decodeTypedValue(hexToBytes("c1 00 00")).value).toBe(false);
  });

  it("decodes REAL and LREAL", () => {
    expect(decodeTypedValue(hexToBytes("ca 00 00 00 48 41")).value).toBeCloseTo(12.5);
    const lreal = decodeTypedValue(hexToBytes("cb 00 00 00 00 00 00 00 f0 3f"));
    expect(lreal.value).toBe(1);
  });

  it("decodes LINT/ULINT as bigint", () => {
    const decoded = decodeTypedValue(hexToBytes("c5 00 08 07 06 05 04 03 02 01"));
    expect(decoded.value).toBe(0x0102030405060708n);
  });

  it("decodes a Logix STRING (with trailing pad bytes tolerated)", () => {
    const decoded = decodeTypedValue(hexToBytes("a0 02 ce 0f 02 00 00 00 4f 4b 00 00 00"));
    expect(decoded.typeCode).toBe(STRUCTURE_TYPE_CODE);
    expect(decoded.structureHandle).toBe(LOGIX_STRING_STRUCTURE_HANDLE);
    expect(decoded.typeName).toBe("STRING");
    expect(decoded.value).toBe("OK");
  });

  it("returns raw bytes for unknown structure templates instead of guessing", () => {
    const decoded = decodeTypedValue(hexToBytes("a0 02 34 12 aa bb"));
    expect(decoded.typeName).toBe("STRUCT");
    expect(decoded.structureHandle).toBe(0x1234);
    expect(decoded.value).toBeInstanceOf(Uint8Array);
    expect(toHex(decoded.value as Uint8Array)).toBe("aa bb");
  });

  it("rejects misaligned or empty payloads", () => {
    expect(() => decodeTypedValue(hexToBytes("c4 00 01 00 00"))).toThrow(/not a multiple/);
    expect(() => decodeTypedValue(hexToBytes("c4 00"))).toThrow(/no value bytes/);
    expect(() => decodeTypedValue(hexToBytes("ff 0f aa"))).toThrow(/unsupported CIP type/);
  });

  it("rejects a STRING whose length exceeds its payload", () => {
    expect(() => decodeTypedValue(hexToBytes("a0 02 ce 0f 50 00 00 00 4f 4b"))).toThrow(
      /claims 80 byte/,
    );
  });
});

describe("type metadata", () => {
  it("names types and reports scalar sizes", () => {
    expect(cipTypeName(CipType.REAL)).toBe("REAL");
    expect(cipTypeName(0x1234)).toBe("0x1234");
    expect(cipScalarSize(CipType.LINT)).toBe(8);
    expect(cipScalarSize(0x1234)).toBeUndefined();
  });
});
