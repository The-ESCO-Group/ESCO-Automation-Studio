import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter, bytesEqual, concatBytes, toHex } from "./bytes";
import { hexToBytes } from "./testing/hex";

describe("ByteWriter", () => {
  it("writes little-endian integers", () => {
    const writer = new ByteWriter();
    writer.u8(0x01).u16(0x0203).u32(0x04050607);
    expect(toHex(writer.toBytes())).toBe("01 03 02 07 06 05 04");
  });

  it("grows past its initial capacity", () => {
    const writer = new ByteWriter(2);
    for (let i = 0; i < 100; i += 1) writer.u8(i & 0xff);
    expect(writer.length).toBe(100);
    expect(writer.toBytes()[99]).toBe(99);
  });

  it("writes ASCII and rejects non-ASCII", () => {
    const writer = new ByteWriter();
    writer.ascii("AB");
    expect(toHex(writer.toBytes())).toBe("41 42");
    expect(() => new ByteWriter().ascii("é")).toThrow(/non-ASCII/);
  });

  it("rejects out-of-range values", () => {
    expect(() => new ByteWriter().u8(256)).toThrow(RangeError);
    expect(() => new ByteWriter().u16(-1)).toThrow(RangeError);
    expect(() => new ByteWriter().u32(2 ** 32)).toThrow(RangeError);
  });
});

describe("ByteReader", () => {
  it("reads little-endian integers and floats", () => {
    const reader = new ByteReader(hexToBytes("d2 04 00 00 00 00 48 41"));
    expect(reader.i32()).toBe(1234);
    expect(reader.f32()).toBeCloseTo(12.5);
    expect(reader.remaining()).toBe(0);
  });

  it("reads 64-bit values as bigint", () => {
    const reader = new ByteReader(hexToBytes("08 07 06 05 04 03 02 01"));
    expect(reader.i64()).toBe(0x0102030405060708n);
  });

  it("throws a descriptive error on overrun", () => {
    const reader = new ByteReader(hexToBytes("01"));
    expect(() => reader.u32()).toThrow(/needed 4 byte\(s\) for u32/);
  });

  it("supports subarray views without absolute-offset confusion", () => {
    const backing = hexToBytes("ff ff d2 04 00 00");
    const view = backing.subarray(2);
    const reader = new ByteReader(view);
    expect(reader.i32()).toBe(1234);
  });
});

describe("helpers", () => {
  it("bytesEqual and concatBytes behave", () => {
    const a = hexToBytes("01 02");
    const b = hexToBytes("03");
    expect(bytesEqual(concatBytes([a, b]), hexToBytes("01 02 03"))).toBe(true);
    expect(bytesEqual(a, b)).toBe(false);
  });
});
