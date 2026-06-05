import type { Controller, PlcProject, Program, Routine } from "@esco/core";
import { getLadder } from "./helpers";

export type FaultHandlerKind = "controller-fault" | "power-up" | "program-fault";

export type FaultHandlerReviewStatus =
  | "not-configured"
  | "configured-ladder"
  | "configured-non-ladder"
  | "missing-program"
  | "ambiguous-program"
  | "missing-main-routine"
  | "dangling-main-routine"
  | "missing-routine"
  | "ambiguous-routine";

export type FaultHandlerReviewBoundary =
  | "no-controller-fault-dispatch"
  | "no-controller-fault-words"
  | "no-power-up-event"
  | "no-program-fault-dispatch"
  | "non-ladder-preserved-read-only";

export interface FaultHandlerReviewRow {
  kind: FaultHandlerKind;
  controllerId: string;
  controllerName: string;
  programId?: string;
  programName?: string;
  configuredName?: string;
  routineId?: string;
  routineName?: string;
  routineLanguage?: Routine["language"];
  status: FaultHandlerReviewStatus;
  offlineBodyAvailable: boolean;
  offlineDispatchModelled: false;
  controllerFaultWordsModelled: false;
  boundaries: FaultHandlerReviewBoundary[];
  message: string;
}

export interface FaultHandlerReviewReport {
  rows: FaultHandlerReviewRow[];
  configuredCount: number;
  missingCount: number;
  nonLadderCount: number;
  ambiguousCount: number;
  executableBodyCount: number;
  warnings: string[];
}

const MISSING_STATUSES = new Set<FaultHandlerReviewStatus>([
  "missing-routine",
  "missing-program",
  "missing-main-routine",
  "dangling-main-routine",
]);

const AMBIGUOUS_STATUSES = new Set<FaultHandlerReviewStatus>([
  "ambiguous-routine",
  "ambiguous-program",
]);

function findProgramsByName(controller: Controller, name: string): Program[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  return controller.programs.filter((program) => program.name === trimmed);
}

function boundariesFor(kind: FaultHandlerKind, routine?: Routine): FaultHandlerReviewBoundary[] {
  const boundaries = new Set<FaultHandlerReviewBoundary>(["no-controller-fault-words"]);
  if (kind === "controller-fault") boundaries.add("no-controller-fault-dispatch");
  if (kind === "power-up") boundaries.add("no-power-up-event");
  if (kind === "program-fault") boundaries.add("no-program-fault-dispatch");
  if (routine && !getLadder(routine)) boundaries.add("non-ladder-preserved-read-only");
  return [...boundaries];
}

function kindLabel(kind: FaultHandlerKind): string {
  if (kind === "controller-fault") return "Controller fault handler";
  if (kind === "power-up") return "Power-up handler";
  return "Program fault routine";
}

function configuredRoutineRow(input: {
  kind: FaultHandlerKind;
  controller: Controller;
  program?: Program;
  configuredName: string;
  routine: Routine;
}): FaultHandlerReviewRow {
  const { kind, controller, program, configuredName, routine } = input;
  const ladder = Boolean(getLadder(routine));
  return {
    kind,
    controllerId: controller.id,
    controllerName: controller.name,
    programId: program?.id,
    programName: program?.name,
    configuredName,
    routineId: routine.id,
    routineName: routine.name,
    routineLanguage: routine.language,
    status: ladder ? "configured-ladder" : "configured-non-ladder",
    offlineBodyAvailable: ladder,
    offlineDispatchModelled: false,
    controllerFaultWordsModelled: false,
    boundaries: boundariesFor(kind, routine),
    message: kind === "program-fault"
      ? ladder
        ? `${kindLabel(kind)} "${configuredName}" resolves to ladder routine "${routine.name}" for offline review; automatic controller fault dispatch is not simulated.`
        : `${kindLabel(kind)} "${configuredName}" resolves to ${routine.language} routine "${routine.name}", preserved read-only for offline review.`
      : ladder
        ? `${kindLabel(kind)} program "${configuredName}" resolves to main ladder routine "${routine.name}" for offline review; automatic controller fault dispatch is not simulated.`
        : `${kindLabel(kind)} program "${configuredName}" resolves to main ${routine.language} routine "${routine.name}", preserved read-only for offline review.`,
  };
}

function missingRow(input: {
  kind: FaultHandlerKind;
  controller: Controller;
  program?: Program;
  configuredName: string;
}): FaultHandlerReviewRow {
  const { kind, controller, program, configuredName } = input;
  return {
    kind,
    controllerId: controller.id,
    controllerName: controller.name,
    programId: program?.id,
    programName: program?.name,
    configuredName,
    status: "missing-routine",
    offlineBodyAvailable: false,
    offlineDispatchModelled: false,
    controllerFaultWordsModelled: false,
    boundaries: boundariesFor(kind),
    message: `${kindLabel(kind)} "${configuredName}" does not resolve to an imported routine.`,
  };
}

function missingProgramRow(input: {
  kind: "controller-fault" | "power-up";
  controller: Controller;
  configuredName: string;
}): FaultHandlerReviewRow {
  const { kind, controller, configuredName } = input;
  return {
    kind,
    controllerId: controller.id,
    controllerName: controller.name,
    configuredName,
    status: "missing-program",
    offlineBodyAvailable: false,
    offlineDispatchModelled: false,
    controllerFaultWordsModelled: false,
    boundaries: boundariesFor(kind),
    message: `${kindLabel(kind)} program "${configuredName}" does not resolve to an imported program.`,
  };
}

function ambiguousProgramRow(input: {
  kind: "controller-fault" | "power-up";
  controller: Controller;
  configuredName: string;
  matches: Program[];
}): FaultHandlerReviewRow {
  const { kind, controller, configuredName, matches } = input;
  return {
    kind,
    controllerId: controller.id,
    controllerName: controller.name,
    configuredName,
    status: "ambiguous-program",
    offlineBodyAvailable: false,
    offlineDispatchModelled: false,
    controllerFaultWordsModelled: false,
    boundaries: boundariesFor(kind),
    message: `${kindLabel(kind)} program "${configuredName}" matches ${matches.length} imported programs (${matches.map((program) => program.name).join(", ")}).`,
  };
}

function missingMainRoutineRow(input: {
  kind: "controller-fault" | "power-up";
  controller: Controller;
  program: Program;
  configuredName: string;
}): FaultHandlerReviewRow {
  const { kind, controller, program, configuredName } = input;
  return {
    kind,
    controllerId: controller.id,
    controllerName: controller.name,
    programId: program.id,
    programName: program.name,
    configuredName,
    status: "missing-main-routine",
    offlineBodyAvailable: false,
    offlineDispatchModelled: false,
    controllerFaultWordsModelled: false,
    boundaries: boundariesFor(kind),
    message: `${kindLabel(kind)} program "${configuredName}" has no main routine configured.`,
  };
}

function danglingMainRoutineRow(input: {
  kind: "controller-fault" | "power-up";
  controller: Controller;
  program: Program;
  configuredName: string;
}): FaultHandlerReviewRow {
  const { kind, controller, program, configuredName } = input;
  return {
    kind,
    controllerId: controller.id,
    controllerName: controller.name,
    programId: program.id,
    programName: program.name,
    configuredName,
    status: "dangling-main-routine",
    offlineBodyAvailable: false,
    offlineDispatchModelled: false,
    controllerFaultWordsModelled: false,
    boundaries: boundariesFor(kind),
    message: `${kindLabel(kind)} program "${configuredName}" references a main routine that was not imported.`,
  };
}

function notConfiguredRow(kind: FaultHandlerKind, controller: Controller, program?: Program): FaultHandlerReviewRow {
  return {
    kind,
    controllerId: controller.id,
    controllerName: controller.name,
    programId: program?.id,
    programName: program?.name,
    status: "not-configured",
    offlineBodyAvailable: false,
    offlineDispatchModelled: false,
    controllerFaultWordsModelled: false,
    boundaries: boundariesFor(kind),
    message: `${kindLabel(kind)} is not configured${program ? ` for program "${program.name}"` : ""}.`,
  };
}

function controllerHandlerRow(controller: Controller, kind: "controller-fault" | "power-up", configuredName?: string): FaultHandlerReviewRow {
  const name = configuredName?.trim();
  if (!name) return notConfiguredRow(kind, controller);
  const matches = findProgramsByName(controller, name);
  if (matches.length === 0) return missingProgramRow({ kind, controller, configuredName: name });
  if (matches.length > 1) return ambiguousProgramRow({ kind, controller, configuredName: name, matches });
  const program = matches[0]!;
  if (!program.mainRoutineId) return missingMainRoutineRow({ kind, controller, program, configuredName: name });
  const routine = program.routines.find((candidate) => candidate.id === program.mainRoutineId);
  if (!routine) return danglingMainRoutineRow({ kind, controller, program, configuredName: name });
  return configuredRoutineRow({ kind, controller, program, configuredName: name, routine });
}

function programFaultRow(controller: Controller, program: Program): FaultHandlerReviewRow {
  const configuredId = program.faultRoutineId?.trim();
  if (!configuredId) return notConfiguredRow("program-fault", controller, program);
  const routine = program.routines.find((candidate) => candidate.id === configuredId);
  if (!routine) return missingRow({ kind: "program-fault", controller, program, configuredName: configuredId });
  return configuredRoutineRow({ kind: "program-fault", controller, program, configuredName: routine.name, routine });
}

export function faultHandlerReviewReport(project: PlcProject): FaultHandlerReviewReport {
  const rows: FaultHandlerReviewRow[] = [];
  for (const controller of project.controllers) {
    rows.push(controllerHandlerRow(controller, "controller-fault", controller.faultRoutineName));
    rows.push(controllerHandlerRow(controller, "power-up", controller.powerUpRoutineName));
    for (const program of controller.programs) rows.push(programFaultRow(controller, program));
  }

  const warnings = rows
    .filter((row) =>
      MISSING_STATUSES.has(row.status) ||
      AMBIGUOUS_STATUSES.has(row.status) ||
      row.status === "configured-non-ladder")
    .map((row) => row.message);

  return {
    rows,
    configuredCount: rows.filter((row) => row.status === "configured-ladder" || row.status === "configured-non-ladder").length,
    missingCount: rows.filter((row) => MISSING_STATUSES.has(row.status)).length,
    nonLadderCount: rows.filter((row) => row.status === "configured-non-ladder").length,
    ambiguousCount: rows.filter((row) => AMBIGUOUS_STATUSES.has(row.status)).length,
    executableBodyCount: rows.filter((row) => row.offlineBodyAvailable).length,
    warnings,
  };
}
