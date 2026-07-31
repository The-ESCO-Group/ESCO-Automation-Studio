import { useEffect, useMemo, useRef, useState } from "react";
import type { PlcProject } from "@esco/core";
import {
  compareDiagnosticSeverity,
  controllerTaskStatusReport,
  createBuildDiagnostics,
  createDiagnosticRows,
  summarizeValidationFindings,
  taskScanKey,
  verifyControllerTasks,
  verifyProjectReport,
  type EscoArtifactValidationSummary,
  type ControllerTaskStatusRow,
  type DiagnosticArea,
  type EscoPackageManifestEntry,
  type InterchangeAuditReport,
  type RuntimeBuildSummary,
  type TaskScanStats,
} from "@esco/project-actions";
import type { ValidationFinding } from "@esco/validator";
import type { Studio5000HandoffReadiness } from "@esco/ai-assistant";
import type { Forces, TrendSample, WatchRow } from "../simulation";
import type { ControllerSessionApi } from "../controller-session";
import type { VirtualControllerApi } from "../virtual-controller-session";
import type { SearchHit } from "../search";
import { ControllerPanel } from "./ControllerPanel";
import { CrossRefPanel } from "./CrossRefPanel";
import { ModelSummaryPanel } from "./ModelSummaryPanel";

export type DockTab =
  | "diagnostics"
  | "controller"
  | "model"
  | "search"
  | "references"
  | "build"
  | "handoff"
  | "tasks"
  | "watch"
  | "trend"
  | "forces";

type DiagnosticSeverityFilter = "all" | ValidationFinding["severity"];
type DiagnosticAreaFilter = "all" | DiagnosticArea;

export interface RuntimeBuildPreview {
  projectName: string;
  fileName: string;
  checksum: string;
  builtAt: string;
  runtimeVersion: string;
  summary: RuntimeBuildSummary;
  warnings: string[];
}

export interface PackageBuildPreview {
  projectName: string;
  fileName: string;
  packageChecksum: string;
  entryCount: number;
  embeddedArtifactCount: number;
  entries: EscoPackageManifestEntry[];
  warnings: string[];
}

export interface ArtifactValidationPreview {
  fileName: string;
  validatedAt: string;
  ok: boolean;
  summary?: EscoArtifactValidationSummary;
  checksum?: { expected: string; actual: string; valid: boolean };
  errors: string[];
}

export interface InterchangeAuditPreview {
  fileName: string;
  generatedAt: string;
  report: InterchangeAuditReport;
  textReceipt: string;
}

interface Props {
  tab: DockTab;
  openKey?: number;
  onTabChange: (tab: DockTab) => void;
  empty?: boolean;
  findings: ValidationFinding[];
  tags: WatchRow[];
  running: boolean;
  onToggleTag: (name: string) => void;
  onSetNumber: (name: string, value: number) => void;
  onSetString: (name: string, value: string) => void;
  onScanOnce: () => void;
  onTriggerEventTask?: (taskKey: string) => void;
  onReset: () => void;
  onToggleRun: () => void;
  taskScanStats: TaskScanStats;
  onResetTaskStats: () => void;
  forces: Forces;
  onToggleForce: (name: string) => void;
  onClearForces: () => void;
  trendSamples: TrendSample[];
  scanIntervalMs: number;
  onClearTrend: () => void;
  onVerify: (source?: DockTab) => void;
  runtimeBuildPreview?: RuntimeBuildPreview | null;
  packageBuildPreview?: PackageBuildPreview | null;
  artifactValidationPreview?: ArtifactValidationPreview | null;
  interchangeAuditPreview?: InterchangeAuditPreview | null;
  handoffReadiness?: Studio5000HandoffReadiness | null;
  onImportL5X?: () => void;
  onExportL5X?: () => void;
  onExportRuntime?: () => void;
  onExportPackage?: () => void;
  onDownloadRuntimeToSoftController?: () => void;
  controller: ControllerSessionApi;
  onControllerToast: (kind: "info" | "success" | "warning" | "error", message: string) => void;
  /** The ESCO Virtual Controller session (offline/virtual workflow). */
  virtualController?: VirtualControllerApi;
  /** Load an uploaded virtual-controller project image for inspection. */
  onLoadUploadedImage?: (payload: string) => void;
  project: PlcProject;
  selectedTagName?: string;
  selectedTagPath?: string;
  selectedRoutineId?: string;
  selectedRoutineName?: string;
  onOpenRoutine: (routineId: string) => void;
  onOpenDiagnosticTarget?: (finding: ValidationFinding) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onReplaceAll?: (replacement: string) => void;
  onFindNext?: () => void;
  onFindPrevious?: () => void;
  searchHits?: SearchHit[];
  activeSearchIndex?: number;
  onOpenSearchHit?: (hit: SearchHit) => void;
  onWatchTag?: (tagName: string) => void;
  onCrossReferenceTag?: (tagName: string) => void;
  onForceTag?: (tagName: string) => void;
}

/** The Value-column content for one watched tag, by kind. */
function WatchValue({
  row,
  forced,
  onToggleTag,
  onSetNumber,
  onSetString,
}: {
  row: WatchRow;
  forced: boolean;
  onToggleTag: (name: string) => void;
  onSetNumber: (name: string, value: number) => void;
  onSetString: (name: string, value: string) => void;
}) {
  const forcedMark = forced ? <span className="esco-watch__forced" title="Forced value">⏚</span> : null;
  if (row.kind === "struct") {
    return (
      <span className="esco-watch__members">
        {row.members?.map((member) => (
          <span
            key={member.name}
            className={`esco-watch__member${member.value === true ? " is-on" : ""}`}
          >
            {member.name}=
            {member.type === "BOOL" ? (member.value ? "true" : "false") : String(member.value)}
          </span>
        ))}
      </span>
    );
  }

  if (row.kind === "number") {
    if (row.role === "input") {
      return (
        <span className="esco-watch__bool">
          <input
            className="esco-watch__number"
            type="number"
            value={Number(row.value ?? 0)}
            onChange={(event) => onSetNumber(row.name, Number(event.target.value) || 0)}
          />
          {forcedMark}
        </span>
      );
    }
    return (
      <span className="esco-watch__bool">
        <span className="esco-watch__value">{String(row.value ?? 0)}</span>
        {forcedMark}
      </span>
    );
  }

  if (row.kind === "string") {
    if (row.role === "input") {
      return (
        <span className="esco-watch__bool">
          <input
            className="esco-watch__number"
            type="text"
            value={String(row.value ?? "")}
            onChange={(event) => onSetString(row.name, event.target.value)}
          />
          {forcedMark}
        </span>
      );
    }
    return (
      <span className="esco-watch__bool">
        <span className="esco-watch__value">{String(row.value ?? "")}</span>
        {forcedMark}
      </span>
    );
  }

  // BOOL
  const on = row.value === true;
  return (
    <span className="esco-watch__bool">
      <span className={`esco-watch__value${on ? " is-on" : ""}`}>{on ? "true" : "false"}</span>
      {forcedMark}
      {row.role === "input" ? (
        <button
          type="button"
          className={`esco-btn esco-btn--toggle${on ? " is-on" : ""}`}
          onClick={() => onToggleTag(row.name)}
        >
          Toggle
        </button>
      ) : null}
    </span>
  );
}

function formatTrendValue(value: TrendSample["values"][string] | undefined): string {
  if (value == null) return "-";
  return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
}

function trendStats(samples: TrendSample[], tagName: string) {
  const values = samples.map((sample) => sample.values[tagName]).filter((value) => value != null);
  const latest = values[values.length - 1];
  const numeric = values.every((value) => typeof value === "number");
  let changes = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] !== values[i - 1]) changes += 1;
  }
  if (numeric) {
    const nums = values as number[];
    return {
      latest: formatTrendValue(latest),
      min: nums.length ? String(Math.min(...nums)) : "-",
      max: nums.length ? String(Math.max(...nums)) : "-",
      changes,
    };
  }
  return { latest: formatTrendValue(latest), min: "-", max: "-", changes };
}

function formatMonitorTime(value?: string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleTimeString();
}

function formatBuildTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function shortChecksum(value: string): string {
  return value ? `${value.slice(0, 16)}...` : "pending";
}

function formatArtifactValidationType(summary: EscoArtifactValidationSummary | undefined): string {
  if (!summary) return "Rejected artifact";
  switch (summary.validationType) {
    case "package":
      return "ESCO package";
    case "runtime":
      return "ESCO Runtime";
    case "component":
      return "ESCO component";
    case "controller-assets":
      return "ESCO controller assets";
    case "native-envelope":
      return "ESCO-native file";
    default:
      return summary.kind;
  }
}

function artifactValidationStatus(preview: ArtifactValidationPreview): string {
  if (!preview.ok) return "Failed";
  const checksumValid = preview.summary?.packageChecksumValid ?? preview.summary?.checksumValid ?? preview.checksum?.valid;
  if (checksumValid === false) return "Warnings";
  return "Passed";
}

function taskRowKey(row: ControllerTaskStatusRow): string {
  return [row.controllerId, row.taskId ?? row.source, row.programId ?? "", row.routineId ?? ""].join(":");
}

function taskReportSignature(rows: ControllerTaskStatusRow[]): string {
  return rows
    .map((row) => [
      taskRowKey(row),
      row.status,
      row.scanEligible ? "eligible" : "blocked",
      row.watchdogMs ?? "",
      row.disableUpdateOutputs === true ? "outputs-off" : "",
    ].join("="))
    .join("|");
}

function describeTaskReportChange(previous: ControllerTaskStatusRow[], next: ControllerTaskStatusRow[]): string | null {
  const previousRows = new Map(previous.map((row) => [taskRowKey(row), row]));
  let added = 0;
  let removed = 0;
  let eligibility = 0;
  let watchdog = 0;
  let status = 0;

  for (const row of next) {
    const before = previousRows.get(taskRowKey(row));
    if (!before) {
      added += 1;
      continue;
    }
    previousRows.delete(taskRowKey(row));
    if (before.scanEligible !== row.scanEligible) eligibility += 1;
    if (before.watchdogMs !== row.watchdogMs) watchdog += 1;
    if (before.status !== row.status) status += 1;
  }
  removed = previousRows.size;

  const parts = [
    added ? `${added} added` : "",
    removed ? `${removed} removed` : "",
    eligibility ? `${eligibility} eligibility` : "",
    watchdog ? `${watchdog} watchdog` : "",
    status ? `${status} status` : "",
  ].filter(Boolean);
  return parts.length ? `Changed: ${parts.join(", ")}.` : null;
}

export function BottomPanel({
  tab,
  openKey = 0,
  onTabChange,
  empty = false,
  findings,
  tags,
  running,
  onToggleTag,
  onSetNumber,
  onSetString,
  onScanOnce,
  onTriggerEventTask,
  onReset,
  onToggleRun,
  taskScanStats,
  onResetTaskStats,
  forces,
  onToggleForce,
  onClearForces,
  trendSamples,
  scanIntervalMs,
  onClearTrend,
  onVerify,
  runtimeBuildPreview,
  packageBuildPreview,
  artifactValidationPreview,
  interchangeAuditPreview,
  handoffReadiness,
  onImportL5X,
  onExportL5X,
  onExportRuntime,
  onExportPackage,
  onDownloadRuntimeToSoftController,
  controller,
  onControllerToast,
  virtualController,
  onLoadUploadedImage,
  project,
  selectedTagName,
  selectedTagPath,
  selectedRoutineId,
  selectedRoutineName,
  onOpenRoutine,
  onOpenDiagnosticTarget,
  searchQuery = "",
  onSearchChange,
  onReplaceAll,
  onFindNext,
  onFindPrevious,
  searchHits = [],
  activeSearchIndex = -1,
  onOpenSearchHit,
  onWatchTag,
  onCrossReferenceTag,
  onForceTag,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [outputCleared, setOutputCleared] = useState(false);
  const [lastVerifyAt, setLastVerifyAt] = useState<string | null>(null);
  const [replacementText, setReplacementText] = useState("");
  const [taskMonitor, setTaskMonitor] = useState({
    scanCount: 0,
    lastScanAt: null as string | null,
    lastResetAt: null as string | null,
    lastVerifyAt: null as string | null,
    lastAction: "Ready.",
    scheduleChange: "Waiting for task schedule.",
  });
  const [taskVerifyVisible, setTaskVerifyVisible] = useState(false);
  const [diagnosticSeverityFilter, setDiagnosticSeverityFilter] = useState<DiagnosticSeverityFilter>("all");
  const [diagnosticAreaFilter, setDiagnosticAreaFilter] = useState<DiagnosticAreaFilter>("all");
  const previousTab = useRef(tab);
  const previousTaskRows = useRef<ControllerTaskStatusRow[] | null>(null);
  const previousTrendSampleCount = useRef(trendSamples.length);
  useEffect(() => {
    if (previousTab.current !== tab) {
      setExpanded(true);
      previousTab.current = tab;
    }
  }, [tab]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // When the dock is opened straight onto Search Results (e.g. via Ctrl+F), drop
  // the cursor into the find box. The input only exists while expanded, so if we
  // had to expand first, defer the focus to the follow-up effect below.
  const pendingSearchFocus = useRef(false);
  useEffect(() => {
    if (openKey > 0) setExpanded(true);
    if (openKey > 0 && (tab === "diagnostics" || tab === "build")) {
      setOutputCleared(false);
      setLastVerifyAt(new Date().toLocaleTimeString());
    }
    if (openKey > 0 && tab === "search") {
      if (expanded) searchInputRef.current?.focus();
      else pendingSearchFocus.current = true;
    }
    // `expanded` is intentionally omitted: a fresh openKey is what should focus,
    // not an unrelated expand/collapse toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, tab]);
  useEffect(() => {
    if (pendingSearchFocus.current && expanded && tab === "search") {
      searchInputRef.current?.focus();
      pendingSearchFocus.current = false;
    }
  }, [expanded, tab]);
  const setTab = (next: DockTab) => {
    if (next === tab) {
      setExpanded(true);
      return;
    }
    onTabChange(next);
    setExpanded(true);
  };
  const forceCount = Object.keys(forces).length;
  const forcedRows = tags.filter((row) => row.name in forces);
  const selectedTagKey = (selectedTagPath ?? selectedTagName ?? "").trim().toLowerCase();
  const selectedWatchRow = selectedTagKey
    ? tags.find((row) => row.name.toLowerCase() === selectedTagKey)
    : undefined;
  const selectedForceableRow =
    selectedWatchRow && selectedWatchRow.kind !== "struct" ? selectedWatchRow : undefined;
  const taskReport = useMemo(() => controllerTaskStatusReport(project), [project]);
  const taskVerification = useMemo(() => verifyControllerTasks(project), [project]);
  const taskSignature = taskReportSignature(taskReport.rows);
  useEffect(() => {
    const previous = previousTaskRows.current;
    if (!previous) {
      setTaskMonitor((state) => ({
        ...state,
        scheduleChange: `Loaded ${taskReport.scanEligibleCount} eligible, ${taskReport.blockedCount} blocked.`,
      }));
    } else {
      const change = describeTaskReportChange(previous, taskReport.rows);
      if (change) setTaskMonitor((state) => ({ ...state, scheduleChange: change }));
    }
    previousTaskRows.current = taskReport.rows;
  }, [taskSignature, taskReport.rows, taskReport.scanEligibleCount, taskReport.blockedCount]);
  useEffect(() => {
    const previous = previousTrendSampleCount.current;
    const current = trendSamples.length;
    if (current > previous) {
      const added = current - previous;
      const latest = trendSamples[current - 1]?.at ?? new Date().toISOString();
      setTaskMonitor((state) => ({
        ...state,
        scanCount: state.scanCount + added,
        lastScanAt: latest,
        lastAction: `${running ? "Offline scan" : "Scan Once"} captured ${added} cycle${added === 1 ? "" : "s"}.`,
      }));
    }
    previousTrendSampleCount.current = current;
  }, [trendSamples, running]);
  const allDiagnosticRows = outputCleared
    ? []
    : createDiagnosticRows(project, findings, { includeIndustrialValidation: true });
  const diagnosticRows = allDiagnosticRows
    .filter((row) => {
      const severityMatches =
        diagnosticSeverityFilter === "all" || row.finding.severity === diagnosticSeverityFilter;
      const areaMatches = diagnosticAreaFilter === "all" || row.area === diagnosticAreaFilter;
      return severityMatches && areaMatches;
    })
    // Read errors-first, then warnings, then info — stable within each severity.
    .sort((a, b) => compareDiagnosticSeverity(a.finding.severity, b.finding.severity));
  const visibleFindings = diagnosticRows.map((row) => row.finding);
  const summary = summarizeValidationFindings(visibleFindings);
  const unfilteredSummary = summarizeValidationFindings(allDiagnosticRows.map((row) => row.finding));
  const liveSummary = summarizeValidationFindings(
    createDiagnosticRows(project, findings, { includeIndustrialValidation: true }).map((row) => row.finding),
  );
  const diagnosticAreaOptions = Array.from(new Set(allDiagnosticRows.map((row) => row.area))).sort();
  const diagnosticFiltersActive = diagnosticSeverityFilter !== "all" || diagnosticAreaFilter !== "all";
  const errorCount = summary.errors;
  const warningCount = summary.warnings;
  const messageCount = summary.messages;
  const buildSteps = outputCleared ? [] : createBuildDiagnostics(project, findings, { includeIndustrialValidation: true });
  // PLC-style Output-window log: "Verifying controller…", finding lines,
  // and a "Complete - N error(s), M warning(s)" summary. Hidden once the output
  // is cleared, mirroring the build-step table above.
  const verifyLog = outputCleared ? [] : verifyProjectReport(project, findings, { includeIndustrialValidation: true }).log;
  const runVerify = (returnTab: DockTab = "diagnostics") => {
    setOutputCleared(false);
    setLastVerifyAt(new Date().toLocaleTimeString());
    onVerify(returnTab);
    if (returnTab !== "diagnostics") onTabChange(returnTab);
  };
  const runTaskScanOnce = () => {
    setTaskMonitor((state) => ({ ...state, lastAction: "Scan Once requested." }));
    onScanOnce();
  };
  const runEventTaskOnce = (row: ControllerTaskStatusRow) => {
    const key = taskScanKey(row);
    setTaskMonitor((state) => ({ ...state, lastAction: `Triggered event task ${row.taskName}.` }));
    onTriggerEventTask?.(key);
  };
  const toggleTaskRun = () => {
    const now = new Date().toISOString();
    setTaskMonitor((state) => ({
      ...state,
      lastAction: running
        ? "Offline scan stopped."
        : `Offline scan started at ${formatMonitorTime(now)}; interval ${scanIntervalMs} ms.`,
    }));
    onToggleRun();
  };
  const resetTaskStats = () => {
    const now = new Date().toISOString();
    previousTrendSampleCount.current = 0;
    setTaskMonitor((state) => ({
      ...state,
      scanCount: 0,
      lastScanAt: null,
      lastResetAt: now,
      lastAction: "Task stats reset and offline values zeroed.",
    }));
    setTaskVerifyVisible(false);
    onResetTaskStats();
    onReset();
  };
  const runTaskVerify = () => {
    const now = new Date().toISOString();
    setTaskVerifyVisible(true);
    setTaskMonitor((state) => ({
      ...state,
      lastVerifyAt: now,
      lastAction: `Verify Tasks produced ${taskVerification.rows.length} row${taskVerification.rows.length === 1 ? "" : "s"}.`,
    }));
    onVerify("tasks");
  };
  const clearOutput = () => setOutputCleared(true);
  const replaceableSearchCount = searchHits.filter((hit) => hit.replaceable).length;
  const canNavigateSearch = searchQuery.trim().length > 0 && searchHits.length > 0;
  const tagDescriptions = new Map(
    project.controllers
      .flatMap((controller) => [
        ...controller.controllerTags,
        ...controller.programs.flatMap((program) => program.programTags),
      ])
      .map((tag) => [tag.name, tag.description ?? ""]),
  );
  const artifactSummary = artifactValidationPreview?.summary;
  const artifactStatus = artifactValidationPreview ? artifactValidationStatus(artifactValidationPreview) : "Ready";
  const interchangeReport = interchangeAuditPreview?.report;
  const interchangeStatus =
    interchangeReport == null
      ? "Ready"
      : interchangeReport.proprietaryBinaryTouched
        ? "Failed"
        : interchangeReport.changed.length || interchangeReport.dropped.length || interchangeReport.notes.length
          ? "Warnings"
          : "Passed";
  const handoffReadinessStatus =
    handoffReadiness == null
      ? "Ready"
      : handoffReadiness.validation.errors > 0 || !handoffReadiness.ready
        ? "Warnings"
        : "Passed";
  const trendNames = Array.from(
    new Set([
      selectedForceableRow?.name,
      ...tags.filter((row) => row.kind !== "struct").map((row) => row.name),
    ].filter((name): name is string => !!name)),
  ).slice(0, 10);
  const latestTrend = trendSamples[trendSamples.length - 1];
  if (empty) {
    return <div className="esco-dock is-collapsed" aria-hidden="true" />;
  }

  if (!expanded) {
    return <div className="esco-dock is-collapsed" aria-hidden="true" />;
  }

  return (
    <div className="esco-dock is-expanded">
      <div className="esco-dock__tabs">
        <button
          type="button"
          className={`esco-dock__tab${tab === "diagnostics" ? " is-active" : ""}`}
          onClick={() => setTab("diagnostics")}
        >
          Errors
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "controller" ? " is-active" : ""}`}
          onClick={() => setTab("controller")}
        >
          Controller
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "model" ? " is-active" : ""}`}
          onClick={() => setTab("model")}
        >
          Model Summary
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "search" ? " is-active" : ""}`}
          onClick={() => setTab("search")}
        >
          Search Results
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "references" ? " is-active" : ""}`}
          onClick={() => setTab("references")}
        >
          Cross Reference
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "build" ? " is-active" : ""}`}
          onClick={() => setTab("build")}
        >
          Build
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "handoff" ? " is-active" : ""}`}
          onClick={() => setTab("handoff")}
        >
          L5X Handoff
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "tasks" ? " is-active" : ""}`}
          onClick={() => setTab("tasks")}
        >
          Task Monitor
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "watch" ? " is-active" : ""}`}
          onClick={() => setTab("watch")}
        >
          Watch
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "trend" ? " is-active" : ""}`}
          onClick={() => setTab("trend")}
        >
          Trend
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "forces" ? " is-active" : ""}`}
          onClick={() => setTab("forces")}
        >
          Forces
        </button>
        <button
          type="button"
          className="esco-dock__tab esco-dock__tab--collapse"
          onClick={() => setExpanded((value) => !value)}
          title={expanded ? "Collapse dock" : "Expand dock"}
          aria-label={expanded ? "Collapse dock" : "Expand dock"}
        >
          <span aria-hidden="true">{expanded ? "-" : "+"}</span>
        </button>
      </div>

      <div className="esco-dock__body">
        {tab === "diagnostics" ? (
          <div className="esco-diagnostics">
            <div className="esco-diagnostics__summary">
              <button type="button" className="esco-btn" onClick={() => runVerify("diagnostics")}>
                Verify Controller
              </button>
              <button type="button" className="esco-btn" onClick={clearOutput} disabled={outputCleared}>
                Clear Output
              </button>
              <span className="is-error">{errorCount} Errors</span>
              <span className="is-warn">{warningCount} Warnings</span>
              <span className="is-info">{messageCount} Messages</span>
              {diagnosticFiltersActive ? (
                <span>
                  Showing {diagnosticRows.length} of {allDiagnosticRows.length}
                </span>
              ) : null}
              {outputCleared ? (
                <span>Output cleared; live state is {liveSummary.errors} error(s), {liveSummary.warnings} warning(s).</span>
              ) : lastVerifyAt ? (
                <span>Last verify {lastVerifyAt}</span>
              ) : (
                <span>Ready to verify</span>
              )}
            </div>
            <div className="esco-diagnostics__filters" aria-label="Diagnostic filters">
              {(["all", "error", "warning", "info"] as DiagnosticSeverityFilter[]).map((severity) => {
                const count =
                  severity === "all"
                    ? allDiagnosticRows.length
                    : allDiagnosticRows.filter((row) => row.finding.severity === severity).length;
                return (
                  <button
                    key={severity}
                    type="button"
                    className={`esco-diagnostics__filter-chip${diagnosticSeverityFilter === severity ? " is-active" : ""}`}
                    data-testid={`diagnostic-filter-${severity}`}
                    aria-pressed={diagnosticSeverityFilter === severity}
                    disabled={outputCleared}
                    onClick={() => setDiagnosticSeverityFilter(severity)}
                  >
                    {severity === "all" ? "All" : severity} ({count})
                  </button>
                );
              })}
              <span className="esco-diagnostics__filter-divider" />
              <button
                type="button"
                className={`esco-diagnostics__filter-chip${diagnosticAreaFilter === "all" ? " is-active" : ""}`}
                data-testid="diagnostic-area-all"
                aria-pressed={diagnosticAreaFilter === "all"}
                disabled={outputCleared}
                onClick={() => setDiagnosticAreaFilter("all")}
              >
                All areas ({allDiagnosticRows.length})
              </button>
              {diagnosticAreaOptions.map((area) => {
                const count = allDiagnosticRows.filter((row) => row.area === area).length;
                return (
                  <button
                    key={area}
                    type="button"
                    className={`esco-diagnostics__filter-chip${diagnosticAreaFilter === area ? " is-active" : ""}`}
                    data-testid={`diagnostic-area-${area.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    aria-pressed={diagnosticAreaFilter === area}
                    disabled={outputCleared}
                    onClick={() => setDiagnosticAreaFilter(area)}
                  >
                    {area} ({count})
                  </button>
                );
              })}
              {diagnosticFiltersActive ? (
                <button
                  type="button"
                  className="esco-btn esco-btn--quick"
                  data-testid="diagnostic-filter-clear"
                  disabled={outputCleared}
                  onClick={() => {
                    setDiagnosticSeverityFilter("all");
                    setDiagnosticAreaFilter("all");
                  }}
                >
                  Clear filters
                </button>
              ) : null}
              {diagnosticFiltersActive ? (
                <span>
                  Filtered from {unfilteredSummary.errors} error,
                  {" "}{unfilteredSummary.warnings} warning,
                  {" "}{unfilteredSummary.messages} message.
                </span>
              ) : null}
            </div>
            <table className="esco-diagnostics__table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Scope</th>
                  <th>Area</th>
                  <th>Source</th>
                  <th>Code</th>
                  <th>Target</th>
                  <th>Message</th>
                  <th>Recommendation</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {outputCleared ? (
                  <tr className="esco-diagnostics__empty-row">
                    <td colSpan={9}>Output cleared. Run Verify Controller to regenerate diagnostics.</td>
                  </tr>
                ) : diagnosticRows.length === 0 ? (
                  <tr className="esco-diagnostics__empty-row">
                    <td colSpan={9}>
                      {diagnosticFiltersActive
                        ? "No diagnostics match the selected filters."
                        : "Verification passed. No diagnostics to show."}
                    </td>
                  </tr>
                ) : (
                  diagnosticRows.map(({ finding, target, area, scope, source, targetLabel, recommendation }, index) => (
                    <tr key={`${finding.ruleId}-${index}`} className={`esco-finding--${finding.severity}`}>
                      <td className="esco-finding__severity">{finding.severity}</td>
                      <td>{scope}</td>
                      <td>{area}</td>
                      <td>{source}</td>
                      <td>{finding.ruleId}</td>
                      <td title={target.path}>{targetLabel}</td>
                      <td>{finding.message}</td>
                      <td>{recommendation}</td>
                      <td className="esco-diagnostics__actions">
                        {target.openable && onOpenDiagnosticTarget ? (
                          <button
                            type="button"
                            className="esco-btn esco-btn--quick"
                            onClick={() => onOpenDiagnosticTarget(finding)}
                            title={`Open ${target.label}`}
                          >
                            Open
                          </button>
                        ) : null}
                        {target.routineId && !onOpenDiagnosticTarget ? (
                          <button type="button" className="esco-btn esco-btn--quick" onClick={() => onOpenRoutine(target.routineId!)}>
                            Open
                          </button>
                        ) : null}
                        {target.tagName ? (
                          <>
                            <button
                              type="button"
                              className="esco-btn esco-btn--quick"
                              disabled={!onWatchTag}
                              onClick={() => onWatchTag?.(target.tagName!)}
                            >
                              Watch
                            </button>
                            <button
                              type="button"
                              className="esco-btn esco-btn--quick"
                              disabled={!onCrossReferenceTag}
                              onClick={() => onCrossReferenceTag?.(target.tagName!)}
                            >
                              XRef
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : tab === "model" ? (
          <div className="esco-dock__model">
            <ModelSummaryPanel project={project} findings={findings} openRoutineName={selectedRoutineName} />
          </div>
        ) : tab === "controller" ? (
          <ControllerPanel
            project={project}
            controller={controller}
            onToast={onControllerToast}
            virtual={virtualController}
            onLoadUploaded={onLoadUploadedImage}
          />
        ) : tab === "search" ? (
          <div className="esco-search">
            <div className="esco-search__bar">
              <input
                ref={searchInputRef}
                className="esco-ai__input esco-search__input"
                type="search"
                value={searchQuery}
                placeholder="Find tags, routines, rung text, HMI screens, bindings, alarms…"
                onChange={(event) => onSearchChange?.(event.target.value)}
              />
              <input
                className="esco-ai__input esco-search__input esco-search__input--replace"
                type="text"
                value={replacementText}
                placeholder="Replace with"
                onChange={(event) => setReplacementText(event.target.value)}
              />
              <button
                type="button"
                className="esco-btn"
                disabled={!canNavigateSearch || !onFindPrevious}
                onClick={onFindPrevious}
                title="Find Previous"
              >
                Previous
              </button>
              <button
                type="button"
                className="esco-btn"
                disabled={!canNavigateSearch || !onFindNext}
                onClick={onFindNext}
                title="Find Next"
              >
                Find Next
              </button>
              <button
                type="button"
                className="esco-btn"
                disabled={!searchQuery.trim() || replaceableSearchCount === 0 || !onReplaceAll}
                onClick={() => onReplaceAll?.(replacementText)}
                title="Replace only previewed mutable text fields"
              >
                Replace All
              </button>
              <span className="esco-search__count">
                {activeSearchIndex >= 0 && searchHits[activeSearchIndex]
                  ? `${activeSearchIndex + 1} of ${searchHits.length}`
                  : `${searchHits.length} result${searchHits.length === 1 ? "" : "s"}`}
                {replaceableSearchCount ? ` · ${replaceableSearchCount} replaceable` : ""}
              </span>
            </div>
            {searchHits.length === 0 ? (
              <p className="esco-empty">
                {searchQuery ? "No matches." : "Type to search the project — ladder, tags, comments, HMI content, security, and assets."}
              </p>
            ) : (
              <table className="esco-diagnostics__table">
                <thead>
                  <tr><th>Type</th><th>Match</th><th>Detail</th><th>Text</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {searchHits.map((hit, index) => (
                    <tr key={`${hit.kind}-${index}`} className={index === activeSearchIndex ? "is-active" : undefined}>
                      <td>{hit.kind}</td>
                      <td>
                        {hit.label}
                      </td>
                      <td title={hit.navigationTarget ?? hit.target}>{hit.detail}</td>
                      <td className="esco-search__text">{hit.snippet ?? hit.matchText ?? "-"}</td>
                      <td className="esco-search__actions">
                        {onOpenSearchHit || hit.routineId ? (
                          <button
                            type="button"
                            className="esco-btn esco-btn--quick"
                            onClick={() => (onOpenSearchHit ? onOpenSearchHit(hit) : onOpenRoutine(hit.routineId!))}
                            title={hit.routineId ? "Open routine" : "Open result"}
                          >
                            Open
                          </button>
                        ) : null}
                        {hit.tagName ? (
                          <>
                            <button
                              type="button"
                              className="esco-btn esco-btn--quick"
                              disabled={!onWatchTag}
                              onClick={() => onWatchTag?.(hit.tagName!)}
                            >
                              Watch
                            </button>
                            <button
                              type="button"
                              className="esco-btn esco-btn--quick"
                              disabled={!onCrossReferenceTag}
                              onClick={() => onCrossReferenceTag?.(hit.tagName!)}
                            >
                              XRef
                            </button>
                            <button
                              type="button"
                              className="esco-btn esco-btn--quick"
                              disabled={!onForceTag}
                              onClick={() => onForceTag?.(hit.tagName!)}
                            >
                              Force
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : tab === "references" ? (
          <CrossRefPanel
            project={project}
            selectedTagName={selectedTagName}
            selectedRoutineId={selectedRoutineId}
            selectedRoutineName={selectedRoutineName}
            forces={forces}
            onOpenRoutine={onOpenRoutine}
            onWatchTag={onWatchTag}
            onForceTag={onForceTag}
            onCrossReferenceTag={onCrossReferenceTag}
          />
        ) : tab === "build" ? (
          <div className="esco-build">
            <div className="esco-build__bar">
              <button type="button" className="esco-btn" onClick={() => runVerify("build")}>
                Verify Controller
              </button>
              <button type="button" className="esco-btn" onClick={clearOutput} disabled={outputCleared}>
                Clear Output
              </button>
              <span>Offline build output</span>
              <span>{errorCount} Error{errorCount === 1 ? "" : "s"}</span>
              <span>{warningCount} Warning{warningCount === 1 ? "" : "s"}</span>
              <span>{messageCount} Message{messageCount === 1 ? "" : "s"}</span>
              {lastVerifyAt ? <span>Last verify {lastVerifyAt}</span> : null}
            </div>
            <section
              className={`esco-runtime-preview${runtimeBuildPreview ? "" : " is-empty"}`}
              aria-label="ESCO Runtime build preview"
            >
              {runtimeBuildPreview ? (
                <>
                  <div className="esco-runtime-preview__header">
                    <div className="esco-runtime-preview__title">
                      <strong>ESCO Runtime Build</strong>
                      <span>
                        {runtimeBuildPreview.projectName} - {runtimeBuildPreview.fileName}
                      </span>
                    </div>
                    <div className="esco-runtime-preview__actions">
                      <button type="button" className="esco-btn" onClick={onExportRuntime}>
                        Export Runtime
                      </button>
                      <button type="button" className="esco-btn" onClick={onDownloadRuntimeToSoftController}>
                        Download to ESCO SoftController
                      </button>
                    </div>
                  </div>
                  <div className="esco-runtime-preview__stats">
                    <span title={runtimeBuildPreview.checksum}>
                      <strong>Checksum</strong>
                      <code>{shortChecksum(runtimeBuildPreview.checksum)}</code>
                    </span>
                    <span>
                      <strong>Built</strong>
                      {formatBuildTime(runtimeBuildPreview.builtAt)}
                    </span>
                    <span>
                      <strong>Runtime</strong>
                      {runtimeBuildPreview.runtimeVersion}
                    </span>
                    <span>
                      <strong>Controllers</strong>
                      {runtimeBuildPreview.summary.controllerCount}
                    </span>
                    <span>
                      <strong>Tasks</strong>
                      {runtimeBuildPreview.summary.taskCount}
                    </span>
                    <span>
                      <strong>Programs</strong>
                      {runtimeBuildPreview.summary.programCount}
                    </span>
                    <span>
                      <strong>Routines</strong>
                      {runtimeBuildPreview.summary.routineCount}
                    </span>
                    <span>
                      <strong>Rungs</strong>
                      {runtimeBuildPreview.summary.rungCount}
                    </span>
                    <span>
                      <strong>Tags</strong>
                      {runtimeBuildPreview.summary.tagCount}
                    </span>
                    <span>
                      <strong>I/O</strong>
                      {runtimeBuildPreview.summary.ioModuleCount}
                    </span>
                  </div>
                  <div className="esco-runtime-preview__fidelity">
                    <span className="esco-runtime-preview__status">
                      Instruction fidelity
                    </span>
                    <span>
                      {runtimeBuildPreview.summary.instructionFidelity.executable}/
                      {runtimeBuildPreview.summary.instructionFidelity.total} executable offline
                    </span>
                    <span>
                      {runtimeBuildPreview.summary.instructionFidelity.modelOnly} preserved for review,
                      {" "}{runtimeBuildPreview.summary.instructionFidelity.unsupported} unsupported
                    </span>
                    <span>
                      Execution order: {runtimeBuildPreview.summary.executionOrder.length} routine
                      {runtimeBuildPreview.summary.executionOrder.length === 1 ? "" : "s"}
                    </span>
                    <span>
                      Validation: {runtimeBuildPreview.summary.validation.error} error,
                      {" "}{runtimeBuildPreview.summary.validation.warning} warning,
                      {" "}{runtimeBuildPreview.summary.validation.info} info
                    </span>
                  </div>
                  {runtimeBuildPreview.warnings.length ? (
                    <ul className="esco-runtime-preview__warnings" aria-label="Runtime build notes">
                      {runtimeBuildPreview.warnings.slice(0, 4).map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                      {runtimeBuildPreview.warnings.length > 4 ? (
                        <li>{runtimeBuildPreview.warnings.length - 4} more runtime note(s).</li>
                      ) : null}
                    </ul>
                  ) : (
                    <div className="esco-runtime-preview__clean">0 runtime build notes.</div>
                  )}
                  <div className="esco-runtime-preview__boundary">
                    ESCO software runtime only. Physical-controller transfer remains guarded.
                  </div>
                </>
              ) : (
                <>
                  <strong>No ESCO Runtime build preview</strong>
                  <span>Run Build ESCO Runtime to populate this dock.</span>
                </>
              )}
            </section>
            <section
              className={`esco-runtime-preview esco-package-preview${packageBuildPreview ? "" : " is-empty"}`}
              aria-label="ESCO Package manifest preview"
            >
              {packageBuildPreview ? (
                <>
                  <div className="esco-runtime-preview__header">
                    <div className="esco-runtime-preview__title">
                      <strong>ESCO Package Manifest</strong>
                      <span>
                        {packageBuildPreview.projectName} - {packageBuildPreview.fileName}
                      </span>
                    </div>
                    <div className="esco-runtime-preview__actions">
                      <button type="button" className="esco-btn" onClick={onExportPackage}>
                        Export Package
                      </button>
                    </div>
                  </div>
                  <div className="esco-runtime-preview__stats">
                    <span title={packageBuildPreview.packageChecksum}>
                      <strong>Package checksum</strong>
                      <code>{shortChecksum(packageBuildPreview.packageChecksum)}</code>
                    </span>
                    <span>
                      <strong>Entries</strong>
                      {packageBuildPreview.entryCount}
                    </span>
                    <span>
                      <strong>Artifacts</strong>
                      {packageBuildPreview.embeddedArtifactCount}
                    </span>
                    <span>
                      <strong>Notes</strong>
                      {packageBuildPreview.warnings.length}
                    </span>
                  </div>
                  <table className="esco-runtime-preview__manifest-table" aria-label="ESCO package manifest entries">
                    <thead>
                      <tr>
                        <th>Path</th>
                        <th>Format</th>
                        <th>Extension</th>
                        <th>Bytes</th>
                        <th>Checksum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {packageBuildPreview.entries.slice(0, 8).map((entry) => (
                        <tr key={entry.path}>
                          <td><code>{entry.path}</code></td>
                          <td>{entry.format}</td>
                          <td>{entry.extension}</td>
                          <td>{entry.bytes}</td>
                          <td title={entry.checksum.value}><code>{shortChecksum(entry.checksum.value)}</code></td>
                        </tr>
                      ))}
                      {packageBuildPreview.entries.length > 8 ? (
                        <tr>
                          <td colSpan={5}>
                            {packageBuildPreview.entries.length - 8} more package entr{packageBuildPreview.entries.length - 8 === 1 ? "y" : "ies"}.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                  <div className="esco-runtime-preview__boundary">
                    ESCO package is an embedded offline artifact bundle. It does not contain proprietary binary project files or perform controller transfer.
                  </div>
                </>
              ) : (
                <>
                  <strong>No ESCO Package manifest preview</strong>
                  <span>Export ESCO Package to populate this manifest.</span>
                  <button type="button" className="esco-btn" onClick={onExportPackage}>
                    Export Package
                  </button>
                </>
              )}
            </section>
            <section
              className={`esco-runtime-preview esco-artifact-validation${artifactValidationPreview ? "" : " is-empty"}`}
              aria-label="ESCO artifact validation review"
            >
              {artifactValidationPreview ? (
                <>
                  <div className="esco-runtime-preview__header">
                    <div className="esco-runtime-preview__title">
                      <strong>ESCO Artifact Validation</strong>
                      <span>{artifactValidationPreview.fileName}</span>
                    </div>
                    <span className={`esco-runtime-preview__result is-${artifactStatus.toLowerCase()}`}>
                      {artifactStatus}
                    </span>
                  </div>
                  <div className="esco-runtime-preview__stats">
                    <span>
                      <strong>Type</strong>
                      {formatArtifactValidationType(artifactSummary)}
                    </span>
                    <span>
                      <strong>Validated</strong>
                      {formatBuildTime(artifactValidationPreview.validatedAt)}
                    </span>
                    {artifactSummary ? (
                      <>
                        <span>
                          <strong>Format</strong>
                          {artifactSummary.formatName}
                        </span>
                        <span>
                          <strong>Extension</strong>
                          {artifactSummary.extension}
                        </span>
                      </>
                    ) : null}
                    {artifactSummary?.entryCount !== undefined ? (
                      <span>
                        <strong>Entries</strong>
                        {artifactSummary.entryCount}
                      </span>
                    ) : null}
                    {artifactSummary?.embeddedContentCount !== undefined ? (
                      <span>
                        <strong>Artifacts</strong>
                        {artifactSummary.embeddedContentCount}
                      </span>
                    ) : null}
                    {artifactSummary?.payloadCount !== undefined ? (
                      <span>
                        <strong>Payloads</strong>
                        {artifactSummary.payloadCount}
                      </span>
                    ) : null}
                    {artifactSummary?.packageChecksumValid !== undefined ? (
                      <span>
                        <strong>Package checksum</strong>
                        {artifactSummary.packageChecksumValid ? "valid" : "invalid"}
                      </span>
                    ) : null}
                    {artifactSummary?.checksumValid !== undefined ? (
                      <span>
                        <strong>Checksum</strong>
                        {artifactSummary.checksumValid ? "valid" : "invalid"}
                      </span>
                    ) : null}
                  </div>
                  {artifactValidationPreview.checksum ? (
                    <div className="esco-runtime-preview__fidelity">
                      <span className="esco-runtime-preview__status">
                        Checksum {artifactValidationPreview.checksum.valid ? "valid" : "mismatch"}
                      </span>
                      <span title={artifactValidationPreview.checksum.expected}>
                        Expected {shortChecksum(artifactValidationPreview.checksum.expected)}
                      </span>
                      <span title={artifactValidationPreview.checksum.actual}>
                        Actual {shortChecksum(artifactValidationPreview.checksum.actual)}
                      </span>
                    </div>
                  ) : null}
                  {artifactSummary?.details.length ? (
                    <ul className="esco-runtime-preview__warnings" aria-label="ESCO artifact validation details">
                      {artifactSummary.details.slice(0, 6).map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                      {artifactSummary.details.length > 6 ? (
                        <li>{artifactSummary.details.length - 6} more validation detail(s).</li>
                      ) : null}
                    </ul>
                  ) : null}
                  {artifactValidationPreview.errors.length ? (
                    <ul className="esco-runtime-preview__errors" aria-label="ESCO artifact validation errors">
                      {artifactValidationPreview.errors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="esco-runtime-preview__boundary">
                    Offline ESCO-native artifact validation only. No project changes made, no proprietary binary project files, and no controller transfer.
                  </div>
                </>
              ) : (
                <>
                  <strong>No ESCO artifact validation review</strong>
                  <span>Validate an ESCO-native package, runtime, snapshot, library, or component file to populate this review.</span>
                </>
              )}
            </section>
            <table className="esco-diagnostics__table esco-build__table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Scope</th>
                  <th>Area</th>
                  <th>Source</th>
                  <th>Code</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Description</th>
                  <th>Recommendation</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {outputCleared ? (
                  <tr>
                    <td>Output</td>
                    <td>Project</td>
                    <td>Project</td>
                    <td>Verify Controller</td>
                    <td>clear-output</td>
                    <td>{project.name}</td>
                    <td>Ready</td>
                    <td>Output cleared. Run Verify Controller to rebuild the output log.</td>
                    <td>Run Verify Controller to regenerate compile output rows.</td>
                    <td />
                  </tr>
                ) : (
                  buildSteps.map((step) => (
                    <tr key={step.id} className={`esco-finding--${step.severity}`}>
                      <td>{step.step}</td>
                      <td>{step.scope}</td>
                      <td>{step.area}</td>
                      <td>{step.source}</td>
                      <td>{step.finding?.ruleId ?? step.id}</td>
                      <td title={step.target}>{step.targetLabel}</td>
                      <td>{step.status}</td>
                      <td>{step.description}</td>
                      <td>{step.recommendation}</td>
                      <td className="esco-diagnostics__actions">
                        {step.finding && step.targetInfo?.openable && onOpenDiagnosticTarget ? (
                          <button
                            type="button"
                            className="esco-btn esco-btn--quick"
                            onClick={() => onOpenDiagnosticTarget(step.finding!)}
                          >
                            Open
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="esco-build__output" role="log" aria-label="Verify output log">
              {verifyLog.length === 0 ? (
                <div className="esco-build__log-line is-info">
                  Output cleared. Run Verify Controller to rebuild the output log.
                </div>
              ) : (
                verifyLog.map((line, index) => (
                  <div key={`log-${index}`} className={`esco-build__log-line is-${line.severity}`}>
                    {line.text}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : tab === "handoff" ? (
          <div className="esco-l5x-handoff">
            <div className="esco-dockbar">
              <span>L5X handoff receipt</span>
              <span className="esco-dockbar__muted">
                ESCO creates offline review artifacts; Studio 5000 handles physical controller upload/download.
              </span>
              <div className="esco-dockbar__actions">
                <button type="button" className="esco-btn" onClick={onImportL5X}>
                  Import L5X
                </button>
                <button type="button" className="esco-btn" onClick={onExportL5X}>
                  Export Review L5X
                </button>
              </div>
            </div>
            {handoffReadiness ? (
              <section className="esco-runtime-preview" aria-label="Studio 5000 handoff readiness">
                <div className="esco-runtime-preview__header">
                  <div className="esco-runtime-preview__title">
                    <strong>Studio 5000 Handoff Readiness</strong>
                    <span>{handoffReadiness.ready ? "Ready to export for review" : "Needs attention before handoff"}</span>
                  </div>
                  <span className={`esco-runtime-preview__result is-${handoffReadinessStatus.toLowerCase()}`}>
                    {handoffReadinessStatus}
                  </span>
                </div>
                <div className="esco-runtime-preview__stats">
                  <span>
                    <strong>Controllers</strong>
                    {handoffReadiness.counts.controllers}
                  </span>
                  <span>
                    <strong>Tasks</strong>
                    {handoffReadiness.counts.tasks}
                  </span>
                  <span>
                    <strong>Programs</strong>
                    {handoffReadiness.counts.programs}
                  </span>
                  <span>
                    <strong>Routines</strong>
                    {handoffReadiness.counts.routines}
                  </span>
                  <span>
                    <strong>Tags</strong>
                    {handoffReadiness.counts.tags}
                  </span>
                  <span>
                    <strong>Errors</strong>
                    {handoffReadiness.validation.errors}
                  </span>
                  <span>
                    <strong>Warnings</strong>
                    {handoffReadiness.validation.warnings}
                  </span>
                </div>
                {handoffReadiness.warnings.length ? (
                  <ul className="esco-runtime-preview__warnings" aria-label="Studio 5000 handoff readiness notes">
                    {handoffReadiness.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="esco-runtime-preview__clean">No blocking handoff issues detected by ESCO validation.</div>
                )}
                <div className="esco-runtime-preview__fidelity">
                  <span className="esco-runtime-preview__status">Next steps</span>
                  {handoffReadiness.nextSteps.map((step) => (
                    <span key={step}>{step}</span>
                  ))}
                </div>
                <div className="esco-runtime-preview__boundary">
                  {handoffReadiness.boundary}
                </div>
              </section>
            ) : null}
            {interchangeAuditPreview && interchangeReport ? (
              <>
                <section className="esco-runtime-preview" aria-label="L5X interchange audit">
                  <div className="esco-runtime-preview__header">
                    <div className="esco-runtime-preview__title">
                      <strong>{interchangeReport.title}</strong>
                      <span>{interchangeAuditPreview.fileName}</span>
                    </div>
                    <span className={`esco-runtime-preview__result is-${interchangeStatus.toLowerCase()}`}>
                      {interchangeStatus}
                    </span>
                  </div>
                  <div className="esco-runtime-preview__stats">
                    <span>
                      <strong>Direction</strong>
                      {interchangeReport.direction}
                    </span>
                    <span>
                      <strong>Format</strong>
                      {interchangeReport.format}
                    </span>
                    <span>
                      <strong>Generated</strong>
                      {formatBuildTime(interchangeAuditPreview.generatedAt)}
                    </span>
                    <span>
                      <strong>Offline only</strong>
                      {interchangeReport.offlineOnly ? "yes" : "no"}
                    </span>
                    <span>
                      <strong>Binary touched</strong>
                      {interchangeReport.proprietaryBinaryTouched ? "yes" : "no"}
                    </span>
                    <span>
                      <strong>Kept</strong>
                      {interchangeReport.kept.length}
                    </span>
                    <span>
                      <strong>Preserved</strong>
                      {interchangeReport.dropped.length}
                    </span>
                    <span>
                      <strong>Changed</strong>
                      {interchangeReport.changed.length}
                    </span>
                  </div>
                  <div className="esco-runtime-preview__boundary">
                    Open the exported .L5X in Studio 5000 or approved Rockwell tooling before any controller transfer. ESCO does not write .ACD files or perform physical PLC upload/download.
                  </div>
                </section>
                <table className="esco-runtime-preview__manifest-table esco-l5x-handoff__table" aria-label="L5X handoff details">
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th>Item</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interchangeReport.kept.map((line) => (
                      <tr key={`kept-${line.label}-${line.detail}`}>
                        <td>Kept</td>
                        <td>{line.label}</td>
                        <td>{line.detail}</td>
                      </tr>
                    ))}
                    {interchangeReport.dropped.map((line) => (
                      <tr key={`preserved-${line.label}-${line.detail}`}>
                        <td>Preserved, not executed</td>
                        <td>{line.label}</td>
                        <td>{line.detail}</td>
                      </tr>
                    ))}
                    {interchangeReport.changed.map((line) => (
                      <tr key={`changed-${line.label}-${line.detail}`}>
                        <td>Changed</td>
                        <td>{line.label}</td>
                        <td>{line.detail}</td>
                      </tr>
                    ))}
                    {interchangeReport.kept.length + interchangeReport.dropped.length + interchangeReport.changed.length === 0 ? (
                      <tr>
                        <td colSpan={3}>No L5X audit rows are available yet.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
                <pre className="esco-l5x-handoff__receipt" aria-label="L5X text receipt">
                  {interchangeAuditPreview.textReceipt}
                </pre>
              </>
            ) : (
              <section className="esco-runtime-preview is-empty" aria-label="No L5X handoff receipt">
                <strong>No L5X handoff receipt</strong>
                <span>Import or export an L5X review file to populate this receipt.</span>
                <button type="button" className="esco-btn" onClick={onExportL5X}>
                  Export Review L5X
                </button>
              </section>
            )}
          </div>
        ) : tab === "tasks" ? (
          <div className="esco-task-monitor">
            <div className="esco-dockbar">
              <span>
                Task Monitor: {taskReport.scanEligibleCount} scan eligible,
                {" "}{taskReport.blockedCount} blocked,
                {" "}{taskReport.inhibitedCount} inhibited
              </span>
              <div className="esco-dockbar__actions">
                <button type="button" className="esco-btn" onClick={runTaskScanOnce}>
                  Scan Once
                </button>
                <button type="button" className="esco-btn" onClick={toggleTaskRun}>
                  {running ? "Stop Offline Scan" : "Run Offline Scan"}
                </button>
                <button type="button" className="esco-btn" onClick={runTaskVerify}>
                  Verify Tasks
                </button>
                <button type="button" className="esco-btn" onClick={resetTaskStats}>
                  Reset Task Stats
                </button>
              </div>
            </div>
            <div className="esco-task-monitor__stats" role="status" aria-label="Task monitor scan state">
              <span>Last scan: {formatMonitorTime(taskMonitor.lastScanAt)}</span>
              <span>Scans: {taskMonitor.scanCount}</span>
              <span>Runtime: {running ? `Running every ${scanIntervalMs} ms` : "Stopped"}</span>
              <span>Watchdogs: {taskReport.watchdogConfiguredCount} configured; faults offline</span>
              <span>Eligible: {taskReport.scanEligibleCount}/{taskReport.rows.length} rows</span>
              <span>{taskMonitor.scheduleChange}</span>
              <span>Last verify: {formatMonitorTime(taskMonitor.lastVerifyAt)}</span>
              <span>Last reset: {formatMonitorTime(taskMonitor.lastResetAt)}</span>
              <span>{taskMonitor.lastAction}</span>
            </div>
            {taskReport.warnings.length ? (
              <div className="esco-task-monitor__warnings" role="status">
                {taskReport.warnings.slice(0, 3).map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : null}
            {taskVerifyVisible ? (
              <div className="esco-task-monitor__verify" aria-label="Task verification rows">
                <div className="esco-task-monitor__values-head">
                  <strong>Task Verification</strong>
                  <span>{taskVerification.summary}</span>
                </div>
                <table className="esco-watch esco-task-monitor__verify-table">
                  <thead>
                    <tr>
                      <th>Result</th>
                      <th>Task</th>
                      <th>Program</th>
                      <th>Routine</th>
                      <th>Watchdog</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taskVerification.rows.length === 0 ? (
                      <tr>
                        <td colSpan={7}>No task rows to verify.</td>
                      </tr>
                    ) : (
                      taskVerification.rows.map((row) => (
                        <tr
                          key={row.id}
                          className={row.severity === "pass" ? "is-scan-ready" : row.severity === "warning" ? "is-warning" : "is-blocked"}
                        >
                          <td>{row.severity}</td>
                          <td>{row.taskName}</td>
                          <td>{row.programName ?? "-"}</td>
                          <td>{row.routineName ?? "-"}</td>
                          <td>{row.watchdogMs != null ? `${row.watchdogMs} ms` : row.watchdogConfigured ? "configured" : "-"}</td>
                          <td>
                            <span className={`esco-task-monitor__status ${row.scanEligible ? "is-ready" : "is-blocked"}`}>
                              {row.status}
                            </span>
                            <small>{row.detail}</small>
                          </td>
                          <td>
                            {row.routineId && row.action === "Open Routine" ? (
                              <button type="button" className="esco-btn esco-btn--quick" onClick={() => onOpenRoutine(row.routineId!)}>
                                Open Routine
                              </button>
                            ) : (
                              <span className="esco-watch__value">{row.action}</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}
            <table className="esco-watch esco-task-monitor__table">
              <thead>
                <tr>
                  <th>Controller</th>
                  <th>Task</th>
                  <th>Type</th>
                  <th>Program</th>
                  <th>Main Routine</th>
                  <th>Period</th>
                  <th>Priority</th>
                  <th>Watchdog</th>
                  <th>Scans</th>
                  <th>Last Scan</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {taskReport.rows.length === 0 ? (
                  <tr>
                    <td colSpan={12}>No controller tasks are available.</td>
                  </tr>
                ) : (
                  taskReport.rows.map((row, index) => {
                    const stat = taskScanStats[taskScanKey(row)];
                    return (
                    <tr key={`${row.controllerId}-${row.taskId ?? row.source}-${row.programId ?? index}-${row.routineId ?? index}`} className={row.scanEligible ? "is-scan-ready" : "is-blocked"}>
                      <td>{row.controllerName}</td>
                      <td>{row.taskName}</td>
                      <td>{row.taskType}</td>
                      <td>{row.programName ?? row.programId ?? "-"}</td>
                      <td>{row.routineName ?? "-"}</td>
                      <td>{row.periodMs != null ? `${row.periodMs} ms` : "-"}</td>
                      <td>{row.priority ?? "-"}</td>
                      <td>{row.watchdogMs != null ? `${row.watchdogMs} ms` : "-"}</td>
                      <td className="esco-task-monitor__scans" data-scan-count={stat?.scanCount ?? 0}>
                        {stat?.scanCount ?? 0}
                        {stat?.lastModelScanMs != null ? <small> · ~{stat.lastModelScanMs} ms</small> : null}
                      </td>
                      <td>{formatMonitorTime(stat?.lastScanAt)}</td>
                      <td>
                        <span className={`esco-task-monitor__status ${row.scanEligible ? "is-ready" : "is-blocked"}`}>
                          {row.status}
                        </span>
                        <small>{row.message}</small>
                      </td>
                      <td>
                        {row.taskType === "event" && row.scanEligible && onTriggerEventTask ? (
                          <button type="button" className="esco-btn esco-btn--quick" onClick={() => runEventTaskOnce(row)}>
                            Trigger
                          </button>
                        ) : null}
                        {row.routineId ? (
                          <button type="button" className="esco-btn esco-btn--quick" onClick={() => onOpenRoutine(row.routineId!)}>
                            Open Routine
                          </button>
                        ) : row.taskType === "event" && row.scanEligible && onTriggerEventTask ? null : (
                          <span className="esco-watch__value">-</span>
                        )}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            <div className="esco-task-monitor__values" aria-label="Task monitor offline values">
              <div className="esco-task-monitor__values-head">
                <strong>Offline Values</strong>
                <span>{tags.length} tag{tags.length === 1 ? "" : "s"} available after scan</span>
              </div>
              {tags.length === 0 ? (
                <p className="esco-empty">No offline tag values are available for this project.</p>
              ) : (
                <table className="esco-watch esco-task-monitor__value-table">
                  <thead>
                    <tr>
                      <th>Tag</th>
                      <th>Value</th>
                      <th>Type</th>
                      <th>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tags.slice(0, 12).map((row) => (
                      <tr key={`task-monitor-value-${row.name}`}>
                        <td>{row.name}</td>
                        <td>{String(row.value ?? "-")}</td>
                        <td>{row.dataType}</td>
                        <td>{row.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : tab === "watch" ? (
          <div className="esco-sim">
            <div className="esco-simbar">
              <button type="button" className="esco-btn esco-btn--primary" onClick={onScanOnce}>
                Scan Once
              </button>
              <button type="button" className="esco-btn" onClick={onToggleRun}>
                {running ? "Stop" : "Run"}
              </button>
              <button type="button" className="esco-btn" onClick={onReset}>
                Reset Values
              </button>
              {forceCount > 0 ? (
                <button type="button" className="esco-btn esco-btn--danger" onClick={onClearForces}>
                  Clear Forces ({forceCount})
                </button>
              ) : null}
              <span className="esco-simbar__status">{running ? "Running" : "Stopped"}</span>
              {forceCount > 0 ? (
                <span className="esco-simbar__note">Forces are offline-only simulation overrides.</span>
              ) : null}
              {selectedWatchRow ? (
                <span className="esco-simbar__selected" title="Selected tag routed from ladder, search, or cross reference">
                  Selected: {selectedWatchRow.name}
                  {selectedForceableRow ? (
                    <button
                      type="button"
                      className={`esco-btn esco-btn--quick${selectedForceableRow.name in forces ? " is-on" : ""}`}
                      onClick={() => onToggleForce(selectedForceableRow.name)}
                    >
                      {selectedForceableRow.name in forces ? "Clear Selected Force" : "Force Selected"}
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>

            {tags.length === 0 ? (
              <p className="esco-empty">No tags in the project.</p>
            ) : (
              <table className="esco-watch">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Value</th>
                    <th>Type</th>
                    <th>Role</th>
                    <th>Force</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {tags.map((row) => {
                    const forced = row.name in forces;
                    const selected = row.name === selectedWatchRow?.name;
                    const rowClass = [forced ? "is-forced" : "", selected ? "is-selected" : ""]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <tr key={row.name} className={rowClass || undefined}>
                        <td>{row.name}</td>
                        <td>
                          <WatchValue
                            row={row}
                            forced={forced}
                            onToggleTag={onToggleTag}
                            onSetNumber={onSetNumber}
                            onSetString={onSetString}
                          />
                        </td>
                        <td>{row.dataType}</td>
                        <td>{row.role}</td>
                        <td>
                          {row.kind === "struct" ? (
                            <span className="esco-watch__value">—</span>
                          ) : (
                            <button
                              type="button"
                              className={`esco-btn esco-btn--toggle${forced ? " is-on" : ""}`}
                              title={forced ? "Remove force" : "Force this value (simulation only)"}
                              onClick={() => onToggleForce(row.name)}
                            >
                              {forced ? "Forced" : "Force"}
                            </button>
                          )}
                        </td>
                        <td>{tagDescriptions.get(row.name) || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : tab === "trend" ? (
          <div className="esco-trend">
            <div className="esco-dockbar">
              <span>
                Trend buffer: {trendSamples.length} sample{trendSamples.length === 1 ? "" : "s"}
                {" · "}offline scan period {scanIntervalMs} ms
                {latestTrend ? ` · latest ${new Date(latestTrend.at).toLocaleTimeString()}` : ""}
              </span>
              <div className="esco-dockbar__actions">
                <button type="button" className="esco-btn" onClick={onScanOnce}>
                  Capture Scan
                </button>
                <button type="button" className="esco-btn" disabled={trendSamples.length === 0} onClick={onClearTrend}>
                  Clear Buffer
                </button>
              </div>
            </div>
            {trendSamples.length === 0 ? (
              <p className="esco-empty">No trend samples yet. Capture a scan or run Offline Simulation to fill the buffer.</p>
            ) : (
              <>
                <table className="esco-watch esco-trend__stats">
                  <thead><tr><th>Tag</th><th>Latest</th><th>Min</th><th>Max</th><th>Changes</th></tr></thead>
                  <tbody>
                    {trendNames.map((name) => {
                      const stats = trendStats(trendSamples, name);
                      return (
                        <tr key={name}>
                          <td>{name}</td>
                          <td>{stats.latest}</td>
                          <td>{stats.min}</td>
                          <td>{stats.max}</td>
                          <td>{stats.changes}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <table className="esco-watch esco-trend__samples">
                  <thead>
                    <tr>
                      <th>Time</th>
                      {trendNames.slice(0, 6).map((name) => <th key={name}>{name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {trendSamples.slice(-12).reverse().map((sample) => (
                      <tr key={sample.id}>
                        <td>{new Date(sample.at).toLocaleTimeString()}</td>
                        {trendNames.slice(0, 6).map((name) => (
                          <td key={name}>{formatTrendValue(sample.values[name])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        ) : tab === "forces" ? (
          <div className="esco-forces">
            <div className="esco-forces__bar">
              <span className="esco-forces__note">
                Forces are offline simulation overrides — they pin a tag's value and never reach a
                controller.
              </span>
              {forceCount > 0 ? (
                <button type="button" className="esco-btn esco-btn--danger" onClick={onClearForces}>
                  Clear Forces ({forceCount})
                </button>
              ) : null}
            </div>
            {selectedWatchRow ? (
              <div className="esco-forces__selected" role="status">
                <span>
                  Selected tag: <strong>{selectedWatchRow.name}</strong>
                  {selectedWatchRow.kind === "struct" ? " (structured tags cannot be forced as one value)" : ""}
                </span>
                {selectedForceableRow ? (
                  <button
                    type="button"
                    className={`esco-btn esco-btn--toggle${selectedForceableRow.name in forces ? " is-on" : ""}`}
                    onClick={() => onToggleForce(selectedForceableRow.name)}
                  >
                    {selectedForceableRow.name in forces ? "Clear Selected Force" : "Force Selected"}
                  </button>
                ) : null}
              </div>
            ) : null}
            {forcedRows.length === 0 ? (
              <p className="esco-empty">No forces active. Use “Force” in the Watch tab to pin a value.</p>
            ) : (
              <table className="esco-watch">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Type</th>
                    <th>Forced value</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {forcedRows.map((row) => (
                    <tr key={row.name} className="is-forced">
                      <td>{row.name}</td>
                      <td>{row.dataType}</td>
                      <td>
                        <span className="esco-watch__value">{String(forces[row.name])}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="esco-btn esco-btn--toggle is-on"
                          title="Remove force"
                          onClick={() => onToggleForce(row.name)}
                        >
                          Forced
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <p className="esco-empty">Select a dock tab.</p>
        )}
      </div>
    </div>
  );
}
