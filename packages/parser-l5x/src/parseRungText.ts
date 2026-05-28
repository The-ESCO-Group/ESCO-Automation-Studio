import type { InstructionRegistry } from "@esco/instructions";
import {
  createBranch,
  createNode,
  tagOperand,
  type LadderBranch,
  type LadderNode,
} from "@esco/ladder";

export interface ParsedRungText {
  /** The rung as a semantic ladder branch tree. */
  root: LadderBranch;
  /** Instruction types found that aren't in the registry. */
  unsupportedTypes: string[];
  /** True if a nested/unparseable branch was flattened to a series. */
  complexBranch: boolean;
}

type Token =
  | { kind: "inst"; type: string; args: string[] }
  | { kind: "[" }
  | { kind: "]" }
  | { kind: "," };

const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdentChar = (c: string) => /[A-Za-z0-9_]/.test(c);

/** Split an operand list on top-level commas (operands may contain `[ ]` / `( )`). */
function splitOperands(text: string): string[] {
  const operands: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of text) {
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    if (char === "," && depth === 0) {
      if (current.trim()) operands.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) operands.push(current.trim());
  return operands;
}

/** Tokenize rung text into instruction calls and branch structure (whitespace ignored). */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c) || c === ";") {
      i++;
    } else if (c === "[" || c === "]" || c === ",") {
      tokens.push({ kind: c } as Token);
      i++;
    } else if (isIdentStart(c)) {
      let j = i;
      while (j < text.length && isIdentChar(text[j])) j++;
      const name = text.slice(i, j);
      let k = j;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] !== "(") {
        // Not an instruction call; skip the identifier to stay productive.
        i = j;
        continue;
      }
      let depth = 0;
      let m = k;
      for (; m < text.length; m++) {
        if (text[m] === "(") depth++;
        else if (text[m] === ")") {
          depth--;
          if (depth === 0) {
            m++;
            break;
          }
        }
      }
      tokens.push({ kind: "inst", type: name.toUpperCase(), args: splitOperands(text.slice(k + 1, m - 1)) });
      i = m;
    } else {
      i++;
    }
  }
  return tokens;
}

function makeNode(
  token: Extract<Token, { kind: "inst" }>,
  registry: InstructionRegistry,
  unsupported: Set<string>,
): LadderNode {
  const definition = registry.get(token.type);
  if (!definition) unsupported.add(token.type);
  const names = definition
    ? definition.operands.map((operand) => operand.name)
    : token.args.map((_, i) => `op${i}`);
  return createNode(
    token.type,
    token.args.map((value, i) => tagOperand(names[i] ?? `op${i}`, value)),
  );
}

type Cursor = { i: number };
type MakeFn = (token: Extract<Token, { kind: "inst" }>) => LadderNode;

/**
 * Parse a series of instructions and branch groups into a branch chain.
 * A series before a group becomes the branch's nodes; the group (and the series
 * after it) becomes `next`.
 */
function parseSeries(tokens: Token[], cursor: Cursor, make: MakeFn): LadderBranch {
  const nodes: LadderNode[] = [];
  while (cursor.i < tokens.length) {
    const token = tokens[cursor.i];
    if (token.kind === "inst") {
      nodes.push(make(token));
      cursor.i++;
    } else if (token.kind === "[") {
      const group = parseGroup(tokens, cursor, make);
      const rest = parseSeries(tokens, cursor, make);
      if (rest.nodes.length > 0 || rest.parallelBranches || rest.next) group.next = rest;
      const branch = createBranch(nodes);
      branch.next = group;
      return branch;
    } else {
      break; // ',' or ']' ends this series (handled by the enclosing group)
    }
  }
  return createBranch(nodes);
}

/** Parse a `[ pathA , pathB , ... ]` group into a branch (first path + parallels). */
function parseGroup(tokens: Token[], cursor: Cursor, make: MakeFn): LadderBranch {
  cursor.i++; // consume '['
  const paths: LadderBranch[] = [parsePath(tokens, cursor, make)];
  while (tokens[cursor.i]?.kind === ",") {
    cursor.i++;
    paths.push(parsePath(tokens, cursor, make));
  }
  if (tokens[cursor.i]?.kind !== "]") throw new Error("unbalanced branch");
  cursor.i++; // consume ']'

  const group = paths[0];
  if (paths.length > 1) group.parallelBranches = paths.slice(1);
  return group;
}

/** A single branch path. Nested groups inside a path aren't modelled (→ flatten). */
function parsePath(tokens: Token[], cursor: Cursor, make: MakeFn): LadderBranch {
  const branch = parseSeries(tokens, cursor, make);
  if (branch.next || branch.parallelBranches) throw new Error("nested branch");
  return branch;
}

/**
 * Parse Logix neutral rung text into a semantic ladder branch tree. Handles a
 * flat series, single-level parallel branches (`[A,B]`) with series before/after,
 * and multiple outputs. Nested/unbalanced branches fall back to a flat series
 * and set `complexBranch` so the caller can warn.
 */
export function parseRungText(text: string, registry: InstructionRegistry): ParsedRungText {
  const unsupported = new Set<string>();
  const make: MakeFn = (token) => makeNode(token, registry, unsupported);
  const tokens = tokenize(text);

  try {
    const cursor: Cursor = { i: 0 };
    const root = parseSeries(tokens, cursor, make);
    if (cursor.i !== tokens.length) throw new Error("unexpected token"); // stray ] or ,
    return { root, unsupportedTypes: [...unsupported], complexBranch: false };
  } catch {
    // Fall back to a flat series of every instruction found.
    unsupported.clear();
    const nodes = tokens
      .filter((token): token is Extract<Token, { kind: "inst" }> => token.kind === "inst")
      .map(make);
    return {
      root: createBranch(nodes),
      unsupportedTypes: [...unsupported],
      complexBranch: tokens.some((token) => token.kind === "["),
    };
  }
}
