import { describe, expect, it } from "vitest";
import { ByteReader, toHex } from "../bytes";
import { hexToBytes } from "../testing/hex";
import {
  CpfItemType,
  decodeCpf,
  decodeSendRRDataPayload,
  encodeCpf,
  encodeSendRRDataPayload,
  extractUnconnectedData,
} from "./cpf";

describe("CPF codec", () => {
  it("encodes and decodes an item list", () => {
    const encoded = encodeCpf([
      { typeId: CpfItemType.NullAddress, data: new Uint8Array(0) },
      { typeId: CpfItemType.UnconnectedData, data: hexToBytes("de ad") },
    ]);
    expect(toHex(encoded)).toBe("02 00 00 00 00 00 b2 00 02 00 de ad");

    const items = decodeCpf(new ByteReader(encoded));
    expect(items).toHaveLength(2);
    expect(items[0].typeId).toBe(CpfItemType.NullAddress);
    expect(items[1].typeId).toBe(CpfItemType.UnconnectedData);
    expect(toHex(items[1].data)).toBe("de ad");
  });

  it("builds the golden SendRRData payload for a UCMM request", () => {
    const payload = encodeSendRRDataPayload(hexToBytes("de ad"));
    expect(toHex(payload)).toBe(
      "00 00 00 00 0a 00 02 00 00 00 00 00 b2 00 02 00 de ad",
    );
  });

  it("round-trips a SendRRData payload and extracts the CIP reply", () => {
    const decoded = decodeSendRRDataPayload(encodeSendRRDataPayload(hexToBytes("cc 00 00 00"), 5));
    expect(decoded.interfaceHandle).toBe(0);
    expect(decoded.timeout).toBe(5);
    expect(toHex(extractUnconnectedData(decoded.items))).toBe("cc 00 00 00");
  });

  it("throws a useful error when the unconnected-data item is missing", () => {
    expect(() =>
      extractUnconnectedData([{ typeId: CpfItemType.NullAddress, data: new Uint8Array(0) }]),
    ).toThrow(/no unconnected-data item/);
  });

  it("throws on a truncated item", () => {
    expect(() => decodeCpf(new ByteReader(hexToBytes("01 00 b2 00 05 00 01")))).toThrow(RangeError);
  });
});
