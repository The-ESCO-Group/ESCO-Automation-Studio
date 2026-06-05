import { describe, expect, it } from "vitest";
import { isNumericLiteral, parseNumericLiteral } from "./operands";

describe("numeric literals", () => {
  it("recognizes and parses decimal and Logix radix literals", () => {
    expect(isNumericLiteral("123")).toBe(true);
    expect(parseNumericLiteral("123")).toBe(123);
    expect(parseNumericLiteral("-12.5")).toBe(-12.5);
    expect(parseNumericLiteral("16#FF")).toBe(255);
    expect(isNumericLiteral("-2#1010")).toBe(true);
    expect(parseNumericLiteral("-2#1010")).toBe(-10);
    expect(parseNumericLiteral("+8#17")).toBe(15);
  });

  it("accepts underscore digit-group separators like Studio 5000", () => {
    expect(parseNumericLiteral("1_000_000")).toBe(1000000);
    expect(parseNumericLiteral("16#00FF_00FF")).toBe(0x00ff00ff);
    expect(parseNumericLiteral("2#1010_1010")).toBe(0b10101010);
    expect(parseNumericLiteral("-16#FF_FF")).toBe(-65535);
    expect(parseNumericLiteral("1_234.567_8")).toBeCloseTo(1234.5678);
    expect(isNumericLiteral("16#FFFF_FFFF")).toBe(true);
  });

  it("rejects malformed underscore placement", () => {
    expect(parseNumericLiteral("_1000")).toBeUndefined();
    expect(parseNumericLiteral("1000_")).toBeUndefined();
    expect(parseNumericLiteral("1__000")).toBeUndefined();
    expect(parseNumericLiteral("16#_FF")).toBeUndefined();
    expect(parseNumericLiteral("16#FF_")).toBeUndefined();
    expect(isNumericLiteral("1__000")).toBe(false);
  });

  it("rejects invalid radix digits and non-literals", () => {
    expect(parseNumericLiteral("2#102")).toBeUndefined();
    expect(isNumericLiteral("2#102")).toBe(false);
    expect(parseNumericLiteral("17#10")).toBeUndefined();
    expect(isNumericLiteral("17#10")).toBe(false);
    expect(parseNumericLiteral("TagName")).toBeUndefined();
  });
});
