import type { PlcProject } from "@esco/core";
import {
  monitorStateMatrixReport,
  shippedOnlineReadinessReport,
  shippedControllerSafetyEvidenceReport,
  shippedTransportReadinessReport,
} from "@esco/controller-comm";
import type { BlockedReason, CommandRisk } from "@esco/controller-comm";
import { controllerCommunicationPathReviewReport } from "@esco/project-actions";
import type { ControllerSessionApi } from "../controller-session";
import { escoControllerCommandDisplayLabel } from "../escoCapabilityMap";
import type { VirtualControllerApi } from "../virtual-controller-session";
import { VirtualControllerPanel } from "./VirtualControllerPanel";

interface Props {
  project: PlcProject;
  controller: ControllerSessionApi;
  onToast: (kind: "info" | "success" | "warning" | "error", message: string) => void;
  /** The ESCO Virtual Controller session (offline/virtual workflow), rendered above the hardware safety gate. */
  virtual?: VirtualControllerApi;
  /** Load an uploaded virtual-controller project image for inspection. */
  onLoadUploaded?: (payload: string) => void;
}

const RISK_LABEL: Record<CommandRisk, string> = {
  read: "Read",
  write: "Write",
  destructive: "Destructive",
};

const TRANSPORT_KIND_LABEL: Record<string, string> = {
  "offline-sim": "Offline Simulation",
  "model-only": "Model-only Review",
  "readonly-monitor": "Read-only Monitor",
  "real-controller": "Real Controller",
  unavailable: "Unavailable",
};

const STATE_CLASS: Record<string, string> = {
  "offline-simulation": "is-sim",
  "model-only": "is-model-only",
  disconnected: "is-disconnected",
  "connecting-disabled": "is-blocked",
  connecting: "is-connecting",
  "connected-unavailable": "is-blocked",
  "connected-readonly": "is-connected",
  "connected-monitor": "is-connected",
  faulted: "is-error",
  "safety-blocked": "is-blocked",
};

const READINESS_LABEL: Record<string, string> = {
  "simulation-ready": "Simulation",
  "model-only": "Model-only",
  blocked: "Blocked",
  "safety-blocked": "Safety blocked",
  "verified-readonly": "Verified read",
  "verified-readwrite": "Verified write",
};

const READINESS_CLASS: Record<string, string> = {
  "simulation-ready": "is-sim",
  "model-only": "is-model-only",
  blocked: "is-blocked",
  "safety-blocked": "is-blocked",
  "verified-readonly": "is-connected",
  "verified-readwrite": "is-connected",
};

const ONLINE_STAGE_CLASS: Record<string, string> = {
  complete: "is-connected",
  partial: "is-connecting",
  blocked: "is-blocked",
};

const BLOCKER_LABEL: Record<NonNullable<BlockedReason>, string> = {
  "model-only": "Model-only",
  "no-real-transport": "No real transport",
  "not-connected": "Not connected",
  "safety-unverified": "Unverified",
  "safety-blocked-state": "Safety blocked",
  "capability-missing": "Capability missing",
  "needs-confirmation": "Confirmation",
  faulted: "Faulted",
};

/**
 * Controller connection panel. Surfaces the connection state machine and the
 * guarded upload/download/online-edit commands. Every real action is visible as
 * a safe blocked placeholder: there is no tested controller transport in this
 * build, so the safety gate keeps the session in Offline Simulation /
 * Model-only / Unavailable / Safety Blocked. Nothing here ever writes to a
 * controller.
 */
export function ControllerPanel({ project, controller, onToast, virtual, onLoadUploaded }: Props) {
  const { snapshot, audit, commands, runCommand, runCommunicationAction } = controller;
  const pathReport = controllerCommunicationPathReviewReport(project);
  const pathRows = pathReport.rows.filter((row) => row.offlineDiagnosticsAvailable);
  const transportReadiness = shippedTransportReadinessReport();
  const monitorMatrix = monitorStateMatrixReport();
  const safetyEvidence = shippedControllerSafetyEvidenceReport();
  const onlineReadiness = shippedOnlineReadinessReport();

  const runAction = (action: Parameters<typeof runCommunicationAction>[0]) => {
    void runCommunicationAction(action).then((result) => onToast(result.kind, result.message));
  };
  const run = (command: (typeof commands)[number]["command"]) => {
    if (command.kind === "go-offline") {
      runAction("go-offline");
      return;
    }
    const result = runCommand(command);
    if (result.outcome === "blocked") {
      onToast("warning", `${command.label} is blocked: ${result.message}`);
    } else {
      onToast("success", result.message);
    }
  };

  return (
    <div className="esco-controller">
      {virtual ? <VirtualControllerPanel virtual={virtual} onToast={onToast} onLoadUploaded={onLoadUploaded} /> : null}
      <div className="esco-dockbar">
        <span className="esco-controller__state">
          Connection:{" "}
          <strong className={`esco-conn-badge ${STATE_CLASS[snapshot.state] ?? ""}`}>{snapshot.stateLabel}</strong>
          <span className="esco-dockbar__muted">
            {" "}
            via {snapshot.transportName} ({TRANSPORT_KIND_LABEL[snapshot.transportKind] ?? snapshot.transportKind})
          </span>
        </span>
        <div className="esco-dockbar__actions">
          <button type="button" className="esco-btn" onClick={() => runAction("go-online-simulation")}>
            Go Online (Simulation)
          </button>
          <button
            type="button"
            className="esco-btn"
            onClick={() => runAction("go-online")}
            title="Check whether a verified hardware link is available"
          >
            Check Hardware Link
          </button>
          <button type="button" className="esco-btn" onClick={() => runAction("monitor")} disabled={!snapshot.connected}>
            Monitor
          </button>
          <button type="button" className="esco-btn" onClick={() => runAction("go-offline")}>
            Go Offline
          </button>
        </div>
      </div>

      <p className="esco-controller__notice">
        This build has <strong>no tested controller transport</strong>. Hardware Go Online, upload, download,
        mode changes, fault commands, path diagnostics, and online edits are intentionally blocked. Offline
        Simulation and model-only review never communicate with a controller.
      </p>

      <section className="esco-controller__transport esco-controller__online-readiness" aria-label="Online readiness">
        <div className="esco-controller__pathdiag-head">
          <h4>Online Readiness</h4>
          <span>
            {onlineReadiness.completedStageCount}/{onlineReadiness.stageCount} prepared,{" "}
            {onlineReadiness.blockedStageCount} blocked
          </span>
        </div>
        <p className="esco-controller__pathdiag-boundary">{onlineReadiness.summary}</p>
        <p className="esco-controller__pathdiag-boundary">
          Offline readiness scaffold only; the stages and topology below show what engineering work is prepared
          versus blocked before any future verified hardware online. They do not open, monitor, or imply a live
          controller connection — a green &ldquo;complete&rdquo; stage means the offline groundwork is done, never that a
          controller is connected.
        </p>
        <div className="esco-controller__topology" aria-label="Online readiness connection topology">
          {onlineReadiness.topology.edges.map((edge) => {
            const from = onlineReadiness.topology.nodes.find((node) => node.id === edge.from);
            const to = onlineReadiness.topology.nodes.find((node) => node.id === edge.to);
            return (
              <div key={`${edge.from}-${edge.to}`} className="esco-controller__topology-edge">
                <span className={`esco-controller__topology-node ${ONLINE_STAGE_CLASS[from?.status ?? "blocked"] ?? ""}`}>
                  {from?.label ?? edge.from}
                </span>
                <span className={`esco-controller__topology-link ${ONLINE_STAGE_CLASS[edge.status] ?? ""}`}>
                  {edge.label}
                </span>
                <span className={`esco-controller__topology-node ${ONLINE_STAGE_CLASS[to?.status ?? "blocked"] ?? ""}`}>
                  {to?.label ?? edge.to}
                </span>
              </div>
            );
          })}
        </div>
        <div className="esco-controller__transport-list">
          {onlineReadiness.stages.map((stage) => (
            <article key={stage.id} className={`esco-controller__transport-row ${ONLINE_STAGE_CLASS[stage.status] ?? ""}`}>
              <div className="esco-controller__transport-head">
                <strong>{stage.label}</strong>
                <span className={`esco-conn-badge ${ONLINE_STAGE_CLASS[stage.status] ?? ""}`}>
                  {stage.status}
                </span>
              </div>
              <p className="esco-controller__transport-summary">{stage.summary}</p>
              <div className="esco-controller__transport-blockers" aria-label={`${stage.label} evidence`}>
                {stage.evidence.map((item) => (
                  <span key={`${stage.id}-${item}`} className={`esco-pill${stage.status === "blocked" ? " esco-pill--blocked" : ""}`}>
                    {item}
                  </span>
                ))}
              </div>
              <p className="esco-controller__transport-next">{stage.nextStep}</p>
            </article>
          ))}
        </div>
        <p className="esco-controller__transport-next">{onlineReadiness.nextStep}</p>
      </section>

      <section className="esco-controller__transport esco-controller__safety-evidence" aria-label="Controller safety evidence">
        <div className="esco-controller__pathdiag-head">
          <h4>Controller Safety Evidence</h4>
          <span>
            {safetyEvidence.verifiedPhysicalProviderCount} verified physical, {safetyEvidence.blockedBoundaryCount}/
            {safetyEvidence.physicalBoundaryCount} hard boundaries blocked
          </span>
        </div>
        <p className="esco-controller__pathdiag-boundary">{safetyEvidence.summary}</p>
        <dl className="esco-controller__safety-metrics">
          <div>
            <dt>Real transport gate</dt>
            <dd className={`esco-conn-badge ${safetyEvidence.realTransportGate === "blocked" ? "is-blocked" : "is-connected"}`}>
              {safetyEvidence.realTransportGate}
            </dd>
          </div>
          <div>
            <dt>Physical commands</dt>
            <dd>
              {safetyEvidence.blockedPhysicalCommandRows}/{safetyEvidence.totalPhysicalCommandRows} blocked
            </dd>
          </div>
          <div>
            <dt>Software providers</dt>
            <dd>{safetyEvidence.verifiedSoftwareProviderCount} verified software-only</dd>
          </div>
          <div>
            <dt>Driver descriptors</dt>
            <dd>
              {safetyEvidence.readyShippedDriverCount}/{safetyEvidence.shippedDriverCount} ready
            </dd>
          </div>
          <div>
            <dt>Monitor gates</dt>
            <dd>{safetyEvidence.blockedMonitorReadGates} blocked read gates</dd>
          </div>
        </dl>
        <div className="esco-controller__safety-grid">
          <div className="esco-controller__safety-box">
            <strong>Shipped providers</strong>
            <div className="esco-controller__safety-list">
              {safetyEvidence.providerRows.map((row) => (
                <span key={row.id} className={`esco-pill ${row.physicalTransportReady ? "" : "esco-pill--blocked"}`}>
                  {row.name}: {row.classification}
                </span>
              ))}
            </div>
          </div>
          <div className="esco-controller__safety-box">
            <strong>Hard boundaries</strong>
            <div className="esco-controller__safety-list" aria-label="Controller hard-boundary rows">
              {safetyEvidence.boundaryRows.map((row) => (
                <span
                  key={row.id}
                  className={`esco-pill ${row.status === "blocked" ? "esco-pill--blocked" : ""}`}
                  title={row.evidence}
                >
                  {row.label}: {row.status}
                </span>
              ))}
            </div>
          </div>
          <div className="esco-controller__safety-box">
            <strong>Driver descriptors</strong>
            <div className="esco-controller__safety-list" aria-label="Controller shipped driver descriptors">
              {safetyEvidence.driverRows.map((row) => (
                <span
                  key={row.id}
                  className={`esco-pill ${row.ready ? "" : "esco-pill--blocked"}`}
                  title={row.message}
                >
                  {row.id}: {row.readiness}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="esco-controller__invariants" aria-label="Controller safety invariants">
          {safetyEvidence.invariantRows.map((row) => (
            <span key={row.id} className={`esco-controller__invariant ${row.passed ? "is-pass" : "is-fail"}`} title={row.detail}>
              {row.passed ? "Pass" : "Fail"} - {row.label}
            </span>
          ))}
        </div>
        <p className="esco-controller__transport-next">{safetyEvidence.nextStep}</p>
      </section>

      <section className="esco-controller__transport" aria-label="Transport readiness">
        <div className="esco-controller__pathdiag-head">
          <h4>Transport Readiness ({transportReadiness.transportCount})</h4>
          <span>
            {transportReadiness.verifiedRealTransportCount} verified real, {transportReadiness.blockedRealCommandCount} real-command blocks
          </span>
        </div>
        <div className="esco-controller__transport-list">
          {transportReadiness.rows.map((row) => {
            const blockers = Object.entries(row.blockerCounts).filter(([, count]) => count > 0) as [NonNullable<BlockedReason>, number][];
            return (
              <article key={row.id} className={`esco-controller__transport-row ${READINESS_CLASS[row.status] ?? ""}`}>
                <div className="esco-controller__transport-head">
                  <strong>{row.displayName}</strong>
                  <span className={`esco-conn-badge ${READINESS_CLASS[row.status] ?? ""}`}>
                    {READINESS_LABEL[row.status] ?? row.status}
                  </span>
                </div>
                <dl className="esco-controller__transport-metrics">
                  <div>
                    <dt>Real I/O</dt>
                    <dd>{row.capabilities.realControllerIo ? "yes" : "no"}</dd>
                  </div>
                  <div>
                    <dt>Verified</dt>
                    <dd>{row.capabilities.verified ? "yes" : "no"}</dd>
                  </div>
                  <div>
                    <dt>Commands</dt>
                    <dd>
                      {row.availableCommandCount}/{row.commandCount}
                    </dd>
                  </div>
                  <div>
                    <dt>Real blocks</dt>
                    <dd>
                      {row.blockedRealCommandCount}/{row.realCommandCount}
                    </dd>
                  </div>
                </dl>
                <p className="esco-controller__transport-summary">{row.summary}</p>
                {blockers.length ? (
                  <div className="esco-controller__transport-blockers" aria-label={`${row.displayName} command blockers`}>
                    {blockers.slice(0, 4).map(([reason, count]) => (
                      <span key={`${row.id}-${reason}`} className="esco-pill esco-pill--blocked">
                        {BLOCKER_LABEL[reason]} x {count}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="esco-controller__transport-next">{row.nextStep}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="esco-controller__transport esco-controller__monitor-matrix" aria-label="Monitor state matrix">
        <div className="esco-controller__pathdiag-head">
          <h4>Monitor State Matrix ({monitorMatrix.scenarioCount})</h4>
          <span>
            {monitorMatrix.verifiedRealScenarioCount} verified read-only scenarios, {monitorMatrix.blockedReadCount} blocked read gates
          </span>
        </div>
        <p className="esco-controller__pathdiag-boundary">
          Offline report only; these rows model monitor/fault-state gating and do not select or create a physical controller transport.
        </p>
        <div className="esco-controller__transport-list">
          {monitorMatrix.rows.map((row) => {
            const rowClass =
              row.state === "model-only"
                ? "is-model-only"
                : row.firstBlocker
                  ? "is-blocked"
                  : row.realControllerIo
                    ? "is-connected"
                    : "is-sim";
            return (
              <article key={row.id} className={`esco-controller__transport-row ${rowClass}`}>
                <div className="esco-controller__transport-head">
                  <strong>{row.label}</strong>
                  <span className={`esco-conn-badge ${STATE_CLASS[row.state] ?? ""}`}>{row.stateLabel}</span>
                </div>
                <dl className="esco-controller__transport-metrics">
                  <div>
                    <dt>Monitor</dt>
                    <dd>{row.monitorAvailable ? "ready" : "blocked"}</dd>
                  </div>
                  <div>
                    <dt>Fault reads</dt>
                    <dd>{row.faultDiagnosticsAvailable ? "ready" : "blocked"}</dd>
                  </div>
                  <div>
                    <dt>Go offline</dt>
                    <dd>{row.goOfflineAvailable ? "ready" : "blocked"}</dd>
                  </div>
                  <div>
                    <dt>Download</dt>
                    <dd>{row.downloadBlocked ? "blocked" : "ready"}</dd>
                  </div>
                </dl>
                <p className="esco-controller__transport-summary">{row.summary}</p>
                <div className="esco-controller__monitor-cells" aria-label={`${row.label} monitor command gates`}>
                  {row.cells.map((cell) => (
                    <span
                      key={`${row.id}-${cell.commandKind}`}
                      className={`esco-pill${cell.available ? "" : " esco-pill--blocked"}`}
                      title={cell.available ? cell.explanation : `${cell.explanation} ${cell.reason ? BLOCKER_LABEL[cell.reason] : ""}`}
                    >
                      {cell.label}: {cell.available ? "ready" : cell.reason ? BLOCKER_LABEL[cell.reason] : "blocked"}
                    </span>
                  ))}
                </div>
                <p className="esco-controller__transport-next">{row.nextStep}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="esco-controller__pathdiag" aria-label="Imported controller path diagnostics">
        <div className="esco-controller__pathdiag-head">
          <h4>Imported Path Diagnostics ({pathReport.metadataCount})</h4>
          <span>
            {pathReport.reviewableCount} reviewable, {pathReport.issueCount} need attention
          </span>
        </div>
        <p className="esco-controller__pathdiag-boundary">
          Offline review only; no path browse, no online connection, no driver validation, and no download target selection is performed.
        </p>
        {pathRows.length === 0 ? (
          <p className="esco-empty">No imported CommPath/CommDriver metadata is available for offline route review.</p>
        ) : (
          <div className="esco-controller__pathdiag-list">
            {pathRows.map((row) => (
              <article key={row.controllerId} className={`esco-controller__pathdiag-row is-${row.status}`}>
                <div className="esco-controller__pathdiag-title">
                  <strong>{row.controllerName}</strong>
                  <span className="esco-pill">{row.routeFamily}</span>
                  <span className={`esco-pill${row.status === "needs-attention" ? " esco-pill--blocked" : ""}`}>
                    {row.status}
                  </span>
                </div>
                <dl className="esco-controller__route">
                  <div>
                    <dt>Driver</dt>
                    <dd>{row.commDriver ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Path</dt>
                    <dd>{row.commPath ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Route</dt>
                    <dd>{row.routeSummary}</dd>
                  </div>
                  <div>
                    <dt>Driver match</dt>
                    <dd>{row.commPathPresent && row.commDriverPresent ? (row.driverPathMatches ? "yes" : "no") : "unavailable"}</dd>
                  </div>
                </dl>
                {row.routeSegments.length ? (
                  <div className="esco-controller__route-segments" aria-label={`${row.controllerName} route segments`}>
                    {row.routeSegments.map((segment) => (
                      <span
                        key={`${row.controllerId}-${segment.index}-${segment.value}`}
                        className={`esco-controller__route-segment is-${segment.kind}`}
                        title={segment.kind}
                      >
                        <span>{segment.label}</span>
                        <strong>{segment.value}</strong>
                      </span>
                    ))}
                  </div>
                ) : null}
                {row.issues.length ? (
                  <p className="esco-controller__pathdiag-issues">{row.message}</p>
                ) : (
                  <p className="esco-controller__pathdiag-message">{row.message}</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="esco-controller__commands">
        {commands.map(({ command, blocked, explanation, risk, nextStep, preflight }) => {
          const passedChecks = preflight.checks.filter((check) => check.passed).length;
          const totalChecks = preflight.checks.length;
          return (
            <div key={command.kind} className={`esco-controller__cmd${blocked ? " is-blocked" : ""}`}>
              <div className="esco-controller__cmdhead">
                <span className="esco-controller__cmdlabel">
                  {escoControllerCommandDisplayLabel(command.kind, command.label)}
                </span>
                <span className={`esco-pill esco-pill--risk-${risk}`} title={`${RISK_LABEL[risk]} operation`}>
                  {RISK_LABEL[risk]}
                </span>
                {blocked ? <span className="esco-pill esco-pill--blocked">Blocked</span> : <span className="esco-pill">Available</span>}
              </div>
              <p className="esco-controller__cmddesc">{command.description}</p>
              <div className="esco-controller__cmdfoot">
                <button
                  type="button"
                  className={`esco-btn${blocked ? " esco-btn--blocked" : " esco-btn--primary"}`}
                  title={explanation}
                  onClick={() => run(command)}
                >
                  {blocked ? "Show safety block" : command.label}
                </button>
              </div>
              {blocked ? (
                <dl className="esco-controller__guard">
                  <div>
                    <dt>Reason blocked</dt>
                    <dd>{explanation}</dd>
                  </div>
                  <div>
                    <dt>Required next step</dt>
                    <dd>{nextStep}</dd>
                  </div>
                </dl>
              ) : null}
              <details className="esco-controller__preflight">
                <summary>
                  Commissioning preflight — {passedChecks}/{totalChecks} checks passed
                </summary>
                <ol className="esco-controller__preflight-list">
                  {preflight.checks.map((check) => (
                    <li
                      key={check.id}
                      className={`esco-controller__preflight-check is-${check.passed ? "pass" : "fail"}`}
                    >
                      <span className="esco-controller__preflight-mark" aria-hidden="true">
                        {check.passed ? "✓" : "✗"}
                      </span>
                      <span className="esco-controller__preflight-text">
                        <strong>{check.label}</strong>
                        <span className="esco-controller__preflight-detail">{check.detail}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            </div>
          );
        })}
      </div>

      <div className="esco-controller__audit">
        <h4>Connection audit ({audit.length})</h4>
        {audit.length === 0 ? (
          <p className="esco-empty">No connection events yet. Check the hardware link or attempt a guarded command.</p>
        ) : (
          <table className="esco-diagnostics__table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Status</th>
                <th>State</th>
                <th>Transport</th>
                <th>Risk</th>
                <th>Reason</th>
                <th>Summary / next step</th>
              </tr>
            </thead>
            <tbody>
              {audit
                .slice()
                .reverse()
                .map((event) => {
                  const details = (event.details ?? {}) as {
                    status?: string;
                    risk?: CommandRisk;
                    reason?: string | null;
                    nextStep?: string;
                    transportName?: string;
                  };
                  return (
                    <tr key={event.id}>
                      <td>{new Date(event.at).toLocaleTimeString()}</td>
                      <td>{event.type}</td>
                      <td>{details.status ?? (event.type === "command-blocked" ? "blocked" : event.type === "command-ran" ? "ran" : "logged")}</td>
                      <td>{event.state}</td>
                      <td>{details.transportName ?? TRANSPORT_KIND_LABEL[event.transportKind] ?? event.transportKind}</td>
                      <td>{details.risk ? RISK_LABEL[details.risk] : "—"}</td>
                      <td>{details.reason ?? "—"}</td>
                      <td>
                        {event.summary}
                        {details.nextStep ? <span className="esco-controller__auditnext"> → {details.nextStep}</span> : null}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
