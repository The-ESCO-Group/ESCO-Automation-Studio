import { useMemo } from "react";
import type { PlcProject } from "@esco/core";
import type { ValidationFinding } from "@esco/validator";
import { buildModelSummary } from "../model-summary";

interface Props {
  project: PlcProject;
  findings: ValidationFinding[];
  openRoutineName?: string;
}

/** Read-only project rollup: identity, counts, health, and unsupported instructions. */
export function ModelSummaryPanel({ project, findings, openRoutineName }: Props) {
  const summary = useMemo(() => buildModelSummary(project, findings), [project, findings]);
  const c = summary.counts;
  const advancedReview = summary.advancedDomainReview;
  const processLibrary = summary.processLibraryReview;
  const ioReview = summary.ioModuleReview;
  const moduleConnectionReview = summary.moduleConnectionReview;
  const tagConnectionReview = summary.tagConnectionReview;
  const tagEngineeringUnitReview = summary.tagEngineeringUnitReview;
  const controllerConsumeRpiReview = summary.controllerConsumeRpiReview;
  const programParameterConnectionReview = summary.programParameterConnectionReview;
  const alarmReview = summary.alarmReview;
  const structureAnalysis = summary.structureAnalysis;
  const fidelity = summary.instructionFidelity;
  const structuredText = summary.structuredTextCoverage;
  const fidelityRows = fidelity.rows.slice(0, 18);
  const hiddenFidelityCount = Math.max(0, fidelity.rows.length - fidelityRows.length);
  const structuredTextRows = structuredText.rows.slice(0, 8);
  const hiddenStructuredTextCount = Math.max(0, structuredText.rows.length - structuredTextRows.length);
  const structureGapRows = structureAnalysis.gaps.slice(0, 6);
  const hiddenStructureGapCount = Math.max(0, structureAnalysis.gaps.length - structureGapRows.length);
  const fbdReview = structureAnalysis.fbd;
  const fbdReviewRows = fbdReview.routines.slice(0, 8);
  const hiddenFbdReviewCount = Math.max(0, fbdReview.routines.length - fbdReviewRows.length);
  const advancedDetailRows = advancedReview.detailRows
    .slice()
    .sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || a.domainLabel.localeCompare(b.domainLabel))
    .slice(0, 24);
  const motionTreeRows = advancedReview.motionTree.nodes
    .filter((row) => row.kind !== "controller")
    .slice()
    .sort((a, b) => Number(b.issueCount > 0) - Number(a.issueCount > 0) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
    .slice(0, 8);
  const hiddenMotionTreeCount = Math.max(0, advancedReview.motionTree.nodes.filter((row) => row.kind !== "controller").length - motionTreeRows.length);
  const inspectorRows = advancedReview.inspectorReport.rows.slice(0, 9);
  const processLibraryRows = processLibrary.rows.slice(0, 8);
  const alarmRows = alarmReview.rows.slice(0, 8);
  const engineeringUnitRows = tagEngineeringUnitReview.rows.slice(0, 8);
  const advancedModuleRows = ioReview.rows.filter((row) => row.advancedProfileReviewable).slice(0, 8);
  const moduleConnectionRows = moduleConnectionReview.rows
    .filter((row) => row.connectionCount > 0 || row.status === "needs-attention")
    .slice(0, 8);
  const tagConnectionRows = tagConnectionReview.rows.slice(0, 8);
  const controllerRpiRows = controllerConsumeRpiReview.rows
    .filter((row) => row.status !== "no-metadata" || row.issues.length > 0)
    .slice(0, 4);
  const programParameterConnectionRows = programParameterConnectionReview.rows.slice(0, 8);
  const hiddenInspectorCount = Math.max(0, advancedReview.inspectorReport.rows.length - inspectorRows.length);
  const hiddenProcessLibraryCount = Math.max(0, processLibrary.rows.length - processLibraryRows.length);
  const hiddenAlarmCount = Math.max(0, alarmReview.rows.length - alarmRows.length);
  const hiddenEngineeringUnitCount = Math.max(0, tagEngineeringUnitReview.rows.length - engineeringUnitRows.length);
  const hiddenAdvancedModuleCount = Math.max(0, ioReview.rows.filter((row) => row.advancedProfileReviewable).length - advancedModuleRows.length);
  const hiddenModuleConnectionCount = Math.max(
    0,
    moduleConnectionReview.rows.filter((row) => row.connectionCount > 0 || row.status === "needs-attention").length -
      moduleConnectionRows.length,
  );
  const hiddenTagConnectionCount = Math.max(0, tagConnectionReview.rows.length - tagConnectionRows.length);
  const hiddenControllerRpiCount = Math.max(
    0,
    controllerConsumeRpiReview.rows.filter((row) => row.status !== "no-metadata" || row.issues.length > 0).length -
      controllerRpiRows.length,
  );
  const hiddenProgramParameterConnectionCount = Math.max(
    0,
    programParameterConnectionReview.rows.length - programParameterConnectionRows.length,
  );
  const hiddenAdvancedDetailCount = Math.max(0, advancedReview.detailRows.length - advancedDetailRows.length);
  const countRows: { label: string; value: number }[] = [
    { label: "Programs", value: c.programs },
    { label: "Routines", value: c.routines },
    { label: "Rungs", value: c.rungs },
    { label: "Tasks", value: c.tasks },
    { label: "Controller tags", value: c.controllerTags },
    { label: "Program tags", value: c.programTags },
    { label: "Add-On Instructions", value: c.aois },
    { label: "User-defined types", value: c.udts },
    { label: "I/O modules", value: c.ioModules },
  ];
  const severityClass = (severity: string) =>
    severity === "critical" ? " is-error" : severity === "high" ? " is-warn" : severity === "medium" ? " is-info" : " is-ok";
  const formatCountRows = (rows: readonly { key: string; count: number }[], empty = "none") =>
    rows.length ? rows.map((row) => `${row.key} x${row.count}`).join(", ") : empty;

  return (
    <div className="esco-model">
      <div className="esco-model__heading">Model Summary</div>

      <dl className="esco-props">
        <div className="esco-props__row">
          <dt>Project</dt>
          <dd>{summary.projectName}</dd>
        </div>
        <div className="esco-props__row">
          <dt>Controller</dt>
          <dd>{summary.controllerName ?? "—"}</dd>
        </div>
        <div className="esco-props__row">
          <dt>Processor</dt>
          <dd>{summary.processorType ?? "—"}</dd>
        </div>
        {openRoutineName ? (
          <div className="esco-props__row">
            <dt>Open routine</dt>
            <dd>{openRoutineName}</dd>
          </div>
        ) : null}
        <div className="esco-props__row">
          <dt>Execution</dt>
          <dd>Continuous scan (offline simulation)</dd>
        </div>
      </dl>

      <div className="esco-model__heading">Contents</div>
      <div className="esco-model__grid">
        {countRows.map((row) => (
          <div className="esco-model__stat" key={row.label}>
            <span className="esco-model__stat-value">{row.value}</span>
            <span className="esco-model__stat-label">{row.label}</span>
          </div>
        ))}
      </div>

      <div className="esco-model__heading">Health</div>
      <div className="esco-model__health">
        <span className={`esco-model__pill${summary.errorCount ? " is-error" : " is-ok"}`}>
          {summary.errorCount} error{summary.errorCount === 1 ? "" : "s"}
        </span>
        <span className={`esco-model__pill${summary.warningCount ? " is-warn" : " is-ok"}`}>
          {summary.warningCount} warning{summary.warningCount === 1 ? "" : "s"}
        </span>
        <span className={`esco-model__pill${fidelity.preserved ? " is-info" : " is-ok"}`}>
          {fidelity.preserved} preserved instruction{fidelity.preserved === 1 ? "" : "s"}
        </span>
        <span className={`esco-model__pill${summary.unsupportedTotal ? " is-warn" : " is-ok"}`}>
          {summary.unsupportedTotal} unknown unsupported instruction{summary.unsupportedTotal === 1 ? "" : "s"}
        </span>
      </div>

      <div className="esco-model__heading">Parity Gap Analysis</div>
      {structureGapRows.length ? (
        <>
          <div className="esco-model__review-list" role="list" aria-label="Project structure parity gaps">
            {structureGapRows.map((gap) => (
              <div className="esco-model__review-row" role="listitem" key={`${gap.area}-${gap.severity}`}>
                <div className="esco-model__review-head">
                  <span className="esco-model__review-domain is-gap">Gap</span>
                  <span className={`esco-model__pill${severityClass(gap.severity)}`}>{gap.severity}</span>
                </div>
                <div className="esco-model__review-subject">
                  <span>{gap.area}</span>
                </div>
                <div className="esco-model__review-location">{gap.evidence}</div>
                <div className="esco-model__review-message">
                  {gap.currentEscoSupport} Missing: {gap.missingForParity}
                </div>
                <div className="esco-model__review-boundaries">Next: {gap.recommendedNextStep}</div>
              </div>
            ))}
          </div>
          <p className="esco-model__note">
            Structure analysis is read-only and offline. It reports imported L5X model gaps only; no proprietary
            binary formats, controller upload/download, go-online, online edits, runtime writes, or physical transports are used.
          </p>
          {hiddenStructureGapCount ? (
            <p className="esco-model__note">
              {hiddenStructureGapCount} additional parity gap{hiddenStructureGapCount === 1 ? "" : "s"} available in the summary data.
            </p>
          ) : null}
        </>
      ) : (
        <p className="esco-model__note">
          No structural parity gaps were detected from the current offline project model.
        </p>
      )}

      {fbdReview.routineCount ? (
        <>
          <div className="esco-model__subheading">FBD Review Coverage</div>
          <div className="esco-model__fidelity-grid">
            <div className="esco-model__stat">
              <span className="esco-model__stat-value">{fbdReview.routineCount}</span>
              <span className="esco-model__stat-label">FBD routines</span>
            </div>
            <div className="esco-model__stat">
              <span className="esco-model__stat-value">{fbdReview.parseableRoutineCount}</span>
              <span className="esco-model__stat-label">Parseable</span>
            </div>
            <div className="esco-model__stat">
              <span className="esco-model__stat-value">{fbdReview.sheetCount}</span>
              <span className="esco-model__stat-label">Sheets</span>
            </div>
            <div className="esco-model__stat">
              <span className="esco-model__stat-value">{fbdReview.blockCount}</span>
              <span className="esco-model__stat-label">Blocks</span>
            </div>
            <div className="esco-model__stat">
              <span className="esco-model__stat-value">{fbdReview.parameterCount}</span>
              <span className="esco-model__stat-label">Parameters</span>
            </div>
            <div className="esco-model__stat">
              <span className="esco-model__stat-value">{fbdReview.diagnosticWarningCount}</span>
              <span className="esco-model__stat-label">Semantic warnings</span>
            </div>
          </div>
          <div className="esco-model__review-list" role="list" aria-label="Function Block Diagram review coverage rows">
            {fbdReviewRows.map((row) => {
              const location = row.sourceKind === "aoi"
                ? `${row.controllerName} / AOI ${row.aoiName ?? "-"}`
                : `${row.controllerName} / ${row.programName ?? "-"}`;
              return (
                <div
                  className="esco-model__review-row"
                  role="listitem"
                  key={`fbd-${row.controllerName}-${row.sourceKind}-${row.programName ?? row.aoiName}-${row.routineName}`}
                >
                  <div className="esco-model__review-head">
                    <span className="esco-model__review-domain is-gap">
                      {row.sourceKind === "aoi" ? "AOI FBD" : "FBD"}
                    </span>
                    <span className={`esco-model__review-status${row.parseable ? " is-ok" : " is-warn"}`}>
                      {row.parseable ? "parseable" : "preserved-only"}
                    </span>
                  </div>
                  <div className="esco-model__review-subject">
                    <span>{row.routineName}</span>
                  </div>
                  <div className="esco-model__review-location">{location}</div>
                  <div className="esco-model__review-message">
                    {row.sheetCount} sheet{row.sheetCount === 1 ? "" : "s"}, {row.blockCount} block
                    {row.blockCount === 1 ? "" : "s"}, {row.inputRefCount + row.outputRefCount} ref
                    {row.inputRefCount + row.outputRefCount === 1 ? "" : "s"}, {row.wireCount} wire
                    {row.wireCount === 1 ? "" : "s"} preserved for offline review.
                  </div>
                  <div className="esco-model__review-boundaries">
                    Blocks: {formatCountRows(row.topBlockTypes, "none imported")}; unknown preserved:
                    {" "}{formatCountRows(row.unknownElements, "none")}; wire endpoint gaps: {row.wireEndpointGapCount};
                    {" "}parameters: {row.parameterCount} ({row.inputParameterCount} in, {row.outputParameterCount} out, {row.inOutParameterCount} in/out);
                    {" "}unresolved endpoints: {row.unresolvedWireEndpointCount}; duplicate ids: {row.duplicateElementIdCount};
                    {" "}semantic warnings: {row.diagnosticWarningCount}
                  </div>
                  {row.warnings.length ? (
                    <div className="esco-model__inspector-diagnostics" aria-label={`${row.routineName} FBD review warnings`}>
                      {row.warnings.slice(0, 3).map((warning) => (
                        <span key={`${row.routineName}-${warning}`} className="esco-model__pill is-warn">{warning}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="esco-model__note">
            FBD Review Coverage is read-only XML/preserved-source evidence. It reports {fbdReview.programRoutineCount} program FBD routine
            {fbdReview.programRoutineCount === 1 ? "" : "s"} and {fbdReview.aoiRoutineCount} AOI FBD routine
            {fbdReview.aoiRoutineCount === 1 ? "" : "s"}; top imported block types: {formatCountRows(fbdReview.topBlockTypes, "none imported")}.
            {" "}It preserves {fbdReview.parameterCount} imported block parameter/pin row{fbdReview.parameterCount === 1 ? "" : "s"} for review.
            Semantic review found {fbdReview.diagnosticWarningCount} warning{fbdReview.diagnosticWarningCount === 1 ? "" : "s"} across unresolved endpoints, duplicate ids, missing block types, missing parameter names, and missing reference operands.
            ESCO does not execute FBD sheets, author FBD wires/pins, perform online edits, load proprietary binaries, or use physical controller transports.
          </p>
          {hiddenFbdReviewCount ? (
            <p className="esco-model__note">
              {hiddenFbdReviewCount} additional FBD review row{hiddenFbdReviewCount === 1 ? "" : "s"} available in the summary data.
            </p>
          ) : null}
        </>
      ) : null}

      <div className="esco-model__heading">Instruction Fidelity</div>
      <div className="esco-model__fidelity-grid">
        <div className="esco-model__stat">
          <span className="esco-model__stat-value">{fidelity.executable}</span>
          <span className="esco-model__stat-label">Executable</span>
        </div>
        <div className="esco-model__stat">
          <span className="esco-model__stat-value">{fidelity.byStatus["executable-partial"]}</span>
          <span className="esco-model__stat-label">Partial</span>
        </div>
        <div className="esco-model__stat">
          <span className="esco-model__stat-value">{fidelity.byStatus["model-only"] + fidelity.byStatus["review-only"]}</span>
          <span className="esco-model__stat-label">Review</span>
        </div>
        <div className="esco-model__stat">
          <span className="esco-model__stat-value">{fidelity.unsupported}</span>
          <span className="esco-model__stat-label">Unsupported</span>
        </div>
      </div>
      {fidelityRows.length ? (
        <div className="esco-model__fidelity-list" role="list" aria-label="Instruction fidelity rows">
          {fidelityRows.map((row) => (
            <div className="esco-model__fidelity-row" role="listitem" key={`${row.type}-${row.status}`}>
              <div className="esco-model__fidelity-main">
                <code>{row.type}</code>
                <span className={`esco-model__review-status${row.needsAttention ? " is-warn" : " is-ok"}`}>
                  {row.label}
                </span>
                <span className="esco-model__fidelity-count">x {row.count}</span>
              </div>
              <div className="esco-model__fidelity-source">
                {row.sourceLanguages.map((source) => (source === "structured-text" ? "Structured Text" : "Ladder")).join(" + ")}
              </div>
              <div className="esco-model__fidelity-summary">{row.summary}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="esco-model__note">No ladder or Structured Text instruction calls are present in the current project.</p>
      )}
      {hiddenFidelityCount ? (
        <p className="esco-model__note">
          {hiddenFidelityCount} additional instruction-fidelity row{hiddenFidelityCount === 1 ? "" : "s"} available in the summary data.
        </p>
      ) : null}
      {structuredText.routineCount ? (
        <>
          <div className="esco-model__subheading">Structured Text Coverage</div>
          <div className="esco-model__fidelity-grid">
            <div className="esco-model__stat">
              <span className="esco-model__stat-value">{structuredText.routineCount}</span>
              <span className="esco-model__stat-label">ST routines</span>
            </div>
            <div className="esco-model__stat">
              <span className="esco-model__stat-value">{structuredText.executableCallCount}</span>
              <span className="esco-model__stat-label">Executable calls</span>
            </div>
            <div className="esco-model__stat">
              <span className="esco-model__stat-value">{structuredText.preservedCallCount + structuredText.unsupportedCallCount}</span>
              <span className="esco-model__stat-label">Preserved calls</span>
            </div>
            <div className="esco-model__stat">
              <span className="esco-model__stat-value">{structuredText.routinesWithControlFlow}</span>
              <span className="esco-model__stat-label">Control-flow routines</span>
            </div>
          </div>
          <div className="esco-model__fidelity-list" role="list" aria-label="Structured Text coverage rows">
            {structuredTextRows.map((row) => (
              <div className="esco-model__fidelity-row" role="listitem" key={`${row.controllerName}-${row.programName}-${row.routineName}`}>
                <div className="esco-model__fidelity-main">
                  <code>{row.routineName}</code>
                  <span className={`esco-model__review-status${row.unsupportedCallCount ? " is-warn" : " is-ok"}`}>
                    {row.executableCallCount}/{row.callCount} executable
                  </span>
                  <span className="esco-model__fidelity-count">{row.lineCount} line{row.lineCount === 1 ? "" : "s"}</span>
                </div>
                <div className="esco-model__fidelity-source">{row.controllerName} / {row.programName}</div>
                <div className="esco-model__fidelity-summary">{row.summary}</div>
                {row.controlFlow.length ? (
                  <div className="esco-model__inspector-diagnostics" aria-label={`${row.routineName} Structured Text coverage`}>
                    {row.controlFlow.slice(0, 6).map((item) => (
                      <span key={`${row.routineName}-${item}`} className="esco-model__pill is-info">{item}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <p className="esco-model__note">
            Structured Text coverage reports offline source evidence only. Supported ST assignments, bounded control flow,
            routine calls, and registered instruction calls execute in the ESCO simulator where implemented; model-only,
            review-only, and unknown calls are preserved for review. Firmware-specific scan phases, controller execution,
            online edits, physical-controller transfer, and proprietary binary formats are not modelled.
          </p>
          {hiddenStructuredTextCount ? (
            <p className="esco-model__note">
              {hiddenStructuredTextCount} additional Structured Text routine row{hiddenStructuredTextCount === 1 ? "" : "s"} available in the summary data.
            </p>
          ) : null}
        </>
      ) : null}

      <div className="esco-model__heading">Advanced Domain Review</div>
      <div className="esco-model__domain-list">
        {advancedReview.domains.map((domain) => (
          <div className="esco-model__domain-row" key={domain.domain}>
            <div>
              <span className="esco-model__domain-name">{domain.label}</span>
              <span className="esco-model__domain-detail">
                {domain.reviewableCount}/{domain.itemCount} reviewable
              </span>
            </div>
            <span className={`esco-model__pill${domain.issueCount ? " is-warn" : domain.itemCount ? " is-ok" : " is-info"}`}>
              {domain.readinessPercent}%
            </span>
          </div>
        ))}
      </div>
      <p className="esco-model__note">
        {advancedReview.issueCount
          ? `${advancedReview.issueCount} advanced-domain item${advancedReview.issueCount === 1 ? "" : "s"} need offline review cleanup.`
          : `${advancedReview.totalItemCount} advanced-domain item${advancedReview.totalItemCount === 1 ? "" : "s"} resolved for offline review.`}
      </p>
      {processLibraryRows.length ? (
        <>
          <div className="esco-model__subheading">Process Library Objects</div>
          <div className="esco-model__review-list" role="list" aria-label="Vendor process library object rows">
            {processLibraryRows.map((row) => {
              const location = [row.controllerName, row.programName].filter(Boolean).join(" / ");
              return (
                <div className="esco-model__review-row" role="listitem" key={row.id}>
                  <div className="esco-model__review-head">
                    <span className="esco-model__review-domain is-process">
                      {row.kind === "aoi-definition" ? "AOI" : row.kind === "udt-definition" ? "UDT" : "Tag"}
                    </span>
                    <span className={`esco-model__review-status${row.status === "reviewable" ? " is-ok" : " is-warn"}`}>
                      {row.status}
                    </span>
                  </div>
                  <div className="esco-model__review-subject">
                    {row.dataType ? <code>{row.dataType}</code> : null}
                    <span>{row.name}</span>
                  </div>
                  <div className="esco-model__review-location">{location || row.controllerName}</div>
                  <div className="esco-model__review-message">{row.message}</div>
                  <div className="esco-model__review-boundaries">
                    {row.category}, {row.matchedPrefix}, {row.parameterCount} param, {row.memberCount} member,
                    {" "}{row.tagInstanceCount} instance{row.tagInstanceCount === 1 ? "" : "s"}
                  </div>
                  {row.representativeFields.length ? (
                    <div className="esco-model__inspector-diagnostics" aria-label={`${row.name} process library fields`}>
                      {row.representativeFields.slice(0, 4).map((field) => (
                        <span key={`${row.id}-${field}`} className="esco-model__pill is-info">{field}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="esco-model__note">
            {processLibrary.objectCount} process-library object{processLibrary.objectCount === 1 ? "" : "s"} detected;
            {" "}{processLibrary.reviewableCount} reviewable, {processLibrary.metadataOnlyCount} metadata-only,
            {" "}{processLibrary.issueCount} issue{processLibrary.issueCount === 1 ? "" : "s"}. Vendor faceplates,
            process-object execution, runtime writes, and controller communication are not modelled.
          </p>
          {hiddenProcessLibraryCount ? (
            <p className="esco-model__note">
              {hiddenProcessLibraryCount} additional process-library object row{hiddenProcessLibraryCount === 1 ? "" : "s"} available in the summary data.
            </p>
          ) : null}
        </>
      ) : null}
      {alarmRows.length ? (
        <>
          <div className="esco-model__subheading">Controller / Process Alarm Review</div>
          <div className="esco-model__review-list" role="list" aria-label="Controller and process alarm review rows">
            {alarmRows.map((row) => {
              const location = [
                row.controllerName,
                row.programName,
                row.routineName,
                row.rungNumber == null ? null : `Rung ${row.rungNumber}`,
              ].filter(Boolean).join(" / ");
              return (
                <div className="esco-model__review-row" role="listitem" key={row.id}>
                  <div className="esco-model__review-head">
                    <span className="esco-model__review-domain is-alarm">
                      {row.kind === "alarm-tag" ? "Tag" : row.kind === "alarm-instruction" ? row.instructionType ?? "Logic" : "Def"}
                    </span>
                    <span className={`esco-model__review-status${row.status === "needs-attention" ? " is-warn" : row.status === "reviewable" ? " is-ok" : " is-info"}`}>
                      {row.status}
                    </span>
                  </div>
                  <div className="esco-model__review-subject">
                    {row.dataType ? <code>{row.dataType}</code> : null}
                    <span>{row.name}</span>
                  </div>
                  <div className="esco-model__review-location">{location || row.controllerName}</div>
                  <div className="esco-model__review-message">{row.message}</div>
                  <div className="esco-model__review-boundaries">
                    {row.alarmKind}, {row.fieldCount} field{row.fieldCount === 1 ? "" : "s"},
                    {" "}{row.tagInstanceCount} instance{row.tagInstanceCount === 1 ? "" : "s"}
                  </div>
                  {row.operands.length ? (
                    <div className="esco-model__inspector-diagnostics" aria-label={`${row.name} alarm operands`}>
                      {row.operands.slice(0, 4).map((operand) => (
                        <span
                          key={`${row.id}-${operand.index}`}
                          className={`esco-model__pill is-${operand.typeMatches === false || (operand.required && !operand.value) ? "warn" : operand.resolved ? "ok" : "info"}`}
                        >
                          {operand.name}: {operand.value || "missing"}
                          {operand.dataType ? ` (${operand.dataType})` : ""}
                        </span>
                      ))}
                    </div>
                  ) : row.representativeFields.length ? (
                    <div className="esco-model__inspector-diagnostics" aria-label={`${row.name} alarm fields`}>
                      {row.representativeFields.slice(0, 4).map((field) => (
                        <span key={`${row.id}-${field}`} className="esco-model__pill is-info">{field}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="esco-model__note">
            {alarmReview.alarmObjectCount} alarm object{alarmReview.alarmObjectCount === 1 ? "" : "s"} detected:
            {" "}{alarmReview.alarmTagCount} tag, {alarmReview.alarmInstructionCount} ALMA/ALMD instruction,
            {" "}{alarmReview.processAlarmDefinitionCount} process-alarm definition. Alarm condition evaluation,
            status updates, latch/acknowledge, deadband/delay timing, controller communication, runtime writes,
            and proprietary binary formats remain offline boundaries.
          </p>
          {hiddenAlarmCount ? (
            <p className="esco-model__note">
              {hiddenAlarmCount} additional alarm review row{hiddenAlarmCount === 1 ? "" : "s"} available in the summary data.
            </p>
          ) : null}
        </>
      ) : null}
      {engineeringUnitRows.length ? (
        <>
          <div className="esco-model__subheading">Engineering Units</div>
          <div className="esco-model__review-list" role="list" aria-label="Tag engineering unit review rows">
            {engineeringUnitRows.map((row) => (
              <div className="esco-model__review-row" role="listitem" key={`engineering-unit-${row.tagId}-${row.operand}`}>
                <div className="esco-model__review-head">
                  <span className="esco-model__review-domain is-units">Units</span>
                  <span className={`esco-model__review-status${row.status === "needs-attention" ? " is-warn" : " is-ok"}`}>
                    {row.status}
                  </span>
                </div>
                <div className="esco-model__review-subject">
                  <code>{row.tagDataType}</code>
                  <span>{row.path}</span>
                </div>
                <div className="esco-model__review-location">
                  {row.programName ? `${row.controllerName} / ${row.programName}` : row.controllerName}
                </div>
                <div className="esco-model__review-message">{row.message}</div>
                <div className="esco-model__review-boundaries">
                  {row.tagScope} scope, operand {row.operand.trim() || "<tag>"}, unit {row.unitText || "<blank>"}
                </div>
                {row.formatPreview || row.conversionPreview ? (
                  <div className="esco-model__review-boundaries">
                    {row.formatPreview ? <>Display preview: {row.formatPreview}</> : null}
                    {row.formatPreview && row.conversionPreview ? " | " : null}
                    {row.conversionPreview ? <>Conversion preview: {row.conversionPreview}</> : null}
                  </div>
                ) : null}
                {row.issues.length ? (
                  <div className="esco-model__inspector-diagnostics" aria-label={`${row.path} engineering unit diagnostics`}>
                    {row.issues.slice(0, 4).map((issue) => (
                      <span key={`${row.tagId}-${row.operand}-${issue}`} className="esco-model__pill is-warn">{issue}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <p className="esco-model__note">
            {tagEngineeringUnitReview.rowCount} engineering-unit row{tagEngineeringUnitReview.rowCount === 1 ? "" : "s"} detected across
            {" "}{tagEngineeringUnitReview.tagWithUnitsCount} tag{tagEngineeringUnitReview.tagWithUnitsCount === 1 ? "" : "s"}:
            {" "}{tagEngineeringUnitReview.tagLevelUnitCount} tag-level and {tagEngineeringUnitReview.memberOrElementUnitCount} member/element.
            {" "}{tagEngineeringUnitReview.liveDisplayFormattingModelledCount} local display formatter{tagEngineeringUnitReview.liveDisplayFormattingModelledCount === 1 ? "" : "s"}
            {" "}and {tagEngineeringUnitReview.engineeringUnitConversionModelledCount} offline conversion path{tagEngineeringUnitReview.engineeringUnitConversionModelledCount === 1 ? "" : "s"} modelled.
            Online tag-property edits, controller download, and controller communication remain blocked.
          </p>
          {hiddenEngineeringUnitCount ? (
            <p className="esco-model__note">
              {hiddenEngineeringUnitCount} additional engineering-unit row{hiddenEngineeringUnitCount === 1 ? "" : "s"} available in the summary data.
            </p>
          ) : null}
        </>
      ) : null}
      {advancedModuleRows.length ? (
        <>
          <div className="esco-model__subheading">Advanced Module Profiles</div>
          <div className="esco-model__review-list" role="list" aria-label="Advanced module profile rows">
            {advancedModuleRows.map((row) => (
              <div className="esco-model__review-row" role="listitem" key={`module-profile-${row.moduleId}`}>
                <div className="esco-model__review-head">
                  <span className="esco-model__review-domain is-io">Module</span>
                  <span className={`esco-model__review-status${row.status === "needs-attention" ? " is-warn" : " is-ok"}`}>
                    {row.status}
                  </span>
                </div>
                <div className="esco-model__review-subject">
                  {row.catalogNumber ? <code>{row.catalogNumber}</code> : null}
                  <span>{row.name}</span>
                </div>
                <div className="esco-model__review-location">
                  {row.controllerName}
                  {row.slot != null ? ` / slot ${row.slot}` : ""}
                </div>
                <div className="esco-model__review-message">{row.advancedProfileMessage}</div>
                <div className="esco-model__review-boundaries">
                  {row.advancedProfileLabel}, signals {row.advancedProfileSignals.join(", ")}, {row.connectionCount} connection
                  {row.connectionCount === 1 ? "" : "s"}, {row.profileChannelCount} channel
                  {row.profileChannelCount === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
          <p className="esco-model__note">
            {ioReview.advancedProfileModuleCount} advanced module profile{ioReview.advancedProfileModuleCount === 1 ? "" : "s"} detected:
            {" "}{ioReview.driveProfileCount} drive, {ioReview.flex5000ProfileCount} FLEX 5000,
            {" "}{ioReview.hartProfileCount} HART, {ioReview.bridgeProfileCount} bridge. AOP download,
            live diagnostics, module commands, and keying enforcement remain offline boundaries.
          </p>
          {hiddenAdvancedModuleCount ? (
            <p className="esco-model__note">
              {hiddenAdvancedModuleCount} additional advanced module profile row{hiddenAdvancedModuleCount === 1 ? "" : "s"} available in the summary data.
            </p>
          ) : null}
        </>
      ) : null}
      {moduleConnectionRows.length ? (
        <>
          <div className="esco-model__subheading">Module Connection Metadata</div>
          <div className="esco-model__review-list" role="list" aria-label="I/O module connection review rows">
            {moduleConnectionRows.map((row) => (
              <div className="esco-model__review-row" role="listitem" key={`module-connection-${row.moduleId}`}>
                <div className="esco-model__review-head">
                  <span className="esco-model__review-domain is-io">Conn</span>
                  <span className={`esco-model__review-status${row.status === "needs-attention" ? " is-warn" : row.status === "reviewable" ? " is-ok" : " is-info"}`}>
                    {row.status}
                  </span>
                </div>
                <div className="esco-model__review-subject">
                  {row.catalogNumber ? <code>{row.catalogNumber}</code> : null}
                  <span>{row.moduleName}</span>
                </div>
                <div className="esco-model__review-location">
                  {row.controllerName}
                  {row.slot != null ? ` / slot ${row.slot}` : ""}
                </div>
                <div className="esco-model__review-message">{row.message}</div>
                <div className="esco-model__review-boundaries">
                  {row.connectionCount} connection{row.connectionCount === 1 ? "" : "s"},
                  {" "}{row.inputCount} input, {row.outputCount} output,
                  {" "}{row.priorityMetadataCount} priority, {row.eventIdMetadataCount} event,
                  {" "}{row.unicastCount} unicast, {row.multicastCount} multicast
                </div>
                {row.connections.length ? (
                  <div className="esco-model__inspector-diagnostics" aria-label={`${row.moduleName} module connections`}>
                    {row.connections.slice(0, 4).map((connection, index) => (
                      <span
                        key={`${row.moduleId}-${connection.name ?? index}`}
                        className={`esco-model__pill is-${connection.issues.length ? "warn" : "ok"}`}
                      >
                        {connection.name ?? `Connection ${index + 1}`}: {connection.type ?? "type?"}
                        {connection.rpiMs != null ? `, ${connection.rpiMs} ms` : ", RPI?"}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <p className="esco-model__note">
            {moduleConnectionReview.connectionCount} module connection{moduleConnectionReview.connectionCount === 1 ? "" : "s"} detected across
            {" "}{moduleConnectionReview.moduleWithConnectionsCount} module{moduleConnectionReview.moduleWithConnectionsCount === 1 ? "" : "s"}.
            RPI, priority, EventID, unicast/multicast, and major-fault settings are reviewable metadata only;
            module connections, RPI scheduling, event dispatch, multicast enforcement, controller communication, and
            connection major faults are not modelled.
          </p>
          {hiddenModuleConnectionCount ? (
            <p className="esco-model__note">
              {hiddenModuleConnectionCount} additional module connection row{hiddenModuleConnectionCount === 1 ? "" : "s"} available in the summary data.
            </p>
          ) : null}
        </>
      ) : null}
      {(tagConnectionRows.length || controllerRpiRows.length) ? (
        <>
          <div className="esco-model__subheading">Produced / Consumed Tag Connections</div>
          {tagConnectionRows.length ? (
            <div className="esco-model__review-list" role="list" aria-label="Produced and consumed tag connection review rows">
              {tagConnectionRows.map((row) => (
                <div className="esco-model__review-row" role="listitem" key={`tag-connection-${row.tagId}`}>
                  <div className="esco-model__review-head">
                    <span className="esco-model__review-domain is-connection">
                      {row.role === "conflicting" ? "Conflict" : row.role === "produced" ? "Produced" : "Consumed"}
                    </span>
                    <span className={`esco-model__review-status${row.status === "needs-attention" ? " is-warn" : " is-ok"}`}>
                      {row.status}
                    </span>
                  </div>
                  <div className="esco-model__review-subject">
                    <code>{row.dataType}</code>
                    <span>{row.tagName}</span>
                  </div>
                  <div className="esco-model__review-location">
                    {row.programName ? `${row.controllerName} / ${row.programName}` : row.controllerName}
                  </div>
                  <div className="esco-model__review-message">{row.message}</div>
                  <div className="esco-model__review-boundaries">
                    {row.scope} scope
                    {row.produceCount != null ? `, ${row.produceCount} consumer${row.produceCount === 1 ? "" : "s"}` : ""}
                    {row.producer ? `, producer ${row.producer}` : ""}
                    {row.remoteTag ? `, remote ${row.remoteTag}` : ""}
                    {row.rpi != null ? `, RPI ${row.rpi} ms` : ""}
                    {row.unicast != null ? `, ${row.unicast ? "unicast" : "multicast"}` : ""}
                  </div>
                  {(row.issues.length || row.programmaticallySendEventTrigger != null || row.unicastPermitted != null) ? (
                    <div className="esco-model__inspector-diagnostics" aria-label={`${row.tagName} connection metadata`}>
                      {row.issues.slice(0, 3).map((issue) => (
                        <span key={`${row.tagId}-${issue}`} className="esco-model__pill is-warn">{issue}</span>
                      ))}
                      {row.programmaticallySendEventTrigger != null ? (
                        <span className="esco-model__pill is-info">
                          event trigger: {row.programmaticallySendEventTrigger ? "yes" : "no"}
                        </span>
                      ) : null}
                      {row.unicastPermitted != null ? (
                        <span className="esco-model__pill is-info">
                          produced unicast: {row.unicastPermitted ? "permitted" : "not permitted"}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {controllerRpiRows.length ? (
            <div className="esco-model__review-list" role="list" aria-label="Controller consumed tag RPI source review rows">
              {controllerRpiRows.map((row) => (
                <div className="esco-model__review-row" role="listitem" key={`controller-rpi-${row.controllerId}`}>
                  <div className="esco-model__review-head">
                    <span className="esco-model__review-domain is-connection">RPI</span>
                    <span className={`esco-model__review-status${row.status === "needs-attention" ? " is-warn" : row.status === "no-metadata" ? " is-info" : " is-ok"}`}>
                      {row.status}
                    </span>
                  </div>
                  <div className="esco-model__review-subject">
                    <span>{row.controllerName}</span>
                  </div>
                  <div className="esco-model__review-message">{row.message}</div>
                  <div className="esco-model__review-boundaries">
                    CanUseRPIFromProducer={row.canUseRPIFromProducer ?? "not imported"},
                    {" "}CanUseRPIFromController={row.canUseRPIFromController ?? "not imported"},
                    {" "}effective={row.effectiveCanUseRPIFromProducer == null ? "unknown" : row.effectiveCanUseRPIFromProducer ? "producer" : "controller"}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <p className="esco-model__note">
            {tagConnectionReview.producedCount} produced tag{tagConnectionReview.producedCount === 1 ? "" : "s"},
            {" "}{tagConnectionReview.consumedCount} consumed tag{tagConnectionReview.consumedCount === 1 ? "" : "s"},
            {" "}{tagConnectionReview.conflictingCount} conflicting tag{tagConnectionReview.conflictingCount === 1 ? "" : "s"},
            and {controllerConsumeRpiReview.metadataCount} controller RPI-source metadata row{controllerConsumeRpiReview.metadataCount === 1 ? "" : "s"} detected.
            Produced/consumed tag connections, remote controller browse, RPI negotiation, RPI scheduling,
            data transfer, download preflight, and controller communication are not modelled.
          </p>
          {hiddenTagConnectionCount || hiddenControllerRpiCount ? (
            <p className="esco-model__note">
              {hiddenTagConnectionCount + hiddenControllerRpiCount} additional produced/consumed connection row
              {hiddenTagConnectionCount + hiddenControllerRpiCount === 1 ? "" : "s"} available in the summary data.
            </p>
          ) : null}
        </>
      ) : null}
      {programParameterConnectionRows.length ? (
        <>
          <div className="esco-model__subheading">Program Parameter Connections</div>
          <div className="esco-model__review-list" role="list" aria-label="Program parameter connection review rows">
            {programParameterConnectionRows.map((row) => {
              const endPoint1 = row.endPoint1.raw ?? `${row.endPoint1.programName ?? "?"}.${row.endPoint1.parameterName ?? "?"}`;
              const endPoint2 = row.endPoint2.raw ?? `${row.endPoint2.programName ?? "?"}.${row.endPoint2.parameterName ?? "?"}`;
              return (
                <div className="esco-model__review-row" role="listitem" key={`program-parameter-connection-${row.connectionId}`}>
                  <div className="esco-model__review-head">
                    <span className="esco-model__review-domain is-connection">Param</span>
                    <span className={`esco-model__review-status${row.status === "needs-attention" ? " is-warn" : " is-ok"}`}>
                      {row.status}
                    </span>
                  </div>
                  <div className="esco-model__review-subject">
                    <span>{`${endPoint1} -> ${endPoint2}`}</span>
                  </div>
                  <div className="esco-model__review-location">{row.controllerName}</div>
                  <div className="esco-model__review-message">{row.message}</div>
                  <div className="esco-model__review-boundaries">
                    {row.endPoint1.dataType ?? "unresolved"} {row.endPoint1.usage ?? "parameter"} to
                    {" "}{row.endPoint2.dataType ?? "unresolved"} {row.endPoint2.usage ?? "parameter"}
                  </div>
                  {(row.issues.length || row.endPoint1.resolved || row.endPoint2.resolved) ? (
                    <div className="esco-model__inspector-diagnostics" aria-label={`${row.connectionId} parameter connection diagnostics`}>
                      {row.issues.slice(0, 3).map((issue) => (
                        <span key={`${row.connectionId}-${issue}`} className="esco-model__pill is-warn">{issue}</span>
                      ))}
                      {row.endPoint1.resolved ? (
                        <span className="esco-model__pill is-ok">
                          {row.endPoint1.programName}.{row.endPoint1.parameterName}: {row.endPoint1.dataType}
                        </span>
                      ) : null}
                      {row.endPoint2.resolved ? (
                        <span className="esco-model__pill is-ok">
                          {row.endPoint2.programName}.{row.endPoint2.parameterName}: {row.endPoint2.dataType}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="esco-model__note">
            {programParameterConnectionReview.connectionCount} program parameter connection
            {programParameterConnectionReview.connectionCount === 1 ? "" : "s"} detected across
            {" "}{programParameterConnectionReview.configuredControllerCount} controller
            {programParameterConnectionReview.configuredControllerCount === 1 ? "" : "s"};{" "}
            {programParameterConnectionReview.issueCount} need attention. Runtime parameter transfer,
            controller-verified binding, program-connection scheduling, download preflight, and controller
            communication are not modelled.
          </p>
          {hiddenProgramParameterConnectionCount ? (
            <p className="esco-model__note">
              {hiddenProgramParameterConnectionCount} additional program parameter connection row
              {hiddenProgramParameterConnectionCount === 1 ? "" : "s"} available in the summary data.
            </p>
          ) : null}
        </>
      ) : null}
      {motionTreeRows.length ? (
        <>
          <div className="esco-model__subheading">Motion Axis / Device Tree</div>
          <div className="esco-model__review-list" role="list" aria-label="Motion axis and device tree rows">
            {motionTreeRows.map((row) => (
              <div className="esco-model__review-row" role="listitem" key={row.id}>
                <div className="esco-model__review-head">
                  <span className="esco-model__review-domain is-motion">
                    {row.kind === "motion-device" ? "Device" : row.kind === "motion-group" ? "Group" : row.kind === "coordinate-system" ? "Coord" : "Axis"}
                  </span>
                  <span className={`esco-model__review-status${row.issueCount || row.status === "unlinked" ? " is-warn" : " is-ok"}`}>
                    {row.status}
                  </span>
                </div>
                <div className="esco-model__review-subject">
                  {row.dataType ? <code>{row.dataType}</code> : null}
                  <span>{row.name}</span>
                </div>
                <div className="esco-model__review-location">
                  {row.parentName ? `${row.controllerName} / ${row.parentName}` : row.controllerName}
                </div>
                <div className="esco-model__review-message">{row.message}</div>
                <div className="esco-model__review-boundaries">
                  {row.commandCount} cmd, {row.moduleCount} device, {row.controlTagCount} control tag
                  {row.controlTagCount === 1 ? "" : "s"}
                  {row.childIds.length ? `, ${row.childIds.length} child${row.childIds.length === 1 ? "" : "ren"}` : ""}
                </div>
              </div>
            ))}
          </div>
          {hiddenMotionTreeCount ? (
            <p className="esco-model__note">
              {hiddenMotionTreeCount} additional motion tree row{hiddenMotionTreeCount === 1 ? "" : "s"} available in the backend report.
            </p>
          ) : null}
        </>
      ) : null}
      {inspectorRows.length ? (
        <>
          <div className="esco-model__subheading">Domain Inspectors</div>
          <div className="esco-model__inspector-list" role="list" aria-label="Advanced domain inspector rows">
            {inspectorRows.map((row) => (
              <div className="esco-model__inspector-row" role="listitem" key={row.id}>
                <div className="esco-model__inspector-head">
                  <span className={`esco-model__review-domain is-${row.domain}`}>
                    {row.domain === "phase" ? "Phase" : row.domain[0]!.toUpperCase() + row.domain.slice(1)}
                  </span>
                  <strong>{row.title}</strong>
                  <span className={`esco-model__review-status${row.issueCount ? " is-warn" : " is-ok"}`}>
                    {row.status}
                  </span>
                </div>
                <div className="esco-model__inspector-subject">{row.subject}</div>
                <div className="esco-model__inspector-meta">
                  <span>{row.itemCount} instruction{row.itemCount === 1 ? "" : "s"}</span>
                  <span>{row.instructionTypes.join(", ")}</span>
                  <span>{row.dataTypes.length ? row.dataTypes.join(", ") : "Imported type not resolved"}</span>
                </div>
                <div className="esco-model__review-message">{row.message}</div>
                {row.diagnostics.length ? (
                  <div className="esco-model__inspector-diagnostics" aria-label={`${row.title} diagnostics`}>
                    {row.diagnostics.slice(0, 6).map((diagnostic) => (
                      <span key={`${row.id}-${diagnostic.label}`} className={`esco-model__pill is-${diagnostic.status === "ok" ? "ok" : diagnostic.status === "info" ? "info" : "warn"}`}>
                        {diagnostic.label}: {diagnostic.detail}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="esco-model__review-boundaries">
                  {row.boundaries.slice(0, 3).join(", ")}
                  {row.boundaries.length > 3 ? `, +${row.boundaries.length - 3}` : ""}
                </div>
              </div>
            ))}
          </div>
          {hiddenInspectorCount ? (
            <p className="esco-model__note">
              {hiddenInspectorCount} additional domain inspector row{hiddenInspectorCount === 1 ? "" : "s"} available in the backend report.
            </p>
          ) : null}
        </>
      ) : null}
      {advancedDetailRows.length ? (
        <div className="esco-model__review-list" role="list" aria-label="Advanced domain detail rows">
          {advancedDetailRows.map((row) => {
            const location = [
              row.controllerName,
              row.programName,
              row.routineName,
              row.rungNumber == null ? null : `Rung ${row.rungNumber}`,
            ].filter(Boolean).join(" / ");
            return (
              <div className="esco-model__review-row" role="listitem" key={row.id}>
                <div className="esco-model__review-head">
                  <span className={`esco-model__review-domain is-${row.domain}`}>{row.domainLabel}</span>
                  <span className={`esco-model__review-status${row.needsAttention ? " is-warn" : " is-ok"}`}>
                    {row.status}
                  </span>
                </div>
                <div className="esco-model__review-subject">
                  {row.instructionType ? <code>{row.instructionType}</code> : null}
                  <span>{row.subject}</span>
                </div>
                <div className="esco-model__review-location">{location}</div>
                <div className="esco-model__review-message">{row.message}</div>
                <div className="esco-model__review-boundaries">
                  {row.boundaries.slice(0, 3).join(", ")}
                  {row.boundaryCount > 3 ? `, +${row.boundaryCount - 3}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {hiddenAdvancedDetailCount ? (
        <p className="esco-model__note">
          {hiddenAdvancedDetailCount} additional advanced-domain row{hiddenAdvancedDetailCount === 1 ? "" : "s"} available in the backend report.
        </p>
      ) : null}

      {summary.modelOnlyInstructions.length > 0 ? (
        <>
          <div className="esco-model__heading">Model-only instructions (preserved, not simulated)</div>
          <ul className="esco-model__unsupported">
            {summary.modelOnlyInstructions.map((u) => (
              <li key={u.type}>
                <code>{u.type}</code> × {u.count}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {summary.unsupportedInstructions.length > 0 ? (
        <>
          <div className="esco-model__heading">Unknown unsupported instructions (read-only)</div>
          <ul className="esco-model__unsupported">
            {summary.unsupportedInstructions.map((u) => (
              <li key={u.type}>
                <code>{u.type}</code> × {u.count}
              </li>
            ))}
          </ul>
          <p className="esco-model__note">
            These unknown instruction blocks were imported and preserved read-only. The simulator
            does not execute them.
          </p>
        </>
      ) : null}
    </div>
  );
}
