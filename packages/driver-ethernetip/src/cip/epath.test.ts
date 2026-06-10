import { describe, expect, it } from "vitest";
import { toHex } from "../bytes";
import {
  attributeSegment,
  classSegment,
  encodePaddedEpath,
  instanceSegment,
  memberSegment,
  portSegment,
  symbolSegment,
  tagAddressToSegments,
} from "./epath";

describe("encodePaddedEpath", () => {
  it("encodes a padded symbolic segment", () => {
    const { path, wordCount } = encodePaddedEpath([symbolSegment("MyTag")]);
    expect(toHex(path)).toBe("91 05 4d 79 54 61 67 00");
    expect(wordCount).toBe(4);
  });

  it("does not pad even-length symbol names", () => {
    const { path, wordCount } = encodePaddedEpath([symbolSegment("Pump")]);
    expect(toHex(path)).toBe("91 04 50 75 6d 70");
    expect(wordCount).toBe(3);
  });

  it("encodes 8-bit and 16-bit logical segments by value size", () => {
    expect(toHex(encodePaddedEpath([classSegment(0x6b), instanceSegment(0)]).path)).toBe(
      "20 6b 24 00",
    );
    expect(toHex(encodePaddedEpath([classSegment(0x6b), instanceSegment(0x1234)]).path)).toBe(
      "20 6b 25 00 34 12",
    );
    expect(toHex(encodePaddedEpath([attributeSegment(1)]).path)).toBe("30 01");
  });

  it("encodes 32-bit instance and member segments", () => {
    expect(toHex(encodePaddedEpath([instanceSegment(0x12345678)]).path)).toBe(
      "26 00 78 56 34 12",
    );
    expect(toHex(encodePaddedEpath([memberSegment(0x12345678)]).path)).toBe(
      "2a 00 78 56 34 12",
    );
    // 32-bit logical class is not a CIP format — reject rather than mis-encode.
    expect(() => encodePaddedEpath([classSegment(0x10000)])).toThrow(/encodable range/);
  });

  it("encodes simple port segments and rejects unsupported forms", () => {
    expect(toHex(encodePaddedEpath([portSegment(1, 0)]).path)).toBe("01 00");
    expect(() => encodePaddedEpath([portSegment(15, 0)])).toThrow(/ports 1\.\.14/);
    expect(() => encodePaddedEpath([portSegment(1, 300)])).toThrow(/0\.\.255/);
  });

  it("rejects invalid symbol names", () => {
    expect(() => encodePaddedEpath([symbolSegment("")])).toThrow(/not be empty/);
    expect(() => encodePaddedEpath([symbolSegment("x".repeat(256))])).toThrow(/255/);
  });
});

describe("tagAddressToSegments", () => {
  it("parses a controller-scope tag", () => {
    expect(tagAddressToSegments("Motor1")).toEqual([symbolSegment("Motor1")]);
  });

  it("parses program scope, nesting, and array elements", () => {
    expect(tagAddressToSegments("Program:MainProgram.Counter[2].ACC")).toEqual([
      symbolSegment("Program:MainProgram"),
      symbolSegment("Counter"),
      memberSegment(2),
      symbolSegment("ACC"),
    ]);
  });

  it("parses multi-dimensional subscripts", () => {
    expect(tagAddressToSegments("Grid[1,2]")).toEqual([
      symbolSegment("Grid"),
      memberSegment(1),
      memberSegment(2),
    ]);
  });

  it("encodes the full documented example to stable bytes", () => {
    const { wordCount } = encodePaddedEpath(
      tagAddressToSegments("Program:MainProgram.Counter[2].ACC"),
    );
    // 22 (program) + 10 (Counter) + 2 (element) + 6 (ACC) = 40 bytes.
    expect(wordCount).toBe(20);
  });

  it("rejects bit-level addressing with a clear message", () => {
    expect(() => tagAddressToSegments("Word.3")).toThrow(/bit-level member/);
  });

  it("rejects malformed addresses", () => {
    expect(() => tagAddressToSegments("")).toThrow(/not be empty/);
    expect(() => tagAddressToSegments("Tag..X")).toThrow(/empty component/);
    expect(() => tagAddressToSegments("Bad-Name")).toThrow(/invalid tag path component/);
    expect(() => tagAddressToSegments("Arr[1,]")).toThrow(/invalid tag path component/);
  });
});
