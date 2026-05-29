/**
 * Structured Text (IEC 61131-3 / Logix) lexer and lightweight structural syntax
 * checker. This NEVER executes ST and never claims to — Structured Text remains
 * preserved, read-only, and unsimulated. It only tokenizes the source and reports
 * unambiguous structural problems (unbalanced parentheses/brackets, unmatched
 * block keywords, unterminated comments/strings) so an import can warn the
 * engineer instead of silently swallowing malformed source.
 *
 * Deliberately conservative: it flags only structural imbalances that are wrong
 * regardless of semantics. It does NOT guess at missing semicolons, undeclared
 * tags, or type errors, which would risk false positives on valid Logix ST.
 */

export type StructuredTextTokenKind =
  | "keyword"
  | "identifier"
  | "number"
  | "string"
  | "comment"
  | "operator"
  | "punctuation";

export interface StructuredTextToken {
  kind: StructuredTextTokenKind;
  value: string;
  /** 1-based line where the token starts. */
  line: number;
}

export type StructuredTextSeverity = "warning" | "info";

export interface StructuredTextFinding {
  severity: StructuredTextSeverity;
  message: string;
  /** 1-based line of the offending token, when known. */
  line?: number;
}

export interface StructuredTextAnalysis {
  tokens: StructuredTextToken[];
  findings: StructuredTextFinding[];
  /** True when no structural problems were found. */
  ok: boolean;
}

/** ST reserved words (uppercased). Used to classify identifier tokens as keywords. */
const KEYWORDS = new Set([
  "IF", "THEN", "ELSIF", "ELSE", "END_IF",
  "CASE", "OF", "END_CASE",
  "FOR", "TO", "BY", "DO", "END_FOR",
  "WHILE", "END_WHILE",
  "REPEAT", "UNTIL", "END_REPEAT",
  "RETURN", "EXIT",
  "AND", "OR", "XOR", "NOT", "MOD",
  "TRUE", "FALSE",
]);

/** Block openers and the END keyword that must close each. */
const BLOCK_CLOSERS: Record<string, string> = {
  IF: "END_IF",
  CASE: "END_CASE",
  FOR: "END_FOR",
  WHILE: "END_WHILE",
  REPEAT: "END_REPEAT",
};
const BLOCK_ENDS = new Set(Object.values(BLOCK_CLOSERS));

const isIdentStart = (c: string): boolean => /[A-Za-z_]/.test(c);
const isIdentChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c);
const isDigit = (c: string): boolean => /[0-9]/.test(c);

interface LexResult {
  tokens: StructuredTextToken[];
  findings: StructuredTextFinding[];
}

/** Lex ST source into tokens, reporting unterminated comments/strings as findings. */
function lex(source: string): LexResult {
  const tokens: StructuredTextToken[] = [];
  const findings: StructuredTextFinding[] = [];
  let i = 0;
  let line = 1;

  const countNewlines = (text: string): void => {
    for (const ch of text) if (ch === "\n") line += 1;
  };

  while (i < source.length) {
    const c = source[i]!;

    if (c === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }

    // Block comment (* ... *) — not nested in Logix ST.
    if (c === "(" && source[i + 1] === "*") {
      const startLine = line;
      const end = source.indexOf("*)", i + 2);
      const body = end === -1 ? source.slice(i) : source.slice(i, end + 2);
      countNewlines(body);
      tokens.push({ kind: "comment", value: body, line: startLine });
      if (end === -1) {
        findings.push({ severity: "warning", message: "Unterminated block comment '(*' (no matching '*)').", line: startLine });
        break;
      }
      i = end + 2;
      continue;
    }

    // Line comment // ... to end of line.
    if (c === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      const end = nl === -1 ? source.length : nl;
      tokens.push({ kind: "comment", value: source.slice(i, end), line });
      i = end;
      continue;
    }

    // String literal '...' with Logix '$' escapes.
    if (c === "'") {
      const startLine = line;
      let j = i + 1;
      let terminated = false;
      while (j < source.length) {
        const cj = source[j]!;
        if (cj === "$") {
          if (source[j + 1] === "\n") line += 1;
          j += 2; // skip the escaped character
          continue;
        }
        if (cj === "\n") line += 1;
        if (cj === "'") {
          terminated = true;
          j += 1;
          break;
        }
        j += 1;
      }
      tokens.push({ kind: "string", value: source.slice(i, j), line: startLine });
      if (!terminated) {
        findings.push({ severity: "warning", message: "Unterminated string literal (missing closing ').", line: startLine });
        break;
      }
      i = j;
      continue;
    }

    // Number (decimal/float, radix like 16#FF, typed like DINT#1 handled as ident#).
    if (isDigit(c)) {
      let j = i + 1;
      while (j < source.length && /[0-9A-Fa-f._#+eE-]/.test(source[j]!)) {
        // Stop a trailing sign unless it directly follows an exponent marker.
        const ch = source[j]!;
        if ((ch === "+" || ch === "-") && !/[eE]/.test(source[j - 1] ?? "")) break;
        j += 1;
      }
      tokens.push({ kind: "number", value: source.slice(i, j), line });
      i = j;
      continue;
    }

    // Identifier or keyword.
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < source.length && isIdentChar(source[j]!)) j += 1;
      const value = source.slice(i, j);
      tokens.push({ kind: KEYWORDS.has(value.toUpperCase()) ? "keyword" : "identifier", value, line });
      i = j;
      continue;
    }

    // Punctuation that affects balance.
    if (c === "(" || c === ")" || c === "[" || c === "]" || c === ";" || c === ",") {
      tokens.push({ kind: "punctuation", value: c, line });
      i += 1;
      continue;
    }

    // Multi/single-character operators.
    const two = source.slice(i, i + 2);
    if (two === ":=" || two === "<=" || two === ">=" || two === "<>" || two === "**") {
      tokens.push({ kind: "operator", value: two, line });
      i += 2;
      continue;
    }
    tokens.push({ kind: "operator", value: c, line });
    i += 1;
  }

  return { tokens, findings };
}

/**
 * Tokenize Structured Text source. Lenient: an unterminated comment or string is
 * still returned as a token (its lexical problem surfaces via
 * {@link analyzeStructuredText}).
 */
export function tokenizeStructuredText(source: string): StructuredTextToken[] {
  return lex(source).tokens;
}

/**
 * Structurally check Structured Text source. Reports unbalanced parentheses and
 * brackets, unmatched block keywords (IF/END_IF, FOR/END_FOR, WHILE/END_WHILE,
 * CASE/END_CASE, REPEAT/END_REPEAT), and unterminated comments/strings. Never
 * executes the source and never reports semantic/type problems.
 */
export function analyzeStructuredText(source: string): StructuredTextAnalysis {
  const { tokens, findings } = lex(source);

  const parens: number[] = []; // line numbers of unmatched '('
  const brackets: number[] = []; // line numbers of unmatched '['
  const blocks: { keyword: string; line: number }[] = [];

  for (const token of tokens) {
    if (token.kind === "punctuation") {
      if (token.value === "(") parens.push(token.line);
      else if (token.value === ")") {
        if (parens.length === 0) findings.push({ severity: "warning", message: "Unbalanced ')' with no matching '('.", line: token.line });
        else parens.pop();
      } else if (token.value === "[") brackets.push(token.line);
      else if (token.value === "]") {
        if (brackets.length === 0) findings.push({ severity: "warning", message: "Unbalanced ']' with no matching '['.", line: token.line });
        else brackets.pop();
      }
      continue;
    }

    if (token.kind === "keyword") {
      const upper = token.value.toUpperCase();
      if (BLOCK_CLOSERS[upper]) {
        blocks.push({ keyword: upper, line: token.line });
      } else if (BLOCK_ENDS.has(upper)) {
        const open = blocks.pop();
        const expected = open ? BLOCK_CLOSERS[open.keyword] : undefined;
        if (!open) {
          findings.push({ severity: "warning", message: `'${upper}' has no matching opening block.`, line: token.line });
        } else if (expected !== upper) {
          findings.push({
            severity: "warning",
            message: `'${open.keyword}' (line ${open.line}) is closed by '${upper}', expected '${expected}'.`,
            line: token.line,
          });
        }
      }
    }
  }

  for (const line of parens) findings.push({ severity: "warning", message: "Unbalanced '(' with no matching ')'.", line });
  for (const line of brackets) findings.push({ severity: "warning", message: "Unbalanced '[' with no matching ']'.", line });
  for (const open of blocks) {
    findings.push({
      severity: "warning",
      message: `'${open.keyword}' block is not closed (expected '${BLOCK_CLOSERS[open.keyword]}').`,
      line: open.line,
    });
  }

  return { tokens, findings, ok: findings.length === 0 };
}
