import type { PlcProject, Routine } from "@esco/core";
import { fingerprintRoutine, type RoutineFingerprint } from "./fingerprint";

/**
 * How two routines relate by logic:
 *  - `identical`        — same instructions, branches, and operands;
 *  - `operand-changed`  — same structure, different operands (tags/literals);
 *  - `structure-changed`— different instruction/branch layout.
 */
export type RoutineMatchType = "identical" | "operand-changed" | "structure-changed";

export interface RoutineRef {
  programName: string;
  routineName: string;
  routineId: string;
}

/** A pair of routines matched across the two projects, with their relationship. */
export interface RoutineMatch {
  status: RoutineMatchType;
  /** Whether the pair was matched by logic fingerprint or by name (fallback). */
  matchedBy: "fingerprint" | "name";
  left: RoutineRef;
  right: RoutineRef;
  /** Human-readable per-rung differences (empty when identical). */
  details: string[];
  leftRungTexts: string[];
  rightRungTexts: string[];
}

export interface ProjectComparison {
  /** Pairs that are logically identical. */
  matches: RoutineMatch[];
  /** Pairs that were matched but differ (operand- or structure-changed). */
  changed: RoutineMatch[];
  onlyInLeft: RoutineRef[];
  onlyInRight: RoutineRef[];
  warnings: string[];
  summary: {
    matched: number;
    changed: number;
    onlyInLeft: number;
    onlyInRight: number;
    /** Total rows in the comparison (matched + changed + only-in-either). */
    total: number;
  };
}

export interface RoutineDiff {
  status: RoutineMatchType;
  details: string[];
  leftRungTexts: string[];
  rightRungTexts: string[];
}

/** Classify two fingerprints into a match type. */
export function classify(a: RoutineFingerprint, b: RoutineFingerprint): RoutineMatchType {
  if (a.full === b.full) return "identical";
  if (a.structure === b.structure) return "operand-changed";
  return "structure-changed";
}

function diffDetails(a: RoutineFingerprint, b: RoutineFingerprint): string[] {
  const details: string[] = [];
  if (a.rungCount !== b.rungCount) {
    details.push(`Rung count differs: ${a.rungCount} vs ${b.rungCount}.`);
  }
  const max = Math.max(a.rungTexts.length, b.rungTexts.length);
  for (let i = 0; i < max; i++) {
    const left = a.rungTexts[i];
    const right = b.rungTexts[i];
    if (left !== right) details.push(`Rung ${i}: ${left ?? "—"}  ≠  ${right ?? "—"}`);
  }
  return details;
}

/** Compare two routines directly by their logic. */
export function compareRoutines(
  left: Routine,
  right: Routine,
  options: { canonicalize?: "strict" | "logical" } = {},
): RoutineDiff {
  const canonical = options.canonicalize === "logical";
  const a = fingerprintRoutine(left, { canonical });
  const b = fingerprintRoutine(right, { canonical });
  const status = classify(a, b);
  return {
    status,
    details: status === "identical" ? [] : diffDetails(a, b),
    leftRungTexts: a.rungTexts,
    rightRungTexts: b.rungTexts,
  };
}

interface RoutineEntry {
  ref: RoutineRef;
  fp: RoutineFingerprint;
}

function collectRoutines(project: PlcProject, canonical: boolean): RoutineEntry[] {
  const entries: RoutineEntry[] = [];
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      for (const routine of program.routines) {
        entries.push({
          ref: { programName: program.name, routineName: routine.name, routineId: routine.id },
          fp: fingerprintRoutine(routine, { canonical }),
        });
      }
    }
  }
  return entries;
}

export interface CompareOptions {
  /**
   * `strict` (default) preserves exact branch-leg order; `logical` canonicalizes
   * commutative OR legs so reordered parallel branches compare as equal.
   */
  canonicalize?: "strict" | "logical";
}

/**
 * Compare two projects routine-by-routine, by logic rather than by name.
 * Routines are paired in three passes: exact logic (full fingerprint), then same
 * structure (operand differences), then routine name as a fallback. Each routine
 * is paired at most once; the rest are reported as only-in-left / only-in-right.
 */
export function compareProjects(
  left: PlcProject,
  right: PlcProject,
  options: CompareOptions = {},
): ProjectComparison {
  const canonical = options.canonicalize === "logical";
  const L = collectRoutines(left, canonical);
  const R = collectRoutines(right, canonical);
  const usedL = new Set<number>();
  const usedR = new Set<number>();
  const matches: RoutineMatch[] = [];
  const changed: RoutineMatch[] = [];
  const warnings: string[] = [];

  const pair = (li: number, ri: number, matchedBy: "fingerprint" | "name") => {
    const a = L[li]!;
    const b = R[ri]!;
    const status = classify(a.fp, b.fp);
    const match: RoutineMatch = {
      status,
      matchedBy,
      left: a.ref,
      right: b.ref,
      details: status === "identical" ? [] : diffDetails(a.fp, b.fp),
      leftRungTexts: a.fp.rungTexts,
      rightRungTexts: b.fp.rungTexts,
    };
    (status === "identical" ? matches : changed).push(match);
    usedL.add(li);
    usedR.add(ri);
  };

  const findRight = (predicate: (entry: RoutineEntry, index: number) => boolean): number =>
    R.findIndex((entry, index) => !usedR.has(index) && predicate(entry, index));

  // Pass 1: exact logic match (names ignored). Skip empty routines so unrelated
  // empty routines don't all collapse together.
  for (let i = 0; i < L.length; i++) {
    if (usedL.has(i) || L[i]!.fp.rungCount === 0) continue;
    const j = findRight((entry) => entry.fp.full === L[i]!.fp.full);
    if (j >= 0) pair(i, j, "fingerprint");
  }
  // Pass 2: same structure, different operands (names ignored).
  for (let i = 0; i < L.length; i++) {
    if (usedL.has(i) || L[i]!.fp.rungCount === 0) continue;
    const j = findRight((entry) => entry.fp.structure === L[i]!.fp.structure);
    if (j >= 0) pair(i, j, "fingerprint");
  }
  // Pass 3: fallback to routine name.
  for (let i = 0; i < L.length; i++) {
    if (usedL.has(i)) continue;
    const name = L[i]!.ref.routineName.toLowerCase();
    const j = findRight((entry) => entry.ref.routineName.toLowerCase() === name);
    if (j >= 0) pair(i, j, "name");
  }

  const onlyInLeft = L.filter((_, i) => !usedL.has(i)).map((entry) => entry.ref);
  const onlyInRight = R.filter((_, i) => !usedR.has(i)).map((entry) => entry.ref);

  if (left.controllers.length === 0 || right.controllers.length === 0) {
    warnings.push("One of the projects has no controllers to compare.");
  }

  return {
    matches,
    changed,
    onlyInLeft,
    onlyInRight,
    warnings,
    summary: {
      matched: matches.length,
      changed: changed.length,
      onlyInLeft: onlyInLeft.length,
      onlyInRight: onlyInRight.length,
      total: matches.length + changed.length + onlyInLeft.length + onlyInRight.length,
    },
  };
}
