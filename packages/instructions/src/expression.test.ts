import { describe, expect, it } from "vitest";
import { evaluateExpression, isValidExpression } from "./expression";

/** Evaluate against a tag map; undefined tags resolve to 0 (like tag memory). */
function evalWith(expression: string, tags: Record<string, number> = {}): number | undefined {
  const result = evaluateExpression(expression, (path) => tags[path] ?? 0);
  return result.ok ? result.value : undefined;
}

describe("expression engine — arithmetic", () => {
  it("honours operator precedence and parentheses", () => {
    expect(evalWith("1 + 2 * 3 - 4 % 3")).toBe(6);
    expect(evalWith("(1 + 2) * -3")).toBe(-9);
    expect(evalWith("((A + B) * C[1]) - Motor.Speed", { A: 2, B: 4, "C[1]": 5, "Motor.Speed": 10 })).toBe(20);
  });

  it("parses radix literals and unary signs", () => {
    expect(evalWith("-16#10 + +2#1010 * (8#7 - 4)")).toBe(14);
    expect(evalWith("16#FF")).toBe(255);
    expect(evalWith("2#1010")).toBe(10);
  });

  it("treats divide/modulo by zero as 0 (deterministic, no crash)", () => {
    expect(evalWith("10 / (A - A)", { A: 3 })).toBe(0);
    expect(evalWith("10 % 0")).toBe(0);
  });

  it("supports MOD as a keyword synonym for %", () => {
    expect(evalWith("10 MOD 3")).toBe(1);
    expect(evalWith("10 MOD 3")).toBe(evalWith("10 % 3"));
  });

  it("computes power right-associatively, below unary on the right", () => {
    expect(evalWith("2 ** 10")).toBe(1024);
    expect(evalWith("2 ** 3 ** 2")).toBe(512); // 2 ** (3 ** 2)
    expect(evalWith("-2 ** 2")).toBe(-4); // -(2 ** 2)
    expect(evalWith("2 ** -1")).toBe(0.5);
  });
});

describe("expression engine — relational and logical", () => {
  it("evaluates relational operators to 1/0", () => {
    expect(evalWith("5 > 3")).toBe(1);
    expect(evalWith("5 < 3")).toBe(0);
    expect(evalWith("5 >= 5")).toBe(1);
    expect(evalWith("5 <= 4")).toBe(0);
    expect(evalWith("5 = 5")).toBe(1);
    expect(evalWith("5 <> 5")).toBe(0);
  });

  it("treats AND/OR/XOR/NOT as bitwise (Logix semantics)", () => {
    expect(evalWith("1 AND 1")).toBe(1);
    expect(evalWith("1 AND 0")).toBe(0);
    expect(evalWith("1 OR 0")).toBe(1);
    expect(evalWith("1 XOR 1")).toBe(0);
    expect(evalWith("12 AND 10")).toBe(8); // 1100 & 1010 = 1000
    expect(evalWith("NOT 0")).toBe(-1); // bitwise complement, not logical
  });

  it("combines relational results with logical operators (relational binds tighter)", () => {
    expect(evalWith("Level >= 100 AND Pump", { Level: 120, Pump: 1 })).toBe(1);
    expect(evalWith("Level >= 100 AND Pump", { Level: 80, Pump: 1 })).toBe(0);
    expect(evalWith("A > B OR C > D", { A: 1, B: 9, C: 5, D: 2 })).toBe(1);
  });
});

describe("expression engine — functions", () => {
  it("evaluates the math function set", () => {
    expect(evalWith("ABS(-5)")).toBe(5);
    expect(evalWith("SQR(9)")).toBe(3);
    expect(evalWith("SQRT(16)")).toBe(4);
    expect(evalWith("TRN(3.9)")).toBe(3);
    expect(evalWith("SIN(0)")).toBe(0);
    expect(evalWith("DEG(0)")).toBe(0);
    expect(evalWith("ABS(A - B) > 2", { A: 1, B: 9 })).toBe(1);
  });

  it("is case-insensitive for functions and keyword operators", () => {
    expect(evalWith("abs(-3)")).toBe(3);
    expect(evalWith("1 and 1")).toBe(1);
  });
});

describe("expression engine — syntax validity", () => {
  it("rejects malformed expressions (ok:false)", () => {
    expect(evalWith("Math.max(A, 1)")).toBeUndefined(); // member path then '(' + comma
    expect(evalWith("A + (1 *)")).toBeUndefined();
    expect(evalWith("2#102")).toBeUndefined(); // invalid digit for base 2
    expect(evalWith("foo(3)")).toBeUndefined(); // unknown function
    expect(evalWith("1 +")).toBeUndefined();
    expect(evalWith("(1 + 2")).toBeUndefined();
    expect(evalWith("1, 2")).toBeUndefined(); // stray comma
    expect(evalWith("")).toBeUndefined();
  });

  it("accepts a syntactically valid expression even when its value is non-finite", () => {
    // LN(0) is a domain error: syntactically valid (ok), value non-finite.
    const result = evaluateExpression("LN(level)", () => 0);
    expect(result.ok).toBe(true);
    expect(result.ok && Number.isFinite(result.value)).toBe(false);
    expect(isValidExpression("LN(level)")).toBe(true);
    expect(isValidExpression("Speed * 2 + Offset")).toBe(true);
    expect(isValidExpression("Math.max(A, 1)")).toBe(false);
  });
});
