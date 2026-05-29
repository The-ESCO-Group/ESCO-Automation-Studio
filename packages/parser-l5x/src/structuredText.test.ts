import { describe, expect, it } from "vitest";
import { analyzeStructuredText, tokenizeStructuredText } from "./structuredText";

const messages = (source: string): string[] => analyzeStructuredText(source).findings.map((f) => f.message);

describe("Structured Text analyzer — valid source", () => {
  it("accepts well-formed blocks with no findings", () => {
    const ok = (src: string) => expect(analyzeStructuredText(src).ok, src).toBe(true);
    ok("IF Start THEN\n  Level := Level + 1;\nEND_IF;");
    ok("FOR i := 0 TO 10 BY 1 DO\n  Sum := Sum + Data[i];\nEND_FOR;");
    ok("WHILE Running DO\n  Count := Count - 1;\nEND_WHILE;");
    ok("REPEAT\n  X := X + 1;\nUNTIL X >= 10\nEND_REPEAT;");
    ok("CASE State OF\n  1: Y := 10;\n  2: Y := 20;\nELSE\n  Y := 0;\nEND_CASE;");
  });

  it("accepts nested blocks and ELSIF/ELSE", () => {
    const src = [
      "IF a THEN",
      "  IF b THEN",
      "    x := 1;",
      "  ELSIF c THEN",
      "    x := 2;",
      "  ELSE",
      "    x := 3;",
      "  END_IF;",
      "END_IF;",
    ].join("\n");
    expect(analyzeStructuredText(src).ok).toBe(true);
  });

  it("ignores parentheses and brackets inside comments and strings", () => {
    expect(analyzeStructuredText("X := 1; (* a ( comment ) with [ unbalanced *)").ok).toBe(true);
    expect(analyzeStructuredText("Msg := 'a ( string [ with ) brackets';").ok).toBe(true);
    expect(analyzeStructuredText("Y := 1; // trailing ( comment [\n").ok).toBe(true);
  });
});

describe("Structured Text analyzer — structural problems", () => {
  it("detects unbalanced parentheses", () => {
    expect(messages("X := (A + B;")).toContain("Unbalanced '(' with no matching ')'.");
    expect(messages("X := A + B);")).toContain("Unbalanced ')' with no matching '('.");
  });

  it("detects unbalanced brackets", () => {
    expect(messages("X := Data[i;")).toContain("Unbalanced '[' with no matching ']'.");
    expect(messages("X := Data i];")).toContain("Unbalanced ']' with no matching '['.");
  });

  it("detects an unclosed block", () => {
    expect(messages("IF Start THEN\n  X := 1;")).toContain("'IF' block is not closed (expected 'END_IF').");
  });

  it("detects a mismatched block close", () => {
    expect(messages("IF Start THEN\n  X := 1;\nEND_FOR;")).toContain(
      "'IF' (line 1) is closed by 'END_FOR', expected 'END_IF'.",
    );
  });

  it("detects a stray block end", () => {
    expect(messages("X := 1;\nEND_IF;")).toContain("'END_IF' has no matching opening block.");
  });

  it("detects an unterminated block comment", () => {
    expect(messages("X := 1; (* not closed")).toContain("Unterminated block comment '(*' (no matching '*)').");
  });

  it("detects an unterminated string literal", () => {
    expect(messages("Msg := 'oops;")).toContain("Unterminated string literal (missing closing ').");
  });

  it("reports the line number of the problem", () => {
    const finding = analyzeStructuredText("X := 1;\nY := 2;\nIF a THEN\n  Z := 3;").findings[0];
    expect(finding?.line).toBe(3); // the unclosed IF is on line 3
  });
});

describe("Structured Text tokenizer", () => {
  it("classifies keywords, identifiers, numbers, strings, comments, and operators", () => {
    const tokens = tokenizeStructuredText("IF Level >= 16#FF THEN (* c *) Msg := 'hi'; END_IF;");
    const byKind = (kind: string) => tokens.filter((t) => t.kind === kind).map((t) => t.value);
    expect(byKind("keyword")).toEqual(["IF", "THEN", "END_IF"]);
    expect(byKind("identifier")).toEqual(["Level", "Msg"]);
    expect(byKind("number")).toEqual(["16#FF"]);
    expect(byKind("string")).toEqual(["'hi'"]);
    expect(byKind("comment")).toEqual(["(* c *)"]);
    expect(byKind("operator")).toContain(">=");
    expect(byKind("operator")).toContain(":=");
  });

  it("tracks line numbers across newlines", () => {
    const tokens = tokenizeStructuredText("A := 1;\nB := 2;\nEND_IF;");
    expect(tokens.find((t) => t.value === "END_IF")?.line).toBe(3);
  });
});
