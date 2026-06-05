import type { PlcProject, Program } from "@esco/core";

/**
 * Offline review of pending online test edits on programs (`TestEdits="true"`).
 *
 * Studio 5000 records `TestEdits="true"` on a `<Program>` when that program
 * holds online test edits that have not yet been assembled / accepted. Those
 * edits represent logic that is being tested in a live session but is not yet
 * the finalized program. ESCO is offline-only: it never accepts, cancels,
 * assembles, or executes test edits, and never opens an online session — so a
 * program carrying pending test edits is surfaced here as something the engineer
 * must finalize in Studio 5000 before relying on the imported logic or verifying
 * / downloading the project. Programs without pending edits are the normal case
 * and review clean.
 *
 * Read-only: this report consumes the already-parsed {@link Program.testEdits}
 * flag and adds no new domain data.
 */
export type ProgramTestEditsReviewStatus = "no-pending-edits" | "pending-edits";

export type ProgramTestEditsReviewBoundary =
  | "no-controller-communication"
  | "no-online-session"
  | "no-test-edit-assembly"
  | "no-test-edit-accept-cancel"
  | "no-pending-edit-logic-execution";

export interface ProgramTestEditsReviewRow {
  controllerId: string;
  controllerName: string;
  programId: string;
  programName: string;
  safetyClass?: string;
  /** True when the program carries pending online test edits (`TestEdits="true"`). */
  pendingTestEdits: boolean;
  status: ProgramTestEditsReviewStatus;
  onlineSessionModelled: false;
  testEditAssemblyModelled: false;
  testEditAcceptCancelModelled: false;
  pendingEditLogicExecutionModelled: false;
  boundaries: ProgramTestEditsReviewBoundary[];
  message: string;
}

export interface ProgramTestEditsReviewReport {
  rows: ProgramTestEditsReviewRow[];
  programCount: number;
  pendingTestEditsCount: number;
  warnings: string[];
}

const BOUNDARIES: ProgramTestEditsReviewBoundary[] = [
  "no-controller-communication",
  "no-online-session",
  "no-test-edit-assembly",
  "no-test-edit-accept-cancel",
  "no-pending-edit-logic-execution",
];

function messageFor(row: Omit<ProgramTestEditsReviewRow, "message">): string {
  if (row.pendingTestEdits) {
    return `Program "${row.programName}" carries pending online test edits; this offline tool cannot accept, cancel, or assemble them — finalize them in the source engineering environment before relying on the imported logic or verifying / downloading the project.`;
  }
  return `Program "${row.programName}" has no pending online test edits.`;
}

function rowFor(input: {
  controllerId: string;
  controllerName: string;
  program: Program;
}): ProgramTestEditsReviewRow {
  const { controllerId, controllerName, program } = input;
  const pendingTestEdits = Boolean(program.testEdits);
  const rowBase = {
    controllerId,
    controllerName,
    programId: program.id,
    programName: program.name,
    safetyClass: program.safetyClass,
    pendingTestEdits,
    status: (pendingTestEdits ? "pending-edits" : "no-pending-edits") as ProgramTestEditsReviewStatus,
    onlineSessionModelled: false as const,
    testEditAssemblyModelled: false as const,
    testEditAcceptCancelModelled: false as const,
    pendingEditLogicExecutionModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function programTestEditsReviewReport(project: PlcProject): ProgramTestEditsReviewReport {
  const rows: ProgramTestEditsReviewRow[] = [];
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      rows.push(rowFor({ controllerId: controller.id, controllerName: controller.name, program }));
    }
  }

  return {
    rows,
    programCount: rows.length,
    pendingTestEditsCount: rows.filter((row) => row.pendingTestEdits).length,
    warnings: rows.filter((row) => row.pendingTestEdits).map((row) => row.message),
  };
}
