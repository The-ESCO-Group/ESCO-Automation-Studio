import { useState } from "react";
import type { ControllerMode, VirtualControllerState } from "@esco/controller-comm";
import {
  CONTROLLER_MODE_LABELS,
  SOFT_CONTROLLER_CONNECTION_CAPABILITIES,
  physicalCommandGuardReport,
} from "@esco/controller-comm";
import {
  virtualCommPathDisplayLabel,
  type SoftControllerUploadResult,
  type VirtualControllerApi,
} from "../virtual-controller-session";
import "./VirtualControllerPanel.css";

interface Props {
  virtual: VirtualControllerApi;
  onToast: (kind: "info" | "success" | "warning" | "error", message: string) => void;
  /** Load an uploaded project image for inspection (read-only). */
  onLoadUploaded?: (payload: string) => void;
}

const STATE_CLASS: Record<VirtualControllerState, string> = {
  disconnected: "is-offline",
  browsing: "is-busy",
  "path-selected": "is-pending",
  connecting: "is-busy",
  online: "is-online",
  monitoring: "is-online",
  uploading: "is-busy",
  downloading: "is-busy",
  faulted: "is-error",
  error: "is-error",
};

const MODES: ControllerMode[] = ["program", "run", "remote-program", "remote-run"];
const SOFT_CONTROLLER_PHYSICAL_GUARD = physicalCommandGuardReport({
  id: "esco.soft-controller",
  name: "ESCO SoftController",
  kind: "soft-controller",
  capabilities: SOFT_CONTROLLER_CONNECTION_CAPABILITIES,
});

const dt = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString() : "—");
const dtt = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "—");
const monitorValue = (value: unknown) => {
  if (value === undefined) return "—";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
};

/**
 * ESCO Virtual Controller panel — the offline/virtual session workflow:
 * virtual path selection, Go Online (Virtual), virtual Download/Upload, virtual
 * mode, virtual faults, connection health, and an activity log. This is an
 * ESCO-owned virtual backend and is branded as such; it never communicates with
 * real hardware.
 */
export function VirtualControllerPanel({ virtual, onToast, onLoadUploaded }: Props) {
  const { snapshot } = virtual;
  const [softUpload, setSoftUpload] = useState<SoftControllerUploadResult | null>(null);
  const softwareGuard = virtual.softwareGuardReport;
  const toast = (r: { level: "info" | "success" | "warning" | "error"; message: string }) => onToast(r.level, r.message);
  const knownVirtualPaths = [...virtual.availablePaths, ...(snapshot.path ? [snapshot.path] : [])];
  const virtualText = (text: string) =>
    knownVirtualPaths.reduce(
      (next, path) => next.split(path.label).join(virtualCommPathDisplayLabel(path)),
      text,
    );

  const handleUpload = () => {
    const result = virtual.upload();
    toast(result);
    if (result.uploaded?.payload && onLoadUploaded) {
      onLoadUploaded(result.uploaded.payload);
    }
  };
  const handleSoftControllerDownload = () => {
    const result = virtual.downloadRuntimeToSoftController();
    const level = result.ok ? "success" : result.outcome === "failed" ? "error" : "warning";
    onToast(level, result.error ? `${result.message} ${result.error}` : result.message);
  };
  const handleSoftControllerUpload = () => {
    const result = virtual.uploadFromSoftController();
    if (!result.ok || !result.data) {
      onToast("error", result.error ?? "Could not upload from the ESCO SoftController.");
      return;
    }
    setSoftUpload(result);
  };
  const handleSoftControllerRestore = () => {
    const result = virtual.restorePreviousSoftControllerRuntime();
    const level = result.ok ? "success" : result.outcome === "failed" ? "error" : "warning";
    onToast(level, result.error ? `${result.message} ${result.error}` : result.message);
  };
  const cancelSoftControllerUpload = () => setSoftUpload(null);
  const confirmSoftControllerUpload = () => {
    if (!softUpload?.data) return;
    if (!onLoadUploaded) {
      onToast("error", "The web project opener is not available for SoftController upload.");
      return;
    }
    onLoadUploaded(softUpload.data.payload);
    setSoftUpload(null);
  };
  const handleSelectPath = (pathId: string) => {
    const result = virtual.selectPath(pathId);
    const path = result.snapshot.path;
    toast(
      result.ok && path
        ? { ...result, message: `Virtual path selected - ${virtualCommPathDisplayLabel(path)}.` }
        : result,
    );
  };
  const handleSoftControllerStart = () => {
    const result = virtual.startSoftControllerScan();
    onToast(result.ok ? "success" : "warning", result.message);
  };
  const handleSoftControllerScanOnce = () => {
    const result = virtual.scanSoftControllerOnce();
    onToast(result.ok ? "success" : "warning", result.message);
  };
  const handleSoftControllerStop = () => {
    const result = virtual.stopSoftControllerScan();
    onToast(result.ok ? "success" : "warning", result.message);
  };

  const matchBadge = () => {
    if (!snapshot.online || snapshot.matchStatus === null) return null;
    const label =
      snapshot.matchStatus === "matched"
        ? "Project matches virtual controller"
        : snapshot.matchStatus === "mismatch"
          ? "Offline project differs from virtual controller"
          : "No project downloaded";
    return <span className={`esco-vctrl__match is-${snapshot.matchStatus}`}>{label}</span>;
  };

  return (
    <section className="esco-vctrl" aria-label="ESCO Virtual Controller">
      <header className="esco-vctrl__head">
        <div className="esco-vctrl__title">
          <strong>ESCO Virtual Controller</strong>
          <span className="esco-vctrl__sub">Offline Driver · Simulation Session — no real hardware transport</span>
        </div>
        <span className={`esco-vctrl__state ${STATE_CLASS[snapshot.state]}`}>{snapshot.stateLabel}</span>
      </header>

      <div className="esco-vctrl__identity">
        <span>
          Virtual controller: <strong>{snapshot.identity?.name ?? "—"}</strong>
          {snapshot.identity ? ` (${snapshot.identity.catalogNumber}, FW ${snapshot.identity.firmwareRevision})` : ""}
        </span>
        <span>
          Mode: <strong>{snapshot.modeLabel}</strong>
          {snapshot.editsLocked ? <span className="esco-vctrl__lock"> · edits read-only (scanning)</span> : null}
        </span>
        <span>
          Health: <strong>{snapshot.health}</strong>
        </span>
        {matchBadge()}
      </div>
      <div className="esco-vctrl__integration" role="status">
        ESCO SoftController upload/download uses the scan-capable local software runtime. Physical controller
        hardware remains unsupported.
      </div>
      <div className="esco-vctrl__guard" role="status">
        <strong>Physical command guard</strong>
        <span>
          {SOFT_CONTROLLER_PHYSICAL_GUARD.blockedPhysicalCommands}/
          {SOFT_CONTROLLER_PHYSICAL_GUARD.totalPhysicalCommands} physical-controller commands blocked
        </span>
        <span>Verified software only; real-transport gate remains red.</span>
      </div>
      <div className="esco-vctrl__guard esco-vctrl__guard--software" role="status">
        <strong>Software command guard</strong>
        <span>
          {softwareGuard.availableSoftwareCommands}/{softwareGuard.totalSoftwareCommands} virtual/software commands ready
        </span>
        <span>{softwareGuard.blockedSoftwareCommands} blocked by current software state</span>
        <span>Physical hardware excluded from every row.</span>
      </div>
      <details className="esco-vctrl__guarddetails">
        <summary>Software command preflight</summary>
        <ul>
          {softwareGuard.rows.map((row) => (
            <li
              key={row.commandKind}
              className={`esco-vctrl__guardrow${row.available ? " is-ready" : " is-blocked"}`}
            >
              <span className={`esco-vctrl__risk is-${row.risk}`}>{row.risk}</span>
              <span className="esco-vctrl__guardlabel">{row.label}</span>
              <span className="esco-vctrl__guardsummary">{row.summary}</span>
            </li>
          ))}
        </ul>
      </details>

      {/* Path / ESCO Route Browser */}
      <div className="esco-vctrl__path">
        <span className="esco-vctrl__pathlabel">
          Virtual path: {snapshot.path ? virtualCommPathDisplayLabel(snapshot.path) : "No virtual path selected"}
        </span>
        <button type="button" className="esco-btn" onClick={() => toast(virtual.beginBrowsing())}>
          Select Virtual Path
        </button>
      </div>
      {snapshot.state === "browsing" ? (
        <ul className="esco-vctrl__paths">
          {virtual.availablePaths.map((path) => (
            <li key={path.id}>
              <button type="button" className="esco-btn esco-vctrl__pathpick" onClick={() => handleSelectPath(path.id)}>
                {virtualCommPathDisplayLabel(path)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Online / transfer actions */}
      <div className="esco-vctrl__actions">
        <button type="button" className="esco-btn esco-btn--primary" onClick={() => toast(virtual.goOnline())}>
          Go Online (Virtual)
        </button>
        <button type="button" className="esco-btn" onClick={() => toast(virtual.monitor())} disabled={!snapshot.online}>
          Monitor (Virtual)
        </button>
        <button type="button" className="esco-btn" onClick={() => toast(virtual.download())}>
          Download to Virtual
        </button>
        <button type="button" className="esco-btn" onClick={handleUpload}>
          Upload from Virtual
        </button>
        <button type="button" className="esco-btn" onClick={() => toast(virtual.goOffline())}>
          Go Offline (Virtual)
        </button>
        <button
          type="button"
          className="esco-btn"
          title="Build the project's .easruntime and download it into the ESCO SoftController (software, not hardware)."
          onClick={handleSoftControllerDownload}
        >
          Download Runtime to ESCO SoftController
        </button>
        <button
          type="button"
          className="esco-btn"
          title="Read the ESCO SoftController software runtime image and preview the reconstructed project before replacing the open project."
          onClick={handleSoftControllerUpload}
        >
          Upload from ESCO SoftController
        </button>
        {virtual.restorableSoftControllerBackup ? (
          <button
            type="button"
            className="esco-btn"
            title={`Restore ${virtual.restorableSoftControllerBackup.projectName ?? "the previous runtime"} from the local software rollback backup.`}
            onClick={handleSoftControllerRestore}
          >
            Restore Previous Runtime
          </button>
        ) : null}
      </div>

      {/* ESCO SoftController runtime download status (software target — never hardware) */}
      {virtual.softControllerDownload ? (
        <div className="esco-vctrl__scdl">
          <span>
            SoftController runtime download:{" "}
            <strong>{virtual.softControllerDownload.outcome}</strong>
            {` (stage: ${virtual.softControllerDownload.stage})`}
          </span>
          {virtual.softControllerDownload.preflight.checksum ? (
            <span className="esco-vctrl__mono">
              checksum {virtual.softControllerDownload.preflight.checksum.slice(0, 16)}…
              {virtual.softControllerDownload.transfer
                ? virtual.softControllerDownload.transfer.checksumValid
                  ? " ✓ verified on target"
                  : " ✗ mismatch on target"
                : ""}
            </span>
          ) : null}
          {virtual.softControllerDownload.backup ? (
            <span>backup {virtual.softControllerDownload.backup.id}</span>
          ) : null}
          {virtual.restorableSoftControllerBackup ? (
            <span className="esco-vctrl__restore-note">
              restore available: {virtual.restorableSoftControllerBackup.projectName ?? "previous runtime"}
            </span>
          ) : null}
          {virtual.softControllerDownload.warnings.length ? (
            <span>{virtual.softControllerDownload.warnings.length} warning(s)</span>
          ) : null}
        </div>
      ) : null}

      <section className="esco-vctrl__scmon" aria-label="ESCO SoftController live software runtime monitor">
        <header className="esco-vctrl__scmonhead">
          <div>
            <strong>Live Software Runtime Monitor</strong>
            <span>ESCO SoftController · no physical controller transport</span>
          </div>
          <span className={`esco-vctrl__scmonmode is-${virtual.softControllerMonitor.mode}`}>
            {virtual.softControllerMonitor.mode}
          </span>
        </header>
        <div className="esco-vctrl__scmonactions">
          <button
            type="button"
            className="esco-btn"
            onClick={handleSoftControllerStart}
            disabled={!virtual.softControllerMonitor.runtimeLoaded || virtual.softControllerMonitor.running}
          >
            Start Scan
          </button>
          <button
            type="button"
            className="esco-btn"
            onClick={handleSoftControllerScanOnce}
            disabled={!virtual.softControllerMonitor.runtimeLoaded || !virtual.softControllerMonitor.running}
          >
            Scan Once
          </button>
          <button
            type="button"
            className="esco-btn"
            onClick={handleSoftControllerStop}
            disabled={!virtual.softControllerMonitor.runtimeLoaded || !virtual.softControllerMonitor.running}
          >
            Stop Scan
          </button>
        </div>
        <dl className="esco-vctrl__scmonfacts">
          <div>
            <dt>Runtime</dt>
            <dd>{virtual.softControllerMonitor.runtime?.projectName ?? "Not loaded"}</dd>
          </div>
          <div>
            <dt>Tags</dt>
            <dd>{virtual.softControllerMonitor.tagCount}</dd>
          </div>
          <div>
            <dt>Scans</dt>
            <dd>{virtual.softControllerMonitor.scanCount}</dd>
          </div>
          <div>
            <dt>Last step</dt>
            <dd>{virtual.softControllerMonitor.lastScanMs} ms</dd>
          </div>
          <div>
            <dt>Faults</dt>
            <dd>{virtual.softControllerMonitor.faultCount}</dd>
          </div>
          <div>
            <dt>Checksum</dt>
            <dd className="esco-vctrl__mono">
              {virtual.softControllerMonitor.runtime?.checksum
                ? `${virtual.softControllerMonitor.runtime.checksum.slice(0, 12)}…`
                : "—"}
            </dd>
          </div>
        </dl>
        {virtual.softControllerMonitor.tagRows.length ? (
          <table className="esco-vctrl__scmontags">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Type</th>
                <th>Scope</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {virtual.softControllerMonitor.tagRows.map((tag) => (
                <tr key={tag.path}>
                  <td className="esco-vctrl__mono">{tag.path}</td>
                  <td>{tag.dataType}</td>
                  <td>{tag.scope === "program" ? tag.programName ?? "Program" : "Controller"}</td>
                  <td className="esco-vctrl__mono">{monitorValue(tag.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="esco-vctrl__scmonempty">{virtual.softControllerMonitor.message}</div>
        )}
      </section>

      {softUpload?.data ? (
        <div className="esco-modal esco-vctrl-upload" role="presentation">
          <section
            className="esco-modal__panel esco-vctrl-upload__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="esco-vctrl-upload-title"
          >
            <header className="esco-modal__header">
              <div>
                <span className="esco-modal__eyebrow">ESCO SoftController Upload</span>
                <h2 id="esco-vctrl-upload-title">Preview Reconstructed Project</h2>
              </div>
              <button
                type="button"
                className="esco-icon-btn"
                aria-label="Cancel SoftController upload"
                onClick={cancelSoftControllerUpload}
              >
                X
              </button>
            </header>
            <div className="esco-vctrl-upload__body">
              <p className="esco-vctrl-upload__summary">
                Review the software runtime image before replacing the active project. This upload reads only the ESCO
                SoftController image; it does not imply a physical controller connection.
              </p>
              <dl className="esco-vctrl-upload__facts">
                <div>
                  <dt>Project</dt>
                  <dd>{softUpload.data.preview.projectName}</dd>
                </div>
                <div>
                  <dt>Controller</dt>
                  <dd>{softUpload.data.preview.controllerName ?? "—"}</dd>
                </div>
                <div>
                  <dt>Checksum valid</dt>
                  <dd className={softUpload.data.preview.checksumValid ? "is-ok" : "is-error"}>
                    {softUpload.data.preview.checksumValid ? "Yes" : "No"}
                  </dd>
                </div>
                <div>
                  <dt>Runtime checksum</dt>
                  <dd className="esco-vctrl__mono">{softUpload.data.preview.runtimeChecksum || "—"}</dd>
                </div>
              </dl>
              <div className="esco-vctrl-upload__counts" aria-label="Reconstructed counts">
                <span><strong>{softUpload.data.preview.counts.controllers}</strong> controller(s)</span>
                <span><strong>{softUpload.data.preview.counts.tasks}</strong> task(s)</span>
                <span><strong>{softUpload.data.preview.counts.programs}</strong> program(s)</span>
                <span><strong>{softUpload.data.preview.counts.routines}</strong> routine(s)</span>
                <span><strong>{softUpload.data.preview.counts.tags}</strong> tag(s)</span>
                <span><strong>{softUpload.data.preview.counts.ioModules}</strong> I/O module(s)</span>
                <span>
                  <strong>{softUpload.data.preview.counts.hmiReferences}</strong>{" "}
                  {softUpload.data.preview.hmiProjectReconstructed ? "HMI screen(s)" : "HMI reference(s)"}
                </span>
                <span><strong>{softUpload.data.preview.counts.warnings}</strong> warning(s)</span>
              </div>
              <dl className="esco-vctrl-upload__provenance">
                <div>
                  <dt>Source</dt>
                  <dd>ESCO SoftController software runtime image</dd>
                </div>
                <div>
                  <dt>Serial</dt>
                  <dd>{softUpload.data.preview.serialNumber ?? "Not reported"}</dd>
                </div>
                <div>
                  <dt>Firmware</dt>
                  <dd>{softUpload.data.preview.firmwareRevision ?? "Not reported"}</dd>
                </div>
                <div>
                  <dt>Runtime version</dt>
                  <dd>{softUpload.data.preview.runtimeVersion ?? "Not reported"}</dd>
                </div>
                <div>
                  <dt>Installed</dt>
                  <dd>{dtt(softUpload.data.preview.installedAt)}</dd>
                </div>
                <div>
                  <dt>Uploaded</dt>
                  <dd>{dtt(softUpload.data.preview.uploadedAt)}</dd>
                </div>
              </dl>
              {softUpload.data.preview.warnings.length ? (
                <div className="esco-vctrl-upload__warnings">
                  <h3>Warnings</h3>
                  <ul>
                    {softUpload.data.preview.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <footer className="esco-modal__footer">
              <div className="esco-modal__actions">
                <button type="button" className="esco-btn" onClick={cancelSoftControllerUpload}>
                  Cancel
                </button>
                <button type="button" className="esco-btn esco-btn--primary" onClick={confirmSoftControllerUpload}>
                  Replace/Open Reconstructed Project
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {/* Controller mode */}
      <div className="esco-vctrl__modes" role="group" aria-label="Controller mode">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            className={`esco-btn esco-vctrl__mode${snapshot.mode === mode ? " is-active" : ""}`}
            title="Simulation-only mode change on the ESCO Virtual Controller"
            onClick={() => toast(virtual.setMode(mode))}
          >
            {CONTROLLER_MODE_LABELS[mode]}
          </button>
        ))}
      </div>

      {/* Session data */}
      <dl className="esco-vctrl__data">
        <div><dt>Last online</dt><dd>{dt(snapshot.lastOnlineAt)}</dd></div>
        <div><dt>Last download</dt><dd>{dt(snapshot.lastDownloadAt)}</dd></div>
        <div><dt>Last upload</dt><dd>{dt(snapshot.lastUploadAt)}</dd></div>
        <div><dt>Online signature</dt><dd className="esco-vctrl__mono">{snapshot.onlineSignature ? snapshot.onlineSignature.slice(0, 16) : "—"}</dd></div>
        <div>
          <dt>Virtual image</dt>
          <dd>
            {snapshot.snapshot
              ? `${snapshot.snapshot.projectName} — ${snapshot.snapshot.summary.programCount} program(s), ${snapshot.snapshot.summary.routineCount} routine(s), ${snapshot.snapshot.summary.tagCount} tag(s)`
              : "No project downloaded"}
          </dd>
        </div>
      </dl>

      {/* Faults */}
      <div className="esco-vctrl__faults">
        <div className="esco-vctrl__faultshead">
          <h4>Virtual faults ({snapshot.faults.length})</h4>
          <button type="button" className="esco-btn" onClick={() => toast(virtual.clearFaults())} disabled={snapshot.faults.length === 0}>
            Clear Virtual Faults
          </button>
        </div>
        {snapshot.faults.length === 0 ? (
          <p className="esco-empty">No active faults on the ESCO Virtual Controller.</p>
        ) : (
          <ul className="esco-vctrl__faultlist">
            {snapshot.faults.map((fault) => (
              <li key={fault.id} className={`esco-vctrl__fault is-${fault.severity}`}>
                <span className="esco-vctrl__faultcode">{fault.code}</span>
                <span className="esco-vctrl__faultmsg">{fault.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Activity log */}
      <div className="esco-vctrl__log">
        <h4>Session log ({snapshot.log.length})</h4>
        {snapshot.log.length === 0 ? (
          <p className="esco-empty">No session activity yet. Select a virtual path, then Go Online (Virtual) or Download to Virtual.</p>
        ) : (
          <ul className="esco-vctrl__loglist">
            {snapshot.log
              .slice()
              .reverse()
              .slice(0, 30)
              .map((entry) => (
                <li key={entry.id} className={`esco-vctrl__logentry is-${entry.level}`}>
                  <span className="esco-vctrl__logtime">{new Date(entry.at).toLocaleTimeString()}</span>
                  <span className="esco-vctrl__logaction">{entry.action}</span>
                  <span className="esco-vctrl__logmsg">{virtualText(entry.message)}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}
