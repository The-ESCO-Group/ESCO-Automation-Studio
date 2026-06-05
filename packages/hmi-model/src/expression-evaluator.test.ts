import { describe, expect, it } from "vitest";
import {
  evaluateHmiExpression,
  expressionTagReferences,
  type ExpressionTagLookup,
} from "./expression-evaluator";
import type { HmiTagQuality, HmiTagValue } from "./runtime-tag-provider";

function lookupFrom(
  tags: Record<string, HmiTagValue | { value: HmiTagValue; quality: HmiTagQuality }>,
): ExpressionTagLookup {
  return (path) => {
    if (!Object.hasOwn(tags, path)) return undefined;
    const entry = tags[path]!;
    if (entry && typeof entry === "object" && "value" in entry) return entry;
    return { value: entry as HmiTagValue, quality: "good" };
  };
}

describe("evaluateHmiExpression", () => {
  it("resolves tag references in braces", () => {
    const result = evaluateHmiExpression("{Tank_Level}", lookupFrom({ Tank_Level: 42 }));
    expect(result).toMatchObject({ ok: true, value: 42, quality: "good" });
    expect(result.references).toEqual(["Tank_Level"]);
  });

  it("resolves program- and system-scoped tag paths", () => {
    const lookup = lookupFrom({ "Program:MainProgram.Count": 5, "System.CurrentScreen": "Home" });
    expect(evaluateHmiExpression("{Program:MainProgram.Count}", lookup).value).toBe(5);
    expect(evaluateHmiExpression("{System.CurrentScreen}", lookup).value).toBe("Home");
  });

  it("evaluates boolean logic with short-circuit", () => {
    const lookup = lookupFrom({ A: true, B: false });
    expect(evaluateHmiExpression("{A} && !{B}", lookup).value).toBe(true);
    expect(evaluateHmiExpression("{A} || {B}", lookup).value).toBe(true);
    expect(evaluateHmiExpression("!{A}", lookup).value).toBe(false);
  });

  it("evaluates comparisons and arithmetic with precedence and parens", () => {
    const lookup = lookupFrom({ L: 80, SP: 75 });
    expect(evaluateHmiExpression("{L} > {SP}", lookup).value).toBe(true);
    expect(evaluateHmiExpression("2 + 3 * 4", lookup).value).toBe(14);
    expect(evaluateHmiExpression("(2 + 3) * 4", lookup).value).toBe(20);
    expect(evaluateHmiExpression("10 % 3", lookup).value).toBe(1);
  });

  it("supports the whitelisted functions", () => {
    const lookup = lookupFrom({ Running: true, V: 3.14159 });
    expect(evaluateHmiExpression('if({Running}, "RUN", "STOP")', lookup).value).toBe("RUN");
    expect(evaluateHmiExpression("min(5, 2, 9)", lookup).value).toBe(2);
    expect(evaluateHmiExpression("max(5, 2, 9)", lookup).value).toBe(9);
    expect(evaluateHmiExpression("clamp(120, 0, 100)", lookup).value).toBe(100);
    expect(evaluateHmiExpression("round({V}, 2)", lookup).value).toBe(3.14);
    expect(evaluateHmiExpression("formatNumber({V}, 1)", lookup).value).toBe("3.1");
  });

  it("reports a diagnostic and bad quality for a missing tag", () => {
    const result = evaluateHmiExpression("{Ghost} + 1", lookupFrom({}));
    expect(result.ok).toBe(false);
    expect(result.quality).toBe("bad");
    expect(result.diagnostics[0]?.code).toBe("unknown-tag");
  });

  it("propagates degraded tag quality into the result", () => {
    const lookup = lookupFrom({ Bad: { value: 5, quality: "uncertain" } });
    const result = evaluateHmiExpression("{Bad} + 1", lookup);
    expect(result.ok).toBe(true);
    expect(result.quality).toBe("uncertain");
    expect(result.value).toBe(6);
  });

  it("reports syntax diagnostics instead of throwing", () => {
    expect(evaluateHmiExpression("{A} +", lookupFrom({ A: 1 })).ok).toBe(false);
    expect(evaluateHmiExpression("(1 + 2", lookupFrom({})).ok).toBe(false);
    expect(evaluateHmiExpression("{Unterminated", lookupFrom({})).ok).toBe(false);
    expect(evaluateHmiExpression("", lookupFrom({})).ok).toBe(false);
  });

  it("flags division by zero as a runtime diagnostic", () => {
    const result = evaluateHmiExpression("1 / 0", lookupFrom({}));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("runtime");
  });

  it("cannot escape to JavaScript globals or prototypes", () => {
    // Bare identifiers that aren't true/false/null or a known function are errors.
    for (const src of [
      "constructor",
      "globalThis",
      "process",
      "this",
      "window",
      "constructor('return 1')()",
      "({}).__proto__",
    ]) {
      const result = evaluateHmiExpression(src, lookupFrom({}));
      expect(result.ok, `${src} should not evaluate`).toBe(false);
    }
    // A tag literally named to look like an attack is just an unknown tag, never code.
    const tagged = evaluateHmiExpression("{constructor}", lookupFrom({}));
    expect(tagged.ok).toBe(false);
    expect(tagged.diagnostics[0]?.code).toBe("unknown-tag");
  });

  it("only calls known functions", () => {
    expect(evaluateHmiExpression("alert(1)", lookupFrom({})).ok).toBe(false);
    expect(evaluateHmiExpression("eval('1')", lookupFrom({})).ok).toBe(false);
  });
});

describe("expressionTagReferences", () => {
  it("lists referenced tags without evaluating", () => {
    expect(expressionTagReferences("{A} > {B} && {A}").sort()).toEqual(["A", "B"]);
    expect(expressionTagReferences("not valid {C}")).toEqual(["C"]);
  });
});
