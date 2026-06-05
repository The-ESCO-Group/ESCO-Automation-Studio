/**
 * Real-project structure analysis.
 *
 * `analyzeProjectStructure` reads an in-memory {@link PlcProject} (typically one
 * imported from a large external PLC engineering software L5X export) and produces an honest, read-only
 * structural report: what the project actually contains, which controller features it
 * leans on, and where ESCO Automation Studio is still missing parity.
 *
 * This is an ANALYSIS / REPORTING foundation only. It does NOT implement FBD
 * editing, vendor process-library faceplates, drive/module profiles, alarm definitions,
 * or any controller-online behavior — it measures the gap so the studio can
 * prioritize that work honestly. It is pure (no I/O, no mutation) and deterministic
 * (every list is stably sorted), so the same project always yields the same report.
 */

import type {
  AddOnInstruction,
  Controller,
  IoModule,
  PlcProject,
  Routine,
  RoutineLanguage,
  Tag,
  TaskType,
  UserDefinedType,
} from "@esco/core";
import { reviewFbdRoutineSource } from "./fbd-review";

// ---------------------------------------------------------------------------
// Report model
// ---------------------------------------------------------------------------

export type GapSeverity = "critical" | "high" | "medium" | "low";

/** One ESCO parity gap surfaced by the analysis, with honest evidence + next step. */
export interface ProjectStructureGap {
  /** Short feature area, e.g. "Function Block Diagram (FBD)". */
  area: string;
  severity: GapSeverity;
  /** What in the project triggered this gap (counts / detected signals). */
  evidence: string;
  /** What ESCO Studio supports today for this area (never overstated). */
  currentEscoSupport: string;
  /** What is still missing to reach external PLC engineering software parity for this area. */
  missingForParity: string;
  /** The concrete next step that would close (or start closing) the gap. */
  recommendedNextStep: string;
}

/** A `{ key, count }` tally row (used for top-N rankings). */
export interface CountRow {
  key: string;
  count: number;
}

/** A UDT ranked by member count. */
export interface UdtSizeRow {
  name: string;
  memberCount: number;
}

/** An AOI ranked by definition weight (parameters + local tags + routines). */
export interface AoiSizeRow {
  name: string;
  parameterCount: number;
  localTagCount: number;
  routineCount: number;
  /** parameterCount + localTagCount + routineCount — the ranking key. */
  weight: number;
  /** True when the AOI is source-protected (logic not inspectable). */
  protected: boolean;
}

/** One imported Function Block routine summarized for project-wide offline review. */
export interface FbdStructureRoutineRow {
  controllerName: string;
  sourceKind: "program" | "aoi";
  programName?: string;
  aoiName?: string;
  routineName: string;
  parseable: boolean;
  sheetCount: number;
  blockCount: number;
  inputRefCount: number;
  outputRefCount: number;
  wireCount: number;
  connectedWireCount: number;
  wireEndpointGapCount: number;
  unresolvedWireEndpointCount: number;
  duplicateElementIdCount: number;
  missingBlockTypeCount: number;
  missingRefOperandCount: number;
  parameterCount: number;
  inputParameterCount: number;
  outputParameterCount: number;
  inOutParameterCount: number;
  unknownParameterCount: number;
  missingParameterNameCount: number;
  diagnosticCount: number;
  diagnosticWarningCount: number;
  textCount: number;
  unknownElementCount: number;
  topBlockTypes: CountRow[];
  unknownElements: CountRow[];
  warnings: string[];
}

/** Project-wide Function Block Diagram import/review coverage. */
export interface FbdStructureReview {
  routineCount: number;
  programRoutineCount: number;
  aoiRoutineCount: number;
  parseableRoutineCount: number;
  preservedOnlyRoutineCount: number;
  sheetCount: number;
  blockCount: number;
  inputRefCount: number;
  outputRefCount: number;
  wireCount: number;
  connectedWireCount: number;
  wireEndpointGapCount: number;
  unresolvedWireEndpointCount: number;
  duplicateElementIdCount: number;
  missingBlockTypeCount: number;
  missingRefOperandCount: number;
  parameterCount: number;
  inputParameterCount: number;
  outputParameterCount: number;
  inOutParameterCount: number;
  unknownParameterCount: number;
  missingParameterNameCount: number;
  diagnosticCount: number;
  diagnosticWarningCount: number;
  textCount: number;
  unknownElementCount: number;
  topBlockTypes: CountRow[];
  unknownElements: CountRow[];
  routines: FbdStructureRoutineRow[];
  boundary: string;
}

/** Presence flags for controller-level metadata blocks (imported read-only). */
export interface ControllerMetadataPresence {
  redundancyInfo: boolean;
  safetyInfo: boolean;
  security: boolean;
  wallClockTime: boolean;
  timeSync: boolean;
  cst: boolean;
  ethernetConfig: boolean;
  /**
   * Whether the project carries alarm definitions / process-alarm signals.
   * Detected indirectly (ALARM_* data types, P_Alarm / *Alarm* AOIs/UDTs/tags),
   * because the ESCO model has no first-class AlarmDefinitions representation yet.
   */
  alarmDefinitions: boolean;
}

/** Vendor process-library signals detected from AOI/UDT/tag-type naming. */
export interface ProcessSignals {
  /** True when any vendor process-library naming convention was detected. */
  plantPax: boolean;
  /** Per-prefix match counts (e.g. `P_`, `raC_`, `PVLV`), sorted by count desc. */
  matchedPrefixes: CountRow[];
  /** A few representative matched names, for evidence. */
  sampleNames: string[];
  /** True when a PID/process-loop signal was detected (PID type or P_PIDE/PPID). */
  pid: boolean;
  /** True when an equipment-phase signal was detected. */
  phase: boolean;
}

/** Drive / specialty-module signals detected from I/O catalog numbers. */
export interface ModuleSignals {
  powerFlex: boolean;
  flex5094: boolean;
  hart: boolean;
  /** Industrial network bridge modules detected from known catalog patterns. */
  bridge: boolean;
  /** Matched catalog numbers grouped by signal, sorted by count desc. */
  matched: CountRow[];
}

/** Thresholds above which a large project poses a navigation/performance risk. */
export interface LargeProjectThresholds {
  programs: number;
  routines: number;
  modules: number;
}

export interface ProjectStructureAnalysisReport {
  projectName: string;
  controllerCount: number;
  taskCount: number;
  taskCountByType: Record<TaskType, number>;
  programCount: number;
  routineCount: number;
  routineCountByLanguage: Record<RoutineLanguage, number>;
  rungCount: number;
  tagCounts: { controller: number; program: number; total: number };
  /** Tag data types ranked by usage, descending (top 20). */
  topTagDataTypes: CountRow[];
  udt: { count: number; largest: UdtSizeRow[] };
  aoi: { count: number; largest: AoiSizeRow[] };
  /** Imported Function Block Diagram XML that ESCO can review offline without executing/editing it. */
  fbd: FbdStructureReview;
  io: {
    moduleCount: number;
    /** Catalog numbers ranked by occurrence, descending (top 20). */
    topCatalogNumbers: CountRow[];
    /** Module counts by `vendor`, descending. */
    vendorCounts: CountRow[];
    /** Module counts by catalog bulletin/family prefix (e.g. "1756", "5094"), descending. */
    familyCounts: CountRow[];
    portCount: number;
    connectionCount: number;
  };
  trendCount: number;
  quickWatchCount: number;
  controllerMetadata: ControllerMetadataPresence;
  /** Routine languages actually used anywhere in the project (sorted, stable). */
  routineLanguagesUsed: RoutineLanguage[];
  processSignals: ProcessSignals;
  moduleSignals: ModuleSignals;
  thresholds: LargeProjectThresholds;
  /** Ordered parity gaps, most severe first (critical → low), then by area. */
  gaps: ProjectStructureGap[];
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const TOP_LIMIT = 20;
const LARGEST_LIMIT = 10;

/** Project size above which navigation/search performance becomes a real risk. */
export const LARGE_PROJECT_THRESHOLDS: LargeProjectThresholds = {
  programs: 100,
  routines: 500,
  modules: 50,
};

/**
 * Vendor process-library naming prefixes, most specific first so a
 * name is attributed to a single, most-meaningful prefix. `P_` is intentionally
 * last because it is the broadest legacy process-library convention.
 */
const PROCESS_PREFIXES: readonly string[] = [
  "raC_",
  "raP_",
  "PVLV",
  "PINTLK",
  "PPERM",
  "PPID",
  "PAI",
  "PDI",
  "P_",
];

const SEVERITY_RANK: Record<GapSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function increment(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

/** Sort a tally map into rows, descending by count then ascending by key, top N. */
function topRows(map: Map<string, number>, limit = Infinity): CountRow[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

/** Read a routine's ladder rung array without depending on @esco/ladder. */
function rungCountOf(routine: Routine): number {
  const ladder = routine.ladder as { rungs?: unknown } | undefined;
  return ladder && Array.isArray(ladder.rungs) ? ladder.rungs.length : 0;
}

function aoiRoutineCount(aoi: AddOnInstruction): number {
  if (aoi.routines && aoi.routines.length > 0) return aoi.routines.length;
  return aoi.routineNames?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Signal detection
// ---------------------------------------------------------------------------

function matchProcessPrefix(name: string): string | undefined {
  for (const prefix of PROCESS_PREFIXES) {
    if (name.toLowerCase().startsWith(prefix.toLowerCase())) return prefix;
  }
  return undefined;
}

const PID_PATTERN = /^(PID|PIDE|P_PIDE|PPID)$/i;
const PHASE_PATTERN = /phase/i;
const ALARM_TYPE_PATTERN = /^ALARM(_ANALOG|_DIGITAL)?$/i;
const ALARM_NAME_PATTERN = /alarm/i;

/**
 * Detect vendor process-library usage across AOI names, UDT names, and the
 * distinct data types referenced by tags. Returns per-prefix counts, a few sample
 * names, and PID / equipment-phase flags.
 */
function detectProcessSignals(
  aoiNames: string[],
  udtNames: string[],
  tagDataTypes: Set<string>,
): ProcessSignals {
  const prefixCounts = new Map<string, number>();
  const sampleNames: string[] = [];
  let pid = false;
  let phase = false;

  const consider = (name: string): void => {
    if (!name) return;
    const prefix = matchProcessPrefix(name);
    if (prefix) {
      increment(prefixCounts, prefix);
      if (sampleNames.length < 8 && !sampleNames.includes(name)) sampleNames.push(name);
    }
    if (PID_PATTERN.test(name) || /pid/i.test(name)) pid = true;
    if (PHASE_PATTERN.test(name)) phase = true;
  };

  for (const name of aoiNames) consider(name);
  for (const name of udtNames) consider(name);
  for (const type of tagDataTypes) consider(type);

  sampleNames.sort((a, b) => a.localeCompare(b));
  const matchedPrefixes = topRows(prefixCounts);
  return {
    plantPax: matchedPrefixes.length > 0,
    matchedPrefixes,
    sampleNames,
    pid,
    phase,
  };
}

const POWERFLEX_PATTERN = /powerflex|\bPF7\d\d\b|\b75[35]\b|\b25[0-9A-Z]-/i;
const FLEX5094_PATTERN = /5094|flex\s?5000|flex\s?i\/?o/i;
const HART_PATTERN = /hart|I[FO]\d+I?H\b/i;
const BRIDGE_PATTERN = /\bEN[0-9]?(?:TR|T|F|BT|BR|TP|TSC|TXT)\b|EN2T|EN3TR|EN4TR|ENBT/i;

/** Detect drive / specialty-module signals from I/O module catalog/description. */
function detectModuleSignals(modules: readonly IoModule[]): ModuleSignals {
  let powerFlex = false;
  let flex5094 = false;
  let hart = false;
  let bridge = false;
  const matched = new Map<string, number>();

  for (const module of modules) {
    const haystack = [module.catalogNumber, module.productType, module.description, module.vendor]
      .filter((part): part is string => Boolean(part))
      .join(" ");
    if (!haystack) continue;
    const catalog = module.catalogNumber ?? haystack;
    if (POWERFLEX_PATTERN.test(haystack)) {
      powerFlex = true;
      increment(matched, `AC drive: ${catalog}`);
    }
    if (FLEX5094_PATTERN.test(haystack)) {
      flex5094 = true;
      increment(matched, `Distributed I/O: ${catalog}`);
    }
    if (HART_PATTERN.test(haystack)) {
      hart = true;
      increment(matched, `Process instrumentation I/O: ${catalog}`);
    }
    if (BRIDGE_PATTERN.test(haystack)) {
      bridge = true;
      increment(matched, `Network bridge: ${catalog}`);
    }
  }

  return { powerFlex, flex5094, hart, bridge, matched: topRows(matched) };
}

/** Leading bulletin/family token of a catalog number, e.g. "1756-L83E" → "1756". */
function catalogFamily(catalog: string): string {
  const trimmed = catalog.trim();
  const dash = trimmed.indexOf("-");
  const token = dash > 0 ? trimmed.slice(0, dash) : trimmed;
  return token || trimmed;
}

// ---------------------------------------------------------------------------
// Aggregation passes
// ---------------------------------------------------------------------------

function countTasks(controllers: readonly Controller[]): {
  total: number;
  byType: Record<TaskType, number>;
} {
  const byType: Record<TaskType, number> = { continuous: 0, periodic: 0, event: 0 };
  let total = 0;
  for (const controller of controllers) {
    for (const task of controller.tasks) {
      byType[task.type] = (byType[task.type] ?? 0) + 1;
      total += 1;
    }
  }
  return { total, byType };
}

function countRoutines(controllers: readonly Controller[]): {
  total: number;
  byLanguage: Record<RoutineLanguage, number>;
  rungCount: number;
} {
  const byLanguage: Record<RoutineLanguage, number> = {
    ladder: 0,
    "structured-text": 0,
    "function-block": 0,
    sfc: 0,
  };
  let total = 0;
  let rungCount = 0;
  for (const controller of controllers) {
    for (const program of controller.programs) {
      for (const routine of program.routines) {
        byLanguage[routine.language] = (byLanguage[routine.language] ?? 0) + 1;
        total += 1;
        rungCount += rungCountOf(routine);
      }
    }
  }
  return { total, byLanguage, rungCount };
}

function countFbdRoutines(controllers: readonly Controller[]): FbdStructureReview {
  const blockTypes = new Map<string, number>();
  const unknownElements = new Map<string, number>();
  const routines: FbdStructureRoutineRow[] = [];
  let programRoutineCount = 0;
  let aoiRoutineCount = 0;
  let parseableRoutineCount = 0;
  let preservedOnlyRoutineCount = 0;
  let sheetCount = 0;
  let blockCount = 0;
  let inputRefCount = 0;
  let outputRefCount = 0;
  let wireCount = 0;
  let connectedWireCount = 0;
  let wireEndpointGapCount = 0;
  let unresolvedWireEndpointCount = 0;
  let duplicateElementIdCount = 0;
  let missingBlockTypeCount = 0;
  let missingRefOperandCount = 0;
  let parameterCount = 0;
  let inputParameterCount = 0;
  let outputParameterCount = 0;
  let inOutParameterCount = 0;
  let unknownParameterCount = 0;
  let missingParameterNameCount = 0;
  let diagnosticCount = 0;
  let diagnosticWarningCount = 0;
  let textCount = 0;
  let unknownElementCount = 0;
  let boundary =
    "Function Block Diagram is preserved for offline review only. ESCO does not execute FBD sheets or perform physical-controller online edits.";

  const record = (
    controllerName: string,
    routine: Routine,
    sourceKind: "program" | "aoi",
    ownerName: string,
  ): void => {
    if (routine.language !== "function-block") return;
    const review = reviewFbdRoutineSource(routine.sourceText ?? "");
    boundary = review.boundary;
    if (sourceKind === "program") programRoutineCount += 1;
    else aoiRoutineCount += 1;
    if (review.parseable) parseableRoutineCount += 1;
    else preservedOnlyRoutineCount += 1;

    sheetCount += review.summary.sheetCount;
    blockCount += review.summary.blockCount;
    inputRefCount += review.summary.inputRefCount;
    outputRefCount += review.summary.outputRefCount;
    wireCount += review.summary.wireCount;
    connectedWireCount += review.summary.connectedWireCount;
    wireEndpointGapCount += review.summary.wireEndpointGapCount;
    unresolvedWireEndpointCount += review.summary.unresolvedWireEndpointCount;
    duplicateElementIdCount += review.summary.duplicateElementIdCount;
    missingBlockTypeCount += review.summary.missingBlockTypeCount;
    missingRefOperandCount += review.summary.missingRefOperandCount;
    parameterCount += review.summary.parameterCount;
    inputParameterCount += review.summary.inputParameterCount;
    outputParameterCount += review.summary.outputParameterCount;
    inOutParameterCount += review.summary.inOutParameterCount;
    unknownParameterCount += review.summary.unknownParameterCount;
    missingParameterNameCount += review.summary.missingParameterNameCount;
    diagnosticCount += review.summary.diagnosticCount;
    diagnosticWarningCount += review.summary.diagnosticWarningCount;
    textCount += review.summary.textCount;
    unknownElementCount += review.summary.unknownElementCount;
    for (const row of review.summary.blockTypes) increment(blockTypes, row.name, row.count);
    for (const row of review.summary.unknownElementNames) increment(unknownElements, row.name, row.count);

    routines.push({
      controllerName,
      sourceKind,
      ...(sourceKind === "program" ? { programName: ownerName } : { aoiName: ownerName }),
      routineName: routine.name,
      parseable: review.parseable,
      sheetCount: review.summary.sheetCount,
      blockCount: review.summary.blockCount,
      inputRefCount: review.summary.inputRefCount,
      outputRefCount: review.summary.outputRefCount,
      wireCount: review.summary.wireCount,
      connectedWireCount: review.summary.connectedWireCount,
      wireEndpointGapCount: review.summary.wireEndpointGapCount,
      unresolvedWireEndpointCount: review.summary.unresolvedWireEndpointCount,
      duplicateElementIdCount: review.summary.duplicateElementIdCount,
      missingBlockTypeCount: review.summary.missingBlockTypeCount,
      missingRefOperandCount: review.summary.missingRefOperandCount,
      parameterCount: review.summary.parameterCount,
      inputParameterCount: review.summary.inputParameterCount,
      outputParameterCount: review.summary.outputParameterCount,
      inOutParameterCount: review.summary.inOutParameterCount,
      unknownParameterCount: review.summary.unknownParameterCount,
      missingParameterNameCount: review.summary.missingParameterNameCount,
      diagnosticCount: review.summary.diagnosticCount,
      diagnosticWarningCount: review.summary.diagnosticWarningCount,
      textCount: review.summary.textCount,
      unknownElementCount: review.summary.unknownElementCount,
      topBlockTypes: review.summary.blockTypes.map((row) => ({ key: row.name, count: row.count })),
      unknownElements: review.summary.unknownElementNames.map((row) => ({ key: row.name, count: row.count })),
      warnings: review.warnings.slice(0, 4),
    });
  };

  for (const controller of controllers) {
    for (const program of controller.programs) {
      for (const routine of program.routines) {
        record(controller.name, routine, "program", program.name);
      }
    }
    for (const aoi of controller.addOnInstructions) {
      for (const routine of aoi.routines ?? []) {
        record(controller.name, routine, "aoi", aoi.name);
      }
    }
  }

  routines.sort(
    (a, b) =>
      Number(!b.parseable) - Number(!a.parseable) ||
      b.unknownElementCount - a.unknownElementCount ||
      b.wireEndpointGapCount - a.wireEndpointGapCount ||
      a.controllerName.localeCompare(b.controllerName) ||
      (a.programName ?? a.aoiName ?? "").localeCompare(b.programName ?? b.aoiName ?? "") ||
      a.routineName.localeCompare(b.routineName),
  );

  return {
    routineCount: programRoutineCount + aoiRoutineCount,
    programRoutineCount,
    aoiRoutineCount,
    parseableRoutineCount,
    preservedOnlyRoutineCount,
    sheetCount,
    blockCount,
    inputRefCount,
    outputRefCount,
    wireCount,
    connectedWireCount,
    wireEndpointGapCount,
    unresolvedWireEndpointCount,
    duplicateElementIdCount,
    missingBlockTypeCount,
    missingRefOperandCount,
    parameterCount,
    inputParameterCount,
    outputParameterCount,
    inOutParameterCount,
    unknownParameterCount,
    missingParameterNameCount,
    diagnosticCount,
    diagnosticWarningCount,
    textCount,
    unknownElementCount,
    topBlockTypes: topRows(blockTypes, 8),
    unknownElements: topRows(unknownElements, 8),
    routines,
    boundary,
  };
}

function collectTags(controllers: readonly Controller[]): {
  controller: number;
  program: number;
  dataTypeCounts: Map<string, number>;
  dataTypes: Set<string>;
} {
  let controllerCount = 0;
  let programCount = 0;
  const dataTypeCounts = new Map<string, number>();
  const dataTypes = new Set<string>();
  const note = (tag: Tag): void => {
    increment(dataTypeCounts, tag.dataType);
    dataTypes.add(tag.dataType);
  };
  for (const controller of controllers) {
    for (const tag of controller.controllerTags) {
      controllerCount += 1;
      note(tag);
    }
    for (const program of controller.programs) {
      for (const tag of program.programTags) {
        programCount += 1;
        note(tag);
      }
    }
  }
  return { controller: controllerCount, program: programCount, dataTypeCounts, dataTypes };
}

function largestUdts(udts: readonly UserDefinedType[]): UdtSizeRow[] {
  return udts
    .map((udt) => ({ name: udt.name, memberCount: udt.members.length }))
    .sort((a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name))
    .slice(0, LARGEST_LIMIT);
}

function largestAois(aois: readonly AddOnInstruction[]): AoiSizeRow[] {
  return aois
    .map((aoi) => {
      const parameterCount = aoi.parameters.length;
      const localTagCount = aoi.localTags.length;
      const routineCount = aoiRoutineCount(aoi);
      return {
        name: aoi.name,
        parameterCount,
        localTagCount,
        routineCount,
        weight: parameterCount + localTagCount + routineCount,
        protected: Boolean(aoi.protected),
      };
    })
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
    .slice(0, LARGEST_LIMIT);
}

function collectIo(controllers: readonly Controller[]): ProjectStructureAnalysisReport["io"] & {
  modules: IoModule[];
} {
  const modules: IoModule[] = [];
  const catalogCounts = new Map<string, number>();
  const vendorCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  let portCount = 0;
  let connectionCount = 0;

  for (const controller of controllers) {
    for (const module of controller.ioConfiguration.modules) {
      modules.push(module);
      if (module.catalogNumber) {
        increment(catalogCounts, module.catalogNumber);
        increment(familyCounts, catalogFamily(module.catalogNumber));
      }
      if (module.vendor) increment(vendorCounts, module.vendor);
      portCount += module.ports?.length ?? 0;
      connectionCount += module.connections?.length ?? 0;
    }
  }

  return {
    modules,
    moduleCount: modules.length,
    topCatalogNumbers: topRows(catalogCounts, TOP_LIMIT),
    vendorCounts: topRows(vendorCounts),
    familyCounts: topRows(familyCounts),
    portCount,
    connectionCount,
  };
}

function controllerMetadata(
  controllers: readonly Controller[],
  alarmDefinitions: boolean,
): ControllerMetadataPresence {
  const any = (predicate: (controller: Controller) => boolean): boolean =>
    controllers.some(predicate);
  return {
    redundancyInfo: any((c) => Boolean(c.redundancyInfo)),
    safetyInfo: any((c) => Boolean(c.safetyInfo)),
    security: any((c) => Boolean(c.security)),
    wallClockTime: any((c) => Boolean(c.wallClockTime)),
    timeSync: any((c) => Boolean(c.timeSync)),
    cst: any((c) => Boolean(c.cst)),
    ethernetConfig: any((c) => Boolean(c.ethernetConfig)),
    alarmDefinitions,
  };
}

// ---------------------------------------------------------------------------
// Gap classification
// ---------------------------------------------------------------------------

function classifyGaps(report: Omit<ProjectStructureAnalysisReport, "gaps">): ProjectStructureGap[] {
  const gaps: ProjectStructureGap[] = [];
  const { routineCountByLanguage: lang, routineCount, processSignals, moduleSignals } = report;

  // 1 — Function Block Diagram usage. ESCO preserves FBD read-only only.
  const fbd = report.fbd.routineCount;
  if (fbd > 0) {
    const fraction = routineCount > 0 ? lang["function-block"] / routineCount : 0;
    const severity: GapSeverity = fbd >= 100 || fraction >= 0.25 ? "critical" : fbd >= 20 ? "high" : "medium";
    const topBlocks = report.fbd.topBlockTypes
      .slice(0, 4)
      .map((row) => `${row.key} x${row.count}`)
      .join(", ");
    const unknowns = report.fbd.unknownElementCount
      ? `; ${report.fbd.unknownElementCount} preserved unknown element(s) (${report.fbd.unknownElements
          .slice(0, 3)
          .map((row) => `${row.key} x${row.count}`)
          .join(", ")})`
      : "";
    const diagnostics = report.fbd.diagnosticWarningCount
      ? ` Semantic review warnings: ${report.fbd.diagnosticWarningCount} (${report.fbd.unresolvedWireEndpointCount} unresolved wire endpoint(s), ${report.fbd.duplicateElementIdCount} duplicate id occurrence(s), ${report.fbd.missingRefOperandCount} reference operand gap(s), ${report.fbd.missingBlockTypeCount} missing block type(s), ${report.fbd.missingParameterNameCount} unnamed parameter(s)).`
      : " Semantic review warnings: 0.";
    gaps.push({
      area: "Function Block Diagram (FBD)",
      severity,
      evidence:
        `${fbd} FBD routine(s): ${report.fbd.programRoutineCount} program routine(s), ` +
        `${report.fbd.aoiRoutineCount} AOI routine(s); ${report.fbd.parseableRoutineCount} parseable for offline review, ` +
        `${report.fbd.preservedOnlyRoutineCount} preserved-only; ${report.fbd.sheetCount} sheet(s), ` +
        `${report.fbd.blockCount} block(s), ${report.fbd.parameterCount} block parameter/pin row(s), ${report.fbd.wireCount} wire(s). ` +
        `Prominent block types: ${topBlocks || "none imported"}${unknowns}.${diagnostics}`,
      currentEscoSupport:
        "FBD routines are imported and preserved read-only. ESCO parses preserved FBD XML for offline sheet/block/parameter-pin/reference/wire/text/unknown-element review, semantic diagnostics, and project-wide coverage evidence; FBD is never executed or edited.",
      missingForParity:
        "A full-featured offline FBD editor (sheet/wire/pin authoring), semantic block validation, and an offline FBD execution model.",
      recommendedNextStep:
        "Broaden FBD viewer coverage for real-project block/pin/container variants and add semantic validation before any editor/execution work.",
    });
  }

  // 2 — Vendor process-library / process block depth.
  if (processSignals.plantPax) {
    const matched = processSignals.matchedPrefixes.reduce((sum, row) => sum + row.count, 0);
    const severity: GapSeverity = matched >= 20 ? "critical" : "high";
    gaps.push({
      area: "Vendor process library",
      severity,
      evidence: `${matched} vendor process-library object(s) detected across ${processSignals.matchedPrefixes.length} naming group(s).`,
      currentEscoSupport:
        "Vendor process-library AOI and UDT definitions are imported as metadata (parameters, members, local tags).",
      missingForParity:
        "Rich process-library faceplate/block parameter workflows and the process-object runtime behavior behind them.",
      recommendedNextStep:
        "Add a vendor process-library AOI/UDT/block inspector that surfaces process-object parameters and structure.",
    });
  }

  // 3 — Advanced module profiles (drives / I/O / bridges).
  if (moduleSignals.powerFlex || moduleSignals.flex5094 || moduleSignals.hart || moduleSignals.bridge) {
    const kinds = [
      moduleSignals.powerFlex ? "AC drives" : "",
      moduleSignals.flex5094 ? "distributed I/O modules" : "",
      moduleSignals.hart ? "process instrumentation I/O" : "",
      moduleSignals.bridge ? "industrial network bridges" : "",
    ].filter(Boolean);
    const severity: GapSeverity = moduleSignals.powerFlex || moduleSignals.hart ? "high" : "medium";
    gaps.push({
      area: "Advanced module profiles",
      severity,
      evidence: `Specialty modules detected: ${kinds.join(", ")}.`,
      currentEscoSupport:
        "Module identity and connection metadata are imported (catalog, vendor, ports, connections, keying).",
      missingForParity:
        "Full module-profile configuration views and live diagnostics for AC drives, distributed/process I/O, and bridge modules.",
      recommendedNextStep:
        "Add module-profile UI surfacing imported profile metadata by generic module family (AC drive / distributed I/O / process instrumentation / bridge).",
    });
  }

  // 4 — Alarm definitions / process alarms.
  if (report.controllerMetadata.alarmDefinitions) {
    gaps.push({
      area: "Alarm definitions / process alarms",
      severity: "high",
      evidence: "ALARM_ANALOG/ALARM_DIGITAL types or *Alarm* process objects detected.",
      currentEscoSupport:
        "Alarm-bearing tags/types are imported as ordinary tags/UDTs; there is no first-class alarm model.",
      missingForParity:
        "An AlarmDefinitions model and a process-alarm configuration/monitoring UI.",
      recommendedNextStep:
        "Introduce an AlarmDefinitions representation and an alarm summary/configuration view.",
    });
  }

  // 5 — Equipment phases / process / PID.
  if (processSignals.phase || processSignals.pid) {
    const severity: GapSeverity = processSignals.phase ? "high" : "medium";
    const kinds = [processSignals.phase ? "equipment phases" : "", processSignals.pid ? "PID/process loops" : ""].filter(Boolean);
    gaps.push({
      area: "Equipment phases / process / PID",
      severity,
      evidence: `Detected ${kinds.join(" and ")}.`,
      currentEscoSupport:
        "Phase/PID logic is imported as routines/AOIs/tags with dedicated offline process-loop and PhaseManager review inspectors, including PID/PIDE tuning-member review, tuning comparison-readiness, offline process timing previews, and visible PhaseManager state/timing preview evidence.",
      missingForParity:
        "Controller-verified timing, PID/process-loop value comparison/calculation workflows, deeper phase transition validation, and faithful runtime behavior/execution.",
      recommendedNextStep:
        "Add PID tuning comparison/worksheet views and deeper phase transition validation while keeping execution offline/model-only.",
    });
  }

  // 6 — Large-project navigation / performance risk.
  const { thresholds } = report;
  const overProgram = report.programCount >= thresholds.programs;
  const overRoutine = report.routineCount >= thresholds.routines;
  const overModule = report.io.moduleCount >= thresholds.modules;
  if (overProgram || overRoutine || overModule) {
    const severe =
      report.programCount >= thresholds.programs * 2 ||
      report.routineCount >= thresholds.routines * 2 ||
      report.io.moduleCount >= thresholds.modules * 2;
    const reasons = [
      overProgram ? `${report.programCount} programs (≥ ${thresholds.programs})` : "",
      overRoutine ? `${report.routineCount} routines (≥ ${thresholds.routines})` : "",
      overModule ? `${report.io.moduleCount} modules (≥ ${thresholds.modules})` : "",
    ].filter(Boolean);
    gaps.push({
      area: "Large-project navigation / performance",
      severity: severe ? "critical" : "high",
      evidence: `Project exceeds size thresholds: ${reasons.join(", ")}.`,
      currentEscoSupport:
        "The project tree, search, and editors render the full model in-memory without virtualization tuned for this scale.",
      missingForParity:
        "Virtualized navigation, indexed cross-reference/search, and lazy editor loading proven at this project size.",
      recommendedNextStep:
        "Profile tree/search/cross-reference at this scale and add virtualization + an incremental search index.",
    });
  }

  return gaps.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.area.localeCompare(b.area),
  );
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Analyze a project's structure and ESCO parity gaps. Pure and deterministic —
 * never mutates the project, never performs I/O, and always sorts its output the
 * same way. The returned `gaps` array is ordered most-severe first.
 */
export function analyzeProjectStructure(project: PlcProject): ProjectStructureAnalysisReport {
  const controllers = project.controllers;

  const taskStats = countTasks(controllers);
  const routineStats = countRoutines(controllers);
  const tagStats = collectTags(controllers);
  const fbd = countFbdRoutines(controllers);
  const io = collectIo(controllers);

  const udts = controllers.flatMap((controller) => controller.dataTypes);
  const aois = controllers.flatMap((controller) => controller.addOnInstructions);
  const aoiNames = aois.map((aoi) => aoi.name);
  const udtNames = udts.map((udt) => udt.name);

  const processSignals = detectProcessSignals(aoiNames, udtNames, tagStats.dataTypes);
  const moduleSignals = detectModuleSignals(io.modules);

  // Alarm signals: ALARM_* data types, or *Alarm* AOI/UDT names (e.g. P_Alarm).
  const alarmDefinitions =
    [...tagStats.dataTypes].some((type) => ALARM_TYPE_PATTERN.test(type)) ||
    aoiNames.some((name) => ALARM_NAME_PATTERN.test(name)) ||
    udtNames.some((name) => ALARM_NAME_PATTERN.test(name));

  const routineLanguagesUsed = (Object.keys(routineStats.byLanguage) as RoutineLanguage[])
    .filter((language) => routineStats.byLanguage[language] > 0)
    .sort((a, b) => a.localeCompare(b));

  const trendCount = controllers.reduce((sum, c) => sum + (c.trends?.length ?? 0), 0);
  const quickWatchCount = controllers.reduce((sum, c) => sum + (c.quickWatchLists?.length ?? 0), 0);

  const base: Omit<ProjectStructureAnalysisReport, "gaps"> = {
    projectName: project.name,
    controllerCount: controllers.length,
    taskCount: taskStats.total,
    taskCountByType: taskStats.byType,
    programCount: controllers.reduce((sum, c) => sum + c.programs.length, 0),
    routineCount: routineStats.total,
    routineCountByLanguage: routineStats.byLanguage,
    rungCount: routineStats.rungCount,
    tagCounts: {
      controller: tagStats.controller,
      program: tagStats.program,
      total: tagStats.controller + tagStats.program,
    },
    topTagDataTypes: topRows(tagStats.dataTypeCounts, TOP_LIMIT),
    udt: { count: udts.length, largest: largestUdts(udts) },
    aoi: { count: aois.length, largest: largestAois(aois) },
    fbd,
    io: {
      moduleCount: io.moduleCount,
      topCatalogNumbers: io.topCatalogNumbers,
      vendorCounts: io.vendorCounts,
      familyCounts: io.familyCounts,
      portCount: io.portCount,
      connectionCount: io.connectionCount,
    },
    trendCount,
    quickWatchCount,
    controllerMetadata: controllerMetadata(controllers, alarmDefinitions),
    routineLanguagesUsed,
    processSignals,
    moduleSignals,
    thresholds: LARGE_PROJECT_THRESHOLDS,
  };

  return { ...base, gaps: classifyGaps(base) };
}
