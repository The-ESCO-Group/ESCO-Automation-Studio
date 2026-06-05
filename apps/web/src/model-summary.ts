import type { AddOnInstruction, PlcProject, Routine } from "@esco/core";
import {
  createDefaultRegistry,
  instructionFidelity,
  instructionFidelityLabel,
  type InstructionFidelityStatus,
} from "@esco/instructions";
import { rungNodes, type LadderRoutine } from "@esco/ladder";
import { tokenizeStructuredText, type StructuredTextToken } from "@esco/parser-l5x";
import {
  advancedDomainReviewReport,
  alarmReviewReport,
  analyzeProjectStructure,
  controllerConsumeRpiReviewReport,
  getLadder,
  ioModuleReviewReport,
  moduleConnectionReviewReport,
  processLibraryReviewReport,
  programParameterConnectionReviewReport,
  tagConnectionReviewReport,
  tagEngineeringUnitReviewReport,
  type AdvancedDomainReviewReport,
  type AlarmReviewReport,
  type ControllerConsumeRpiReviewReport,
  type IoModuleReviewReport,
  type ModuleConnectionReviewReport,
  type ProgramParameterConnectionReviewReport,
  type ProcessLibraryReviewReport,
  type ProjectStructureAnalysisReport,
  type TagConnectionReviewReport,
  type TagEngineeringUnitReviewReport,
} from "@esco/project-actions";
import type { ValidationFinding } from "@esco/validator";

const registry = createDefaultRegistry();

function aoiHasExecutableRll(aoi: AddOnInstruction): boolean {
  if (aoi.protected) return false;
  return (aoi.routines ?? []).some((routine) => !!getLadder(routine));
}

export interface ModelCounts {
  controllers: number;
  tasks: number;
  programs: number;
  routines: number;
  controllerTags: number;
  programTags: number;
  tags: number;
  aois: number;
  udts: number;
  ioModules: number;
  rungs: number;
}

export interface UnsupportedInstruction {
  type: string;
  count: number;
}

export interface ModelOnlyInstruction {
  type: string;
  count: number;
}

export type InstructionSourceLanguage = "ladder" | "structured-text";

export interface InstructionFidelityRow {
  type: string;
  count: number;
  status: InstructionFidelityStatus;
  label: string;
  sourceLanguages: InstructionSourceLanguage[];
  summary: string;
  needsAttention: boolean;
}

export interface ModelInstructionFidelity {
  total: number;
  executable: number;
  preserved: number;
  unsupported: number;
  byStatus: Record<InstructionFidelityStatus, number>;
  rows: InstructionFidelityRow[];
  attentionRows: InstructionFidelityRow[];
}

export interface StructuredTextCoverageRow {
  controllerName: string;
  programName: string;
  routineName: string;
  lineCount: number;
  callCount: number;
  executableCallCount: number;
  preservedCallCount: number;
  unsupportedCallCount: number;
  controlFlow: string[];
  summary: string;
}

export interface StructuredTextCoverage {
  routineCount: number;
  lineCount: number;
  callCount: number;
  executableCallCount: number;
  preservedCallCount: number;
  unsupportedCallCount: number;
  routinesWithControlFlow: number;
  rows: StructuredTextCoverageRow[];
}

export interface ModelSummary {
  projectName: string;
  controllerName?: string;
  processorType?: string;
  counts: ModelCounts;
  errorCount: number;
  warningCount: number;
  /** Instruction types present in the project that the registry does not support, with occurrence counts. */
  unsupportedInstructions: UnsupportedInstruction[];
  unsupportedTotal: number;
  /** Registered model-only instructions preserved for review but not simulated. */
  modelOnlyInstructions: ModelOnlyInstruction[];
  modelOnlyTotal: number;
  /** Whole-project instruction fidelity across ladder and Structured Text. */
  instructionFidelity: ModelInstructionFidelity;
  /** Structured Text source coverage and offline execution boundary rollup. */
  structuredTextCoverage: StructuredTextCoverage;
  /** Safety, motion, process, phase, and SFC review rollup for advanced model-only domains. */
  advancedDomainReview: AdvancedDomainReviewReport;
  /** Vendor/process library AOI/UDT/tag review rollup. */
  processLibraryReview: ProcessLibraryReviewReport;
  /** Imported I/O module profile review rollup. */
  ioModuleReview: IoModuleReviewReport;
  /** Imported I/O module connection/RPI metadata review rollup. */
  moduleConnectionReview: ModuleConnectionReviewReport;
  /** Imported produced/consumed tag connection metadata review rollup. */
  tagConnectionReview: TagConnectionReviewReport;
  /** Imported tag engineering-unit metadata review rollup. */
  tagEngineeringUnitReview: TagEngineeringUnitReviewReport;
  /** Imported controller consumed-tag RPI source metadata review rollup. */
  controllerConsumeRpiReview: ControllerConsumeRpiReviewReport;
  /** Imported program parameter connection metadata review rollup. */
  programParameterConnectionReview: ProgramParameterConnectionReviewReport;
  /** Imported controller/process alarm review rollup. */
  alarmReview: AlarmReviewReport;
  /** Whole-project structural counts and parity-gap evidence. */
  structureAnalysis: ProjectStructureAnalysisReport;
}

const ST_DECLARATION_OPENERS = new Set(["VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP"]);
const ST_DECLARATION_CLOSERS = new Set(["END_VAR"]);
const ST_STATEMENT_BOUNDARY_KEYWORDS = new Set(["THEN", "ELSE", "DO", "REPEAT"]);
const ST_CONTROL_CALL_EXCLUSIONS = new Set([
  "IF",
  "ELSIF",
  "CASE",
  "FOR",
  "WHILE",
  "REPEAT",
  "RETURN",
  "EXIT",
  "END_IF",
  "END_CASE",
  "END_FOR",
  "END_WHILE",
  "END_REPEAT",
]);
const ST_CONTROL_FLOW_KEYWORDS = new Map([
  ["IF", "IF/ELSIF"],
  ["ELSIF", "IF/ELSIF"],
  ["CASE", "CASE"],
  ["FOR", "FOR"],
  ["WHILE", "WHILE"],
  ["REPEAT", "REPEAT"],
  ["RETURN", "RETURN"],
]);
const ST_ROUTINE_CALL_KEYWORDS = new Set(["JSR", "SBR", "RET"]);

function normalized(value: string): string {
  return value.toUpperCase();
}

function previousToken(tokens: readonly StructuredTextToken[], index: number): StructuredTextToken | undefined {
  return tokens[index - 1];
}

function isStructuredTextStatementBoundary(tokens: readonly StructuredTextToken[], index: number): boolean {
  const previous = previousToken(tokens, index);
  if (!previous) return true;
  if (previous.value === ";" || previous.value === ":") return true;
  if (ST_DECLARATION_CLOSERS.has(normalized(previous.value))) return true;
  return previous.kind === "keyword" && ST_STATEMENT_BOUNDARY_KEYWORDS.has(normalized(previous.value));
}

function structuredTextCallAt(
  tokens: readonly StructuredTextToken[],
  index: number,
): { name: string; endIndex: number } | undefined {
  const token = tokens[index];
  if (!token || (token.kind !== "identifier" && token.kind !== "keyword")) return undefined;
  const name = normalized(token.value);
  if (ST_CONTROL_CALL_EXCLUSIONS.has(name)) return undefined;
  if (tokens[index + 1]?.kind !== "punctuation" || tokens[index + 1]?.value !== "(") return undefined;

  let depth = 0;
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const item = tokens[cursor]!;
    if (item.kind !== "punctuation") continue;
    if (item.value === "(") depth += 1;
    else if (item.value === ")") {
      depth -= 1;
      if (depth === 0) return { name, endIndex: cursor };
    }
  }
  return undefined;
}

function structuredTextInstructionCalls(source: string): string[] {
  const tokens = tokenizeStructuredText(source).filter((token) => token.kind !== "comment");
  const calls: string[] = [];
  let inDeclaration = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const upper = normalized(token.value);
    if (ST_DECLARATION_OPENERS.has(upper)) {
      inDeclaration = true;
      continue;
    }
    if (ST_DECLARATION_CLOSERS.has(upper)) {
      inDeclaration = false;
      continue;
    }
    if (inDeclaration || !isStructuredTextStatementBoundary(tokens, index)) continue;

    const call = structuredTextCallAt(tokens, index);
    if (!call) continue;
    calls.push(call.name);
    index = call.endIndex;
  }

  return calls;
}

function structuredTextControlFlow(source: string): string[] {
  const tokens = tokenizeStructuredText(source).filter((token) => token.kind !== "comment");
  const found = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const upper = normalized(token.value);
    const control = ST_CONTROL_FLOW_KEYWORDS.get(upper);
    if (control) found.add(control);
    const call = structuredTextCallAt(tokens, index);
    if (call && ST_ROUTINE_CALL_KEYWORDS.has(call.name)) found.add(call.name);
  }
  if (source.includes(":=")) found.add("Assignments");
  return [...found].sort((a, b) => a.localeCompare(b));
}

function structuredTextCoverageRow(
  controllerName: string,
  programName: string,
  routine: Routine,
  calls: readonly string[],
  aoisByType: Map<string, AddOnInstruction>,
): StructuredTextCoverageRow {
  let executableCallCount = 0;
  let preservedCallCount = 0;
  let unsupportedCallCount = 0;
  for (const type of calls) {
    const definition = registry.get(type);
    const aoi = definition ? undefined : aoisByType.get(type.toUpperCase());
    const fidelity = definition
      ? instructionFidelity(definition)
      : aoi
        ? aoiFidelity(aoi)
        : instructionFidelity(undefined);
    if (fidelity.status.startsWith("executable")) executableCallCount += 1;
    else if (fidelity.status === "unsupported") unsupportedCallCount += 1;
    else preservedCallCount += 1;
  }
  const source = routine.structuredText ?? routine.sourceText ?? "";
  const controlFlow = structuredTextControlFlow(source);
  const lineCount = source.split(/\r?\n/).filter((line) => line.trim()).length;
  const callCount = calls.length;
  return {
    controllerName,
    programName,
    routineName: routine.name,
    lineCount,
    callCount,
    executableCallCount,
    preservedCallCount,
    unsupportedCallCount,
    controlFlow,
    summary: `${routine.name}: ${executableCallCount}/${callCount} registered call${callCount === 1 ? "" : "s"} executable or partial offline; ${preservedCallCount + unsupportedCallCount} preserved for review.`,
  };
}

function aoiFidelity(aoi: AddOnInstruction): { status: InstructionFidelityStatus; summary: string } {
  if (aoiHasExecutableRll(aoi)) {
    return {
      status: "executable-partial",
      summary: "Add-On Instruction with imported ladder body; the offline simulator can inline and execute its ladder routine.",
    };
  }
  return {
    status: "review-only",
    summary: "Add-On Instruction is source-protected or has no imported ladder body; preserved for review and not simulated.",
  };
}

function addSourceLanguage(row: InstructionFidelityRow, sourceLanguage: InstructionSourceLanguage): void {
  if (row.sourceLanguages.includes(sourceLanguage)) return;
  row.sourceLanguages.push(sourceLanguage);
  row.sourceLanguages.sort((a, b) => a.localeCompare(b));
}

/**
 * Aggregate read-only counts and health for the whole project. Pure and
 * dependency-light so it can be unit-tested and memoized in the UI. Unsupported
 * instructions are detected by scanning every ladder rung against the
 * instruction registry — the same registry the editor uses as source of truth.
 */
export function buildModelSummary(
  project: PlcProject,
  findings: ValidationFinding[] = [],
): ModelSummary {
  let tasks = 0;
  let programs = 0;
  let routines = 0;
  let controllerTags = 0;
  let programTags = 0;
  let aois = 0;
  let udts = 0;
  let ioModules = 0;
  let rungs = 0;
  const byStatus: Record<InstructionFidelityStatus, number> = {
    "executable-simulation": 0,
    "executable-partial": 0,
    "model-only": 0,
    "review-only": 0,
    unsupported: 0,
  };
  const fidelityRows = new Map<string, InstructionFidelityRow>();
  const structuredTextRows: StructuredTextCoverageRow[] = [];
  let instructionTotal = 0;

  const recordInstruction = (
    type: string,
    sourceLanguage: InstructionSourceLanguage,
    aoisByType: Map<string, AddOnInstruction>,
  ): void => {
    const definition = registry.get(type);
    const aoi = definition ? undefined : aoisByType.get(type.toUpperCase());
    const fidelity = definition
      ? instructionFidelity(definition)
      : aoi
        ? aoiFidelity(aoi)
        : instructionFidelity(undefined);
    const displayType = aoi?.name ?? type;
    const key = `${displayType}|${fidelity.status}`;

    instructionTotal += 1;
    byStatus[fidelity.status] += 1;
    const existing = fidelityRows.get(key);
    if (existing) {
      existing.count += 1;
      addSourceLanguage(existing, sourceLanguage);
      return;
    }
    fidelityRows.set(key, {
      type: displayType,
      count: 1,
      status: fidelity.status,
      label: instructionFidelityLabel(fidelity.status),
      sourceLanguages: [sourceLanguage],
      summary: fidelity.summary,
      needsAttention: !fidelity.status.startsWith("executable"),
    });
  };

  for (const controller of project.controllers) {
    const aoisByType = new Map(controller.addOnInstructions.map((aoi) => [aoi.name.toUpperCase(), aoi]));
    tasks += controller.tasks.length;
    controllerTags += controller.controllerTags.length;
    aois += controller.addOnInstructions.length;
    udts += controller.dataTypes.length;
    ioModules += controller.ioConfiguration.modules.length;
    for (const program of controller.programs) {
      programs += 1;
      programTags += program.programTags.length;
      for (const routine of program.routines) {
        routines += 1;
        const ladder = getLadder(routine) as LadderRoutine | undefined;
        if (ladder) {
          rungs += ladder.rungs.length;
          for (const rung of ladder.rungs) {
            for (const node of rungNodes(rung)) {
              recordInstruction(node.instructionType, "ladder", aoisByType);
            }
          }
          continue;
        }
        if (routine.language === "structured-text") {
          const source = routine.structuredText ?? routine.sourceText ?? "";
          const calls = structuredTextInstructionCalls(source);
          for (const type of calls) {
            recordInstruction(type, "structured-text", aoisByType);
          }
          structuredTextRows.push(structuredTextCoverageRow(controller.name, program.name, routine, calls, aoisByType));
        }
      }
    }
  }

  const firstController = project.controllers[0];
  const rows = [...fidelityRows.values()].sort(
    (a, b) =>
      Number(b.needsAttention) - Number(a.needsAttention) ||
      b.count - a.count ||
      a.type.localeCompare(b.type) ||
      a.status.localeCompare(b.status),
  );
  const unsupportedInstructions = rows
    .filter((row) => row.status === "unsupported")
    .map(({ type, count }) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  const modelOnlyInstructions = rows
    .filter((row) => row.status === "model-only" || row.status === "review-only")
    .map(({ type, count }) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  const instructionFidelitySummary: ModelInstructionFidelity = {
    total: instructionTotal,
    executable: byStatus["executable-simulation"] + byStatus["executable-partial"],
    preserved: byStatus["model-only"] + byStatus["review-only"] + byStatus.unsupported,
    unsupported: byStatus.unsupported,
    byStatus,
    rows,
    attentionRows: rows.filter((row) => row.needsAttention),
  };
  const structuredTextCoverage: StructuredTextCoverage = {
    routineCount: structuredTextRows.length,
    lineCount: structuredTextRows.reduce((sum, row) => sum + row.lineCount, 0),
    callCount: structuredTextRows.reduce((sum, row) => sum + row.callCount, 0),
    executableCallCount: structuredTextRows.reduce((sum, row) => sum + row.executableCallCount, 0),
    preservedCallCount: structuredTextRows.reduce((sum, row) => sum + row.preservedCallCount, 0),
    unsupportedCallCount: structuredTextRows.reduce((sum, row) => sum + row.unsupportedCallCount, 0),
    routinesWithControlFlow: structuredTextRows.filter((row) => row.controlFlow.length > 0).length,
    rows: structuredTextRows.sort(
      (a, b) =>
        b.unsupportedCallCount - a.unsupportedCallCount ||
        b.preservedCallCount - a.preservedCallCount ||
        b.callCount - a.callCount ||
        a.routineName.localeCompare(b.routineName),
    ),
  };

  return {
    projectName: project.name,
    controllerName: firstController?.name,
    processorType: firstController?.processorType,
    counts: {
      controllers: project.controllers.length,
      tasks,
      programs,
      routines,
      controllerTags,
      programTags,
      tags: controllerTags + programTags,
      aois,
      udts,
      ioModules,
      rungs,
    },
    errorCount: findings.filter((f) => f.severity === "error").length,
    warningCount: findings.filter((f) => f.severity === "warning").length,
    unsupportedInstructions,
    unsupportedTotal: unsupportedInstructions.reduce((sum, u) => sum + u.count, 0),
    modelOnlyInstructions,
    modelOnlyTotal: modelOnlyInstructions.reduce((sum, u) => sum + u.count, 0),
    instructionFidelity: instructionFidelitySummary,
    structuredTextCoverage,
    advancedDomainReview: advancedDomainReviewReport(project),
    processLibraryReview: processLibraryReviewReport(project),
    ioModuleReview: ioModuleReviewReport(project),
    moduleConnectionReview: moduleConnectionReviewReport(project),
    tagConnectionReview: tagConnectionReviewReport(project),
    tagEngineeringUnitReview: tagEngineeringUnitReviewReport(project),
    controllerConsumeRpiReview: controllerConsumeRpiReviewReport(project),
    programParameterConnectionReview: programParameterConnectionReviewReport(project),
    alarmReview: alarmReviewReport(project),
    structureAnalysis: analyzeProjectStructure(project),
  };
}
