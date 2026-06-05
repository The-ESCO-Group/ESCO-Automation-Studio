import type { PlcProject, Program, Routine, Task, TaskType } from "@esco/core";
import { defaultRoutineId, getLadder } from "./helpers";

export type ControllerTaskStatusSource = "scheduled-task" | "offline-fallback";

export type ControllerTaskScanStatus =
  | "scan-eligible"
  | "duplicate-routine-skipped"
  | "task-inhibited"
  | "program-inhibited"
  | "missing-program"
  | "missing-main-routine"
  | "non-ladder-main-routine";

export interface ControllerTaskStatusBits {
  enabled: boolean;
  inhibited: boolean;
  outputUpdateDisabled: boolean;
  watchdogConfigured: boolean;
  timingModelled: boolean;
  watchdogFaultModelled: false;
  controllerFaultModelled: false;
}

export interface ControllerTaskStatusRow {
  source: ControllerTaskStatusSource;
  controllerId: string;
  controllerName: string;
  taskId?: string;
  taskName: string;
  taskType: TaskType | "offline-fallback";
  periodMs?: number;
  priority?: number;
  watchdogMs?: number;
  disableUpdateOutputs?: boolean;
  programId?: string;
  programName?: string;
  routineId?: string;
  routineName?: string;
  routineLanguage?: Routine["language"];
  scanEligible: boolean;
  willScanInOfflineCycle: boolean;
  status: ControllerTaskScanStatus;
  statusBits: ControllerTaskStatusBits;
  message: string;
}

export interface ControllerTaskStatusReport {
  rows: ControllerTaskStatusRow[];
  scheduledRoutineIds: string[];
  willScanCount: number;
  scanEligibleCount: number;
  blockedCount: number;
  inhibitedCount: number;
  missingCount: number;
  nonLadderCount: number;
  duplicateSkippedCount: number;
  watchdogConfiguredCount: number;
  outputUpdateDisabledCount: number;
  offlineFallbackCount: number;
  warnings: string[];
}

export type ControllerTaskVerificationSeverity = "pass" | "warning" | "blocked";

export interface ControllerTaskVerificationRow {
  id: string;
  severity: ControllerTaskVerificationSeverity;
  controllerName: string;
  taskName: string;
  taskType: ControllerTaskStatusRow["taskType"];
  programName?: string;
  routineId?: string;
  routineName?: string;
  status: ControllerTaskScanStatus;
  source: ControllerTaskStatusSource;
  scanEligible: boolean;
  watchdogMs?: number;
  watchdogConfigured: boolean;
  action: string;
  detail: string;
}

export interface ControllerTaskVerificationReport {
  rows: ControllerTaskVerificationRow[];
  passCount: number;
  warningCount: number;
  blockedCount: number;
  summary: string;
}

function mainRoutine(program: Program): Routine | undefined {
  const mainId = program.mainRoutineId ?? program.routines[0]?.id;
  return mainId ? program.routines.find((routine) => routine.id === mainId) : undefined;
}

function scansOffline(routine: Routine): boolean {
  return !!getLadder(routine) || routine.language === "structured-text";
}

function statusBits(task: Task | undefined, enabled: boolean): ControllerTaskStatusBits {
  const inhibited = task?.inhibited === true;
  return {
    enabled,
    inhibited,
    outputUpdateDisabled: task?.disableUpdateOutputs === true,
    watchdogConfigured: task?.watchdogMs != null,
    timingModelled: task?.type !== "event",
    watchdogFaultModelled: false,
    controllerFaultModelled: false,
  };
}

function taskTimingMessage(task: Task | undefined): string {
  if (!task) return "Offline fallback scan; no imported task schedule is active.";
  const timing =
    task.type === "periodic" && task.periodMs != null
      ? `period ${task.periodMs} ms, deterministic offline release modeled`
      : task.type === "event"
        ? "event trigger metadata preserved; event dispatch is not simulated unless a software-only offline trigger is supplied"
        : "continuous task, released every offline scan tick";
  const watchdog = task.watchdogMs != null ? `, watchdog ${task.watchdogMs} ms` : "";
  const outputs = task.disableUpdateOutputs ? ", output update disabled" : "";
  return `${timing}${watchdog}${outputs}; realtime pre-emption/watchdog faults are not simulated offline.`;
}

function buildRow(input: {
  source: ControllerTaskStatusSource;
  controllerId: string;
  controllerName: string;
  task?: Task;
  taskName?: string;
  taskType?: TaskType | "offline-fallback";
  program?: Program;
  programId?: string;
  routine?: Routine;
  status: ControllerTaskScanStatus;
  scanEligible: boolean;
  willScan: boolean;
  message: string;
}): ControllerTaskStatusRow {
  const { source, controllerId, controllerName, task, program, routine, status, scanEligible, willScan, message } = input;
  return {
    source,
    controllerId,
    controllerName,
    taskId: task?.id,
    taskName: input.taskName ?? task?.name ?? "Offline fallback",
    taskType: input.taskType ?? task?.type ?? "offline-fallback",
    periodMs: task?.periodMs,
    priority: task?.priority,
    watchdogMs: task?.watchdogMs,
    disableUpdateOutputs: task?.disableUpdateOutputs,
    programId: program?.id ?? input.programId,
    programName: program?.name,
    routineId: routine?.id,
    routineName: routine?.name,
    routineLanguage: routine?.language,
    scanEligible,
    willScanInOfflineCycle: willScan,
    status,
    statusBits: statusBits(task, scanEligible),
    message,
  };
}

/**
 * Project the imported Logix task schedule into the exact offline scan set.
 *
 * This is review/status metadata only: it does not communicate with a
 * controller and does not model realtime task pre-emption or watchdog faults.
 */
export function controllerTaskStatusReport(project: PlcProject): ControllerTaskStatusReport {
  const rows: ControllerTaskStatusRow[] = [];
  const scheduledRoutineIds: string[] = [];
  const seenRoutineIds = new Set<string>();

  for (const controller of project.controllers) {
    const programsById = new Map(controller.programs.map((program) => [program.id, program] as const));
    for (const task of controller.tasks) {
      if (task.scheduledProgramIds.length === 0) {
        rows.push(buildRow({
          source: "scheduled-task",
          controllerId: controller.id,
          controllerName: controller.name,
          task,
          status: task.inhibited ? "task-inhibited" : "missing-program",
          scanEligible: false,
          willScan: false,
          message: task.inhibited
            ? `Task "${task.name}" is inhibited. ${taskTimingMessage(task)}`
            : `Task "${task.name}" has no scheduled programs. ${taskTimingMessage(task)}`,
        }));
      }

      for (const programId of task.scheduledProgramIds) {
        const program = programsById.get(programId);
        if (task.inhibited) {
          rows.push(buildRow({
            source: "scheduled-task",
            controllerId: controller.id,
            controllerName: controller.name,
            task,
            program,
            programId,
            status: "task-inhibited",
            scanEligible: false,
            willScan: false,
            message: `Task "${task.name}" is inhibited; scheduled program "${program?.name ?? programId}" will not scan. ${taskTimingMessage(task)}`,
          }));
          continue;
        }
        if (!program) {
          rows.push(buildRow({
            source: "scheduled-task",
            controllerId: controller.id,
            controllerName: controller.name,
            task,
            programId,
            status: "missing-program",
            scanEligible: false,
            willScan: false,
            message: `Task "${task.name}" references missing program "${programId}". ${taskTimingMessage(task)}`,
          }));
          continue;
        }
        if (program.inhibited) {
          rows.push(buildRow({
            source: "scheduled-task",
            controllerId: controller.id,
            controllerName: controller.name,
            task,
            program,
            status: "program-inhibited",
            scanEligible: false,
            willScan: false,
            message: `Program "${program.name}" is inhibited and will not scan from task "${task.name}". ${taskTimingMessage(task)}`,
          }));
          continue;
        }

        const routine = mainRoutine(program);
        if (!routine) {
          rows.push(buildRow({
            source: "scheduled-task",
            controllerId: controller.id,
            controllerName: controller.name,
            task,
            program,
            status: "missing-main-routine",
            scanEligible: false,
            willScan: false,
            message: `Program "${program.name}" has no main routine to scan from task "${task.name}". ${taskTimingMessage(task)}`,
          }));
          continue;
        }
        if (!scansOffline(routine)) {
          rows.push(buildRow({
            source: "scheduled-task",
            controllerId: controller.id,
            controllerName: controller.name,
            task,
            program,
            routine,
            status: "non-ladder-main-routine",
            scanEligible: false,
            willScan: false,
            message: `Program "${program.name}" main routine "${routine.name}" is ${routine.language}; only ladder and supported Structured Text routines scan offline. ${taskTimingMessage(task)}`,
          }));
          continue;
        }
        if (seenRoutineIds.has(routine.id)) {
          rows.push(buildRow({
            source: "scheduled-task",
            controllerId: controller.id,
            controllerName: controller.name,
            task,
            program,
            routine,
            status: "duplicate-routine-skipped",
            scanEligible: false,
            willScan: false,
            message: `Routine "${routine.name}" is already in the offline scan set; duplicate task reference is skipped. ${taskTimingMessage(task)}`,
          }));
          continue;
        }

        seenRoutineIds.add(routine.id);
        scheduledRoutineIds.push(routine.id);
        rows.push(buildRow({
          source: "scheduled-task",
          controllerId: controller.id,
          controllerName: controller.name,
          task,
          program,
          routine,
          status: "scan-eligible",
          scanEligible: true,
          willScan: true,
          message: `Routine "${routine.name}" will scan in the offline cycle. ${taskTimingMessage(task)}`,
        }));
      }
    }
  }

  if (scheduledRoutineIds.length === 0) {
    const fallbackId = defaultRoutineId(project);
    const controller = project.controllers[0];
    const program = controller?.programs.find((candidate) =>
      candidate.routines.some((routine) => routine.id === fallbackId),
    );
    const routine = program?.routines.find((candidate) => candidate.id === fallbackId);
    if (controller && program && routine && scansOffline(routine)) {
      scheduledRoutineIds.push(routine.id);
      rows.push(buildRow({
        source: "offline-fallback",
        controllerId: controller.id,
        controllerName: controller.name,
        program,
        routine,
        status: "scan-eligible",
        scanEligible: true,
        willScan: true,
        message: `No imported scheduled routine is active; offline simulation falls back to "${routine.name}".`,
      }));
    }
  }

  const blocked = rows.filter((row) => !row.scanEligible);
  const warnings = rows
    .filter((row) => row.status !== "scan-eligible")
    .map((row) => row.message);

  return {
    rows,
    scheduledRoutineIds,
    willScanCount: rows.filter((row) => row.willScanInOfflineCycle).length,
    scanEligibleCount: rows.filter((row) => row.scanEligible).length,
    blockedCount: blocked.length,
    inhibitedCount: rows.filter((row) => row.status === "task-inhibited" || row.status === "program-inhibited").length,
    missingCount: rows.filter((row) => row.status === "missing-program" || row.status === "missing-main-routine").length,
    nonLadderCount: rows.filter((row) => row.status === "non-ladder-main-routine").length,
    duplicateSkippedCount: rows.filter((row) => row.status === "duplicate-routine-skipped").length,
    watchdogConfiguredCount: rows.filter((row) => row.statusBits.watchdogConfigured).length,
    outputUpdateDisabledCount: rows.filter((row) => row.statusBits.outputUpdateDisabled).length,
    offlineFallbackCount: rows.filter((row) => row.source === "offline-fallback").length,
    warnings,
  };
}

function verificationSeverity(row: ControllerTaskStatusRow): ControllerTaskVerificationSeverity {
  if (row.status === "scan-eligible") return row.source === "offline-fallback" ? "warning" : "pass";
  return row.status === "duplicate-routine-skipped" ? "warning" : "blocked";
}

function verificationAction(row: ControllerTaskStatusRow): Pick<ControllerTaskVerificationRow, "action" | "detail"> {
  switch (row.status) {
    case "scan-eligible":
      if (row.source === "offline-fallback") {
        return {
          action: "Create or import task schedule",
          detail: `${row.routineName ?? "Fallback routine"} scans offline because no imported task schedule is active.`,
        };
      }
      return {
        action: row.routineId ? "Open Routine" : "Review scan routine",
        detail: `${row.routineName ?? "Main routine"} scans offline; realtime pre-emption and watchdog faults remain offline boundaries.`,
      };
    case "duplicate-routine-skipped":
      return {
        action: "Review task schedule",
        detail: "This routine is already in the offline scan set, so only the first scheduled reference runs.",
      };
    case "task-inhibited":
      return {
        action: "Enable task or confirm inhibited state",
        detail: "The task is inhibited, so none of its scheduled programs can scan offline.",
      };
    case "program-inhibited":
      return {
        action: "Enable program or remove from task",
        detail: "The scheduled program is inhibited and is blocked from the offline scan cycle.",
      };
    case "missing-program":
      return {
        action: "Repair scheduled program reference",
        detail: "The task references a program id that is not present in the imported project.",
      };
    case "missing-main-routine":
      return {
        action: "Assign a main routine",
        detail: "The scheduled program has no main routine to execute in the offline scan cycle.",
      };
    case "non-ladder-main-routine":
      return {
        action: "Use ladder or supported ST main routine",
        detail: "Only ladder and supported Structured Text main routines execute offline.",
      };
  }
}

function verificationRowId(row: ControllerTaskStatusRow, index: number): string {
  return [
    row.controllerId,
    row.taskId ?? row.source,
    row.programId ?? "no-program",
    row.routineId ?? "no-routine",
    row.status,
    index,
  ].join(":");
}

export function verifyControllerTasks(project: PlcProject): ControllerTaskVerificationReport {
  const status = controllerTaskStatusReport(project);
  const rows = status.rows.map((row, index): ControllerTaskVerificationRow => {
    const action = verificationAction(row);
    return {
      id: verificationRowId(row, index),
      severity: verificationSeverity(row),
      controllerName: row.controllerName,
      taskName: row.taskName,
      taskType: row.taskType,
      programName: row.programName ?? row.programId,
      routineId: row.routineId,
      routineName: row.routineName,
      status: row.status,
      source: row.source,
      scanEligible: row.scanEligible,
      watchdogMs: row.watchdogMs,
      watchdogConfigured: row.statusBits.watchdogConfigured,
      ...action,
    };
  });
  const passCount = rows.filter((row) => row.severity === "pass").length;
  const warningCount = rows.filter((row) => row.severity === "warning").length;
  const blockedCount = rows.filter((row) => row.severity === "blocked").length;
  const summary = `${passCount} pass, ${warningCount} warning, ${blockedCount} blocked`;
  return { rows, passCount, warningCount, blockedCount, summary };
}
