import type {
  AddOnInstruction,
  Controller,
  IoModule,
  PlcProject,
  Program,
  Routine,
  Tag,
  Task,
  UserDefinedType,
} from "@esco/core";
import type { ValidationFinding, ValidationSeverity } from "@esco/validator";
import { validateIndustrialProject, type IndustrialValidationFinding } from "./industrial-validation";

export type DiagnosticArea =
  | "Project"
  | "Controller"
  | "Logic"
  | "Structured Text"
  | "Tags/Data Types"
  | "Tasks/Schedule"
  | "I/O Hardware"
  | "Safety"
  | "HMI/Import";

export type DiagnosticTargetKind =
  | "project"
  | "controller"
  | "program"
  | "routine"
  | "task"
  | "tag"
  | "io-module"
  | "aoi"
  | "udt"
  | "unknown";

export interface DiagnosticTarget {
  kind: DiagnosticTargetKind;
  label: string;
  path: string;
  openable: boolean;
  controllerId?: string;
  programId?: string;
  routineId?: string;
  taskId?: string;
  tagId?: string;
  tagName?: string;
  moduleId?: string;
  aoiName?: string;
  udtName?: string;
}

export interface DiagnosticSummary {
  errors: number;
  warnings: number;
  messages: number;
  total: number;
  status: "Passed" | "Warnings" | "Failed";
}

export interface BuildDiagnosticStep {
  id: string;
  step: string;
  target: string;
  status: "Ready" | "Passed" | "Warnings" | "Failed";
  severity: ValidationSeverity;
  area: DiagnosticArea;
  scope: string;
  source: string;
  description: string;
  recommendation: string;
  targetLabel: string;
  actionLabel?: "Open" | "Watch" | "XRef";
  finding?: ValidationFinding;
  targetInfo?: DiagnosticTarget;
}

export interface DiagnosticRow {
  finding: ValidationFinding;
  target: DiagnosticTarget;
  area: DiagnosticArea;
  scope: string;
  source: string;
  message: string;
  recommendation: string;
  targetLabel: string;
  actionLabel?: "Open" | "Watch" | "XRef";
}

export interface DiagnosticOptions {
  includeIndustrialValidation?: boolean;
}

function sameName(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function splitTarget(target: string | undefined): string[] {
  return (target ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function projectTarget(project: PlcProject): DiagnosticTarget {
  return {
    kind: "project",
    label: project.name,
    path: project.name,
    openable: true,
  };
}

function controllerTarget(controller: Controller): DiagnosticTarget {
  return {
    kind: "controller",
    label: controller.name,
    path: controller.name,
    openable: true,
    controllerId: controller.id,
  };
}

function programTarget(controller: Controller, program: Program): DiagnosticTarget {
  return {
    kind: "program",
    label: program.name,
    path: `${controller.name}/${program.name}`,
    openable: true,
    controllerId: controller.id,
    programId: program.id,
  };
}

function routineTarget(controller: Controller, program: Program, routine: Routine): DiagnosticTarget {
  return {
    kind: "routine",
    label: routine.name,
    path: `${controller.name}/${program.name}/${routine.name}`,
    openable: true,
    controllerId: controller.id,
    programId: program.id,
    routineId: routine.id,
  };
}

function taskTarget(controller: Controller, task: Task): DiagnosticTarget {
  return {
    kind: "task",
    label: task.name,
    path: `${controller.name}/${task.name}`,
    openable: true,
    controllerId: controller.id,
    taskId: task.id,
  };
}

function tagTarget(controller: Controller, tag: Tag, program?: Program): DiagnosticTarget {
  const path = program ? `${controller.name}/${program.name}/${tag.name}` : `${controller.name}/${tag.name}`;
  return {
    kind: "tag",
    label: tag.name,
    path,
    openable: true,
    controllerId: controller.id,
    programId: program?.id,
    tagId: tag.id,
    tagName: program ? `Program:${program.name}.${tag.name}` : tag.name,
  };
}

function moduleTarget(controller: Controller, module: IoModule): DiagnosticTarget {
  return {
    kind: "io-module",
    label: module.name,
    path: `${controller.name}/${module.name}`,
    openable: true,
    controllerId: controller.id,
    moduleId: module.id,
  };
}

function aoiTarget(controller: Controller, aoi: AddOnInstruction): DiagnosticTarget {
  return {
    kind: "aoi",
    label: aoi.name,
    path: `${controller.name}/${aoi.name}`,
    openable: true,
    controllerId: controller.id,
    aoiName: aoi.name,
  };
}

function udtTarget(controller: Controller, udt: UserDefinedType): DiagnosticTarget {
  return {
    kind: "udt",
    label: udt.name,
    path: `${controller.name}/${udt.name}`,
    openable: true,
    controllerId: controller.id,
    udtName: udt.name,
  };
}

function unknownTarget(finding: ValidationFinding): DiagnosticTarget {
  const path = finding.target ?? "Project";
  return {
    kind: "unknown",
    label: path,
    path,
    openable: false,
  };
}

function industrialSeverity(severity: IndustrialValidationFinding["severity"]): ValidationSeverity {
  return severity === "suggestion" ? "info" : severity;
}

function findProgramById(controller: Controller, id: string | undefined): Program | undefined {
  if (!id) return undefined;
  return controller.programs.find((program) => program.id === id);
}

function findTagById(controller: Controller, id: string | undefined): { tag: Tag; program?: Program } | undefined {
  if (!id) return undefined;
  const controllerTag = controller.controllerTags.find((tag) => tag.id === id);
  if (controllerTag) return { tag: controllerTag };
  for (const program of controller.programs) {
    const tag = program.programTags.find((candidate) => candidate.id === id);
    if (tag) return { tag, program };
  }
  return undefined;
}

function industrialTarget(project: PlcProject, finding: IndustrialValidationFinding): DiagnosticTarget {
  const controller = finding.target.controllerId
    ? project.controllers.find((candidate) => candidate.id === finding.target.controllerId)
    : project.controllers.find((candidate) => sameName(candidate.name, finding.target.name));
  if (!controller) return projectTarget(project);

  const task = findTask(controller, finding.target.taskId);
  if (task) return taskTarget(controller, task);

  const tag = findTagById(controller, finding.target.tagId);
  if (tag) return tagTarget(controller, tag.tag, tag.program);

  const module = findModule(controller, finding.target.moduleId);
  if (module) return moduleTarget(controller, module);

  const program = findProgramById(controller, finding.target.programId);
  if (program) return programTarget(controller, program);

  if (finding.target.kind === "controller" || finding.target.kind === "controller-network") return controllerTarget(controller);
  return controllerTarget(controller);
}

function industrialFinding(project: PlcProject, finding: IndustrialValidationFinding): ValidationFinding {
  const target = industrialTarget(project, finding);
  return {
    ruleId: `industrial-${finding.ruleId}`,
    severity: industrialSeverity(finding.severity),
    message: finding.message,
    target: target.path,
  };
}

function verifyFindingSeverity(finding: ValidationFinding): ValidationFinding {
  if (
    finding.severity === "info" &&
    (finding.ruleId === "model-only-instruction" || finding.ruleId === "unsupported-instruction")
  ) {
    return { ...finding, severity: "warning" };
  }
  return finding;
}

function allFindings(project: PlcProject, findings: readonly ValidationFinding[], options: DiagnosticOptions = {}): ValidationFinding[] {
  const verifyFindings = findings.map(verifyFindingSeverity);
  if (!options.includeIndustrialValidation) return verifyFindings;
  const industrial = validateIndustrialProject(project).findings.map((finding) => industrialFinding(project, finding));
  const seen = new Set(verifyFindings.map((finding) => [finding.ruleId, finding.target ?? "", finding.message].join("\u0000")));
  return [
    ...verifyFindings,
    ...industrial.filter((finding) => {
      const key = [finding.ruleId, finding.target ?? "", finding.message].join("\u0000");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}

function findController(project: PlcProject, nameOrId: string | undefined): Controller | undefined {
  if (!nameOrId) return project.controllers[0];
  return project.controllers.find((controller) => sameName(controller.name, nameOrId) || controller.id === nameOrId);
}

function findProgram(controller: Controller, nameOrId: string | undefined): Program | undefined {
  if (!nameOrId) return undefined;
  return controller.programs.find((program) => sameName(program.name, nameOrId) || program.id === nameOrId);
}

function findRoutine(program: Program, nameOrId: string | undefined): Routine | undefined {
  if (!nameOrId) return undefined;
  return program.routines.find((routine) => sameName(routine.name, nameOrId) || routine.id === nameOrId);
}

function findTask(controller: Controller, nameOrId: string | undefined): Task | undefined {
  if (!nameOrId) return undefined;
  return controller.tasks.find((task) => sameName(task.name, nameOrId) || task.id === nameOrId);
}

function findControllerTag(controller: Controller, nameOrId: string | undefined): Tag | undefined {
  if (!nameOrId) return undefined;
  return controller.controllerTags.find((tag) => sameName(tag.name, nameOrId) || tag.id === nameOrId);
}

function findProgramTag(program: Program, nameOrId: string | undefined): Tag | undefined {
  if (!nameOrId) return undefined;
  return program.programTags.find((tag) => sameName(tag.name, nameOrId) || tag.id === nameOrId);
}

function findModule(controller: Controller, nameOrId: string | undefined): IoModule | undefined {
  if (!nameOrId) return undefined;
  return controller.ioConfiguration.modules.find((module) => sameName(module.name, nameOrId) || module.id === nameOrId);
}

function findAoi(controller: Controller, nameOrId: string | undefined): AddOnInstruction | undefined {
  if (!nameOrId) return undefined;
  return controller.addOnInstructions.find((aoi) => sameName(aoi.name, nameOrId));
}

function findUdt(controller: Controller, nameOrId: string | undefined): UserDefinedType | undefined {
  if (!nameOrId) return undefined;
  return controller.dataTypes.find((udt) => sameName(udt.name, nameOrId));
}

export function resolveValidationFindingTarget(project: PlcProject, finding: ValidationFinding): DiagnosticTarget {
  const parts = splitTarget(finding.target);
  if (parts.length === 0) return projectTarget(project);

  const controller = findController(project, parts[0]);
  if (!controller) return unknownTarget(finding);
  if (parts.length === 1) return controllerTarget(controller);

  const second = parts[1];
  const third = parts[2];
  const program = findProgram(controller, second);
  if (program) {
    if (third) {
      const routine = findRoutine(program, third);
      if (routine) return routineTarget(controller, program, routine);
      const programTag = findProgramTag(program, third);
      if (programTag) return tagTarget(controller, programTag, program);
    }
    return programTarget(controller, program);
  }

  const task = findTask(controller, second);
  if (task) return taskTarget(controller, task);

  const controllerTag = findControllerTag(controller, second);
  if (controllerTag) return tagTarget(controller, controllerTag);

  const module = findModule(controller, second);
  if (module) return moduleTarget(controller, module);

  const aoi = findAoi(controller, second);
  if (aoi) return aoiTarget(controller, aoi);

  const udt = findUdt(controller, second);
  if (udt) return udtTarget(controller, udt);

  return unknownTarget(finding);
}

export function summarizeValidationFindings(findings: readonly ValidationFinding[]): DiagnosticSummary {
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const messages = findings.filter((finding) => finding.severity === "info").length;
  return {
    errors,
    warnings,
    messages,
    total: findings.length,
    status: errors ? "Failed" : warnings ? "Warnings" : "Passed",
  };
}

function scopeFor(target: DiagnosticTarget): string {
  switch (target.kind) {
    case "routine":
      return "Routine";
    case "program":
      return "Program";
    case "controller":
      return "Controller";
    case "task":
      return "Task";
    case "tag":
      return "Tag";
    case "io-module":
      return "I/O Module";
    case "aoi":
      return "AOI";
    case "udt":
      return "Data Type";
    case "project":
      return "Project";
    default:
      return "Unresolved";
  }
}

function sourceFor(finding: ValidationFinding, area: DiagnosticArea, target: DiagnosticTarget): string {
  const rule = finding.ruleId.toLowerCase();
  if (rule.startsWith("industrial-")) {
    if (area === "I/O Hardware") return "Offline I/O profile";
    if (area === "Tasks/Schedule") return "Controller organizer";
    return "Industrial validation";
  }
  if (/module|slot|chassis|keying|rpi|parent|network/.test(rule) || target.kind === "io-module") {
    return "Offline I/O profile";
  }
  if (/model-only|unsupported|instruction-validation/.test(rule)) return "Instruction catalog";
  if (/structured-text|^st-/.test(rule)) return "Structured Text compiler";
  if (/duplicate|invalid-.*name|reserved-name|definition-name/.test(rule)) return "Controller name rules";
  if (/routine|task|schedule|main|fault|jsr|jump|label/.test(rule)) return "Controller organizer";
  if (/tag|alias|data-type|datatype|array|member|radix|produced|consumed/.test(rule)) return "Tag database";
  if (target.kind === "routine" || target.kind === "program" || target.kind === "task") return "Controller organizer";
  if (target.kind === "tag" || target.kind === "udt") return "Tag database";
  if (target.kind === "controller") return "Controller properties";
  return `${area} check`;
}

function recommendationFor(finding: ValidationFinding, area: DiagnosticArea, target: DiagnosticTarget): string {
  const rule = finding.ruleId.toLowerCase();
  if (/structured-text|^st-/.test(rule)) return "Open the routine and correct the Structured Text syntax, references, or block terminators.";
  if (/module|slot|chassis|keying|rpi|parent|network|i\/o|io-/.test(rule) || area === "I/O Hardware") {
    return "Open the I/O module profile and correct slot, parent, connection, keying, RPI, or network metadata.";
  }
  if (/missing-main|dangling-routine|unreferenced-routine|routine-reference/.test(rule)) {
    return "Open the program or routine, then set the correct main/fault routine or update the JSR target.";
  }
  if (/task|schedule|watchdog|rate|periodic|continuous|event/.test(rule)) {
    return "Review task properties and scheduled programs; set period/watchdog values that match the controller design.";
  }
  if (/duplicate|invalid-.*name|reserved-name|definition-name/.test(rule)) {
    return "Rename the item to a unique controller-compatible identifier before exporting or verifying again.";
  }
  if (/alias|undefined|unresolved|data-type|datatype|member|array|tag/.test(rule)) {
    return target.tagName
      ? "Watch or cross-reference the tag, then fix the missing definition, alias target, type, or member path."
      : "Inspect the tag/data type definition and fix missing aliases, types, dimensions, or member paths.";
  }
  if (/model-only|unsupported/.test(rule)) {
    return "Treat this instruction as offline-review only; verify execution semantics in approved controller tools before download.";
  }
  if (/instruction-validation|operand|write-target/.test(rule)) {
    return "Open the routine and correct instruction operands, writable targets, or data type compatibility.";
  }
  if (area === "Safety") return "Review safety metadata and confirm the partition/signature constraints in approved controller tools before relying on the project.";
  return "Open the target item, review the highlighted offline check, then run Verify Controller again.";
}

function actionFor(target: DiagnosticTarget): DiagnosticRow["actionLabel"] | undefined {
  if (target.tagName) return "XRef";
  if (target.openable) return "Open";
  return undefined;
}

function targetLabelFor(target: DiagnosticTarget): string {
  return `${scopeFor(target)}: ${target.label}`;
}

export function createDiagnosticRows(
  project: PlcProject,
  findings: readonly ValidationFinding[],
  options: DiagnosticOptions = {},
): DiagnosticRow[] {
  return allFindings(project, findings, options).map((finding) => {
    const target = resolveValidationFindingTarget(project, finding);
    const area = classifyDiagnosticArea(finding, target);
    return {
      finding,
      target,
      area,
      scope: scopeFor(target),
      source: sourceFor(finding, area, target),
      message: finding.message,
      recommendation: recommendationFor(finding, area, target),
      targetLabel: targetLabelFor(target),
      actionLabel: actionFor(target),
    };
  });
}

export function classifyDiagnosticArea(finding: ValidationFinding, target?: DiagnosticTarget): DiagnosticArea {
  const rule = finding.ruleId.toLowerCase();
  const text = `${finding.message} ${finding.target ?? ""}`.toLowerCase();
  if (target?.kind === "io-module" || /module|i\/o|io-|slot|chassis|keying|connection-rpi|safety-network/.test(rule)) {
    return "I/O Hardware";
  }
  if (/structured-text|^st-| st |end_if|case/.test(rule) || /structured text/.test(text)) return "Structured Text";
  if (/safety|guardlogix|signature|sil/.test(rule) || /safety/.test(text)) return "Safety";
  if (target?.kind === "task" || /task|schedule|scheduled|watchdog|rate|continuous|periodic|event/.test(rule)) {
    return "Tasks/Schedule";
  }
  if (/tag|alias|data-type|datatype|array|member|radix|produced|consumed|external-access/.test(rule)) {
    return "Tags/Data Types";
  }
  if (/hmi|import|export|l5x|documentation|audit|project-matching/.test(rule)) return "HMI/Import";
  if (target?.kind === "controller" || /controller|redundancy|wall-clock|time-sync|ethernet|comm/.test(rule)) {
    return "Controller";
  }
  if (/ladder|operand|instruction|routine|jump|label|aoi|write-target|missing-main/.test(rule)) return "Logic";
  return "Project";
}

function worstSeverity(findings: readonly ValidationFinding[]): ValidationSeverity {
  if (findings.some((finding) => finding.severity === "error")) return "error";
  if (findings.some((finding) => finding.severity === "warning")) return "warning";
  return "info";
}

function statusFor(findings: readonly ValidationFinding[]): BuildDiagnosticStep["status"] {
  if (findings.some((finding) => finding.severity === "error")) return "Failed";
  if (findings.some((finding) => finding.severity === "warning")) return "Warnings";
  return "Passed";
}

function describeArea(area: DiagnosticArea, findings: readonly ValidationFinding[]): string {
  if (findings.length === 0) {
    switch (area) {
      case "I/O Hardware":
        return "No chassis, slot, parent, keying, RPI, or safety-network hardware issues were reported.";
      case "Structured Text":
        return "Structured Text routines passed syntax and reference checks.";
      case "Logic":
        return "Ladder routines passed operand, instruction, routine, and label checks.";
      case "Tags/Data Types":
        return "Tags, aliases, arrays, UDTs, AOIs, and produced/consumed metadata passed offline checks.";
      case "Tasks/Schedule":
        return "Tasks, schedules, main routines, periods, priorities, and watchdogs passed offline checks.";
      case "Safety":
        return "Safety partition metadata passed the available offline checks.";
      case "Controller":
        return "Controller metadata passed the available offline checks.";
      case "HMI/Import":
        return "Imported metadata and HMI review checks have no active validation findings.";
      default:
        return "Project-level validation passed.";
    }
  }
  const summary = summarizeValidationFindings(findings);
  const parts = [
    summary.errors ? `${summary.errors} error${summary.errors === 1 ? "" : "s"}` : "",
    summary.warnings ? `${summary.warnings} warning${summary.warnings === 1 ? "" : "s"}` : "",
    summary.messages ? `${summary.messages} message${summary.messages === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `${parts.join(", ")} need review in ${area}.`;
}

export function createBuildDiagnostics(
  project: PlcProject,
  findings: readonly ValidationFinding[],
  options: DiagnosticOptions = {},
): BuildDiagnosticStep[] {
  const rows = createDiagnosticRows(project, findings, options);
  const effectiveFindings = rows.map((row) => row.finding);
  const summary = summarizeValidationFindings(effectiveFindings);
  const controllerNames = project.controllers.map((controller) => controller.name).join(", ") || "-";
  const projectCounts = {
    controllers: project.controllers.length,
    programs: project.controllers.reduce((sum, controller) => sum + controller.programs.length, 0),
    routines: project.controllers.reduce(
      (sum, controller) => sum + controller.programs.reduce((programSum, program) => programSum + program.routines.length, 0),
      0,
    ),
    tags: project.controllers.reduce(
      (sum, controller) =>
        sum + controller.controllerTags.length + controller.programs.reduce((programSum, program) => programSum + program.programTags.length, 0),
      0,
    ),
    modules: project.controllers.reduce((sum, controller) => sum + controller.ioConfiguration.modules.length, 0),
  };
  const byArea = (area: DiagnosticArea) => rows.filter((row) => row.area === area).map((row) => row.finding);
  const phaseAreas: DiagnosticArea[] = [
    "Controller",
    "I/O Hardware",
    "Tasks/Schedule",
    "Logic",
    "Structured Text",
    "Tags/Data Types",
    "Safety",
    "HMI/Import",
  ];

  const steps: BuildDiagnosticStep[] = [
    {
      id: "project",
      step: "Project",
      target: project.name,
      status: "Ready",
      severity: "info",
      area: "Project",
      scope: "Project",
      source: "Project model",
      description: `${projectCounts.controllers} controller(s), ${projectCounts.programs} program(s), ${projectCounts.routines} routine(s), ${projectCounts.tags} tag(s), ${projectCounts.modules} I/O module(s).`,
      recommendation: "Use this row as the verify inventory before reviewing component findings.",
      targetLabel: `Project: ${project.name}`,
      actionLabel: "Open",
      targetInfo: projectTarget(project),
    },
    {
      id: "controller",
      step: "Controller",
      target: controllerNames,
      status: summary.status,
      severity: summary.errors ? "error" : summary.warnings ? "warning" : "info",
      area: "Controller",
      scope: "Controller",
      source: "Verify Controller",
      description: "Offline verification snapshot; no controller connection, download, or online edit is attempted.",
      recommendation: "Review failed and warning rows below, then re-run Verify Controller.",
      targetLabel: project.controllers[0] ? `Controller: ${project.controllers[0].name}` : `Project: ${project.name}`,
      actionLabel: "Open",
      targetInfo: project.controllers[0] ? controllerTarget(project.controllers[0]) : projectTarget(project),
    },
    ...phaseAreas.map((area): BuildDiagnosticStep => {
      const areaFindings = byArea(area);
      return {
        id: `phase-${area.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        step: area,
        target: project.name,
        status: statusFor(areaFindings),
        severity: areaFindings.length ? worstSeverity(areaFindings) : "info",
        area,
        scope: "Phase",
        source: `${area} checks`,
        description: describeArea(area, areaFindings),
        recommendation: areaFindings.length
          ? `Filter to ${area} findings and resolve the highest severity rows first.`
          : "No action required for this verify phase.",
        targetLabel: `Project: ${project.name}`,
        actionLabel: "Open",
        targetInfo: projectTarget(project),
      };
    }),
    {
      id: "result",
      step: "Build Result",
      target: project.name,
      status: summary.status,
      severity: summary.errors ? "error" : summary.warnings ? "warning" : "info",
      area: "Project",
      scope: "Project",
      source: "Verify Controller",
      description: summary.errors
        ? "Build failed. Resolve error findings before treating this project as verified."
        : summary.warnings
          ? "Build completed with warnings. Review warnings before download planning."
          : "Verification completed with no reported errors or warnings.",
      recommendation: summary.errors
        ? "Resolve every error row, then run Verify Controller again."
        : summary.warnings
          ? "Review warnings and messages before export or download planning."
          : "No action required.",
      targetLabel: `Project: ${project.name}`,
      targetInfo: projectTarget(project),
    },
  ];

  rows.forEach((row, index) => {
    steps.push({
      id: `finding-${index}-${row.finding.ruleId}`,
      step: row.finding.severity === "error" ? "Error" : row.finding.severity === "warning" ? "Warning" : "Message",
      target: row.target.path,
      status: row.finding.severity === "error" ? "Failed" : row.finding.severity === "warning" ? "Warnings" : "Passed",
      severity: row.finding.severity,
      area: row.area,
      scope: row.scope,
      source: row.source,
      description: row.message,
      recommendation: row.recommendation,
      targetLabel: row.targetLabel,
      actionLabel: row.actionLabel,
      finding: row.finding,
      targetInfo: row.target,
    });
  });

  return steps;
}
