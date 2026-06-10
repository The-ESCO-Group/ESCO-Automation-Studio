/**
 * ESCO Online panel — the visible surface of Goal B's read-only online mode.
 *
 * Renders ONLY what the ESCO Online Session Manager exposes
 * (`useEscoGateway()`); it never imports a driver, never fetches directly,
 * and offers no write affordance of any kind. Connect → Online Read-Only is
 * the designed ceiling of this milestone (rule 7): a match with the local
 * project cannot be proven over the wire yet, so writes stay impossible
 * end to end.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type CompareResult,
  type ConnectionConfig,
  type ControllerConnectionEvidence,
  type ControllerDriverCapabilities,
  type ControllerDriverSummary,
  type ControllerIdentity,
  type OnlineAuditEntry,
  ONLINE_CONNECTION_STATE_LABELS,
  type TagDefinition,
  type TagValue,
} from "../../gateway-contract";
import type { PlcProject } from "@esco/core";
import { useEscoGateway } from "../../use-esco-gateway";
import "./esco-online.css";

const WATCH_LIST_STORAGE_KEY = "esco.online.watchList.v1";
const WATCH_LIST_COLLECTION_STORAGE_KEY = "esco.online.watchLists.v1";
const WATCH_LIST_EXPORT_SCHEMA = "esco.online.watchList.v1";

const ALL_PUBLIC_MUTATIONS_BLOCKED = {
  canWriteTags: false,
  canDownloadProject: false,
  canOnlineEdit: false,
  canForceTags: false,
  canModeChange: false,
  canClearFaults: false,
} as const;

const FALLBACK_CONNECTION_EVIDENCE: ControllerConnectionEvidence = {
  transportValidation: "software-wired",
  realControllerIo: true,
  hardwareValidated: false,
  verified: false,
  label: "Software-wired, not field-validated",
  message:
    "The ESCO gateway API has not provided validation evidence yet; treat this online path as software-wired only.",
  limitations: ["No plant-readiness proof is attached.", "Writes and downloads remain blocked."],
};

const FALLBACK_DRIVER_SUMMARY: ControllerDriverSummary = {
  id: "ethernetip-cip-readonly",
  name: "ESCO EtherNet/IP CIP Read-Only Driver",
  kind: "ethernetip",
  readOnly: true,
  safetyNote: "Public ESCO online mode is read-only; start the API host for the verified backend driver registry.",
  connectionEvidence: FALLBACK_CONNECTION_EVIDENCE,
  capabilities: {
    canConnect: true,
    canReadStatus: true,
    canReadFaults: true,
    canBrowseTags: true,
    canReadTags: true,
    canBatchReadTags: true,
    canSubscribeTags: true,
    canUploadSnapshot: false,
    canCompareProject: true,
    ...ALL_PUBLIC_MUTATIONS_BLOCKED,
  },
};

const PLACEHOLDER_DRIVER_IDS = new Set(["opcda-legacy-placeholder"]);

interface EscoOnlinePanelProps {
  localProject?: PlcProject;
  focusPathRequestId?: number;
}

export function EscoOnlinePanel({ localProject, focusPathRequestId = 0 }: EscoOnlinePanelProps) {
  const gateway = useEscoGateway();
  const { state } = gateway;
  const endpointInputRef = useRef<HTMLInputElement | null>(null);
  const watchListFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastPathFocusRequestRef = useRef(0);
  const [driverId, setDriverId] = useState("ethernetip-cip-readonly");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [routePath, setRoutePath] = useState("");
  const [opcUaRootNodeId, setOpcUaRootNodeId] = useState("");
  const [opcUaSamplingIntervalMs, setOpcUaSamplingIntervalMs] = useState("500");
  const [opcUaNodeMapText, setOpcUaNodeMapText] = useState("");
  const [localConfigError, setLocalConfigError] = useState<string | undefined>();
  const [tagFilter, setTagFilter] = useState("");
  const [manualWatchTag, setManualWatchTag] = useState("");
  const [watchList, setWatchList] = useState<string[]>(() => readSavedWatchList("ethernetip-cip-readonly"));
  const [watchListStatus, setWatchListStatus] = useState<string | undefined>();

  useEffect(() => {
    void gateway.refreshAvailability();
    // The shared session refreshes once per mount; manual buttons cover the
    // rest. Leaving the view stops any watch loop — monitoring should be
    // deliberate and visible, never a background surprise.
    return () => {
      gateway.stopTagPolling();
      gateway.stopTagStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (focusPathRequestId <= 0 || focusPathRequestId === lastPathFocusRequestRef.current) return;
    if (state.busy) return;
    lastPathFocusRequestRef.current = focusPathRequestId;
    window.setTimeout(() => endpointInputRef.current?.focus(), 0);
  }, [focusPathRequestId, state.busy]);

  const snapshot = state.snapshot;
  const online = snapshot?.state.startsWith("online-") === true;
  const stateLabel = snapshot ? ONLINE_CONNECTION_STATE_LABELS[snapshot.state] : "Unknown";
  const compareResult = state.compareResult ?? snapshot?.compare;
  const selectedDriver = useMemo(
    () => normalizeDriverSummary(state.drivers.find((driver) => driver.id === driverId)),
    [state.drivers, driverId],
  );
  const selectedDriverIsL5x = selectedDriver.kind === "l5x";
  const selectedDriverIsOpcUa = selectedDriver.kind === "opcua";
  const activeCapabilities =
    snapshot?.driverId && snapshot.driverId === selectedDriver.id
      ? normalizeCapabilities(snapshot.capabilities, selectedDriver.capabilities)
      : selectedDriver.capabilities;
  const activeConnectionEvidence =
    snapshot?.driverId && snapshot.driverId === selectedDriver.id
      ? snapshot.connectionEvidence ?? selectedDriver.connectionEvidence
      : selectedDriver.connectionEvidence;
  const tagByName = useMemo(() => new Map(state.tags.map((tag) => [tag.name, tag])), [state.tags]);
  const watchSet = useMemo(() => new Set(watchList), [watchList]);
  const filteredTags = useMemo(() => {
    const needle = tagFilter.trim().toLowerCase();
    if (!needle) return state.tags;
    return state.tags.filter((tag) =>
      [tag.name, tag.dataType, tag.scope ?? "", tag.sourceDriver]
        .some((field) => field.toLowerCase().includes(needle)),
    );
  }, [state.tags, tagFilter]);

  useEffect(() => {
    if (online) return;
    setWatchList(readSavedWatchList(driverId));
    setWatchListStatus(undefined);
  }, [driverId, online]);

  const connect = () => {
    const config = buildConnectionConfig();
    if (!config) return;
    void gateway.connect(driverId, config, localProject);
  };

  const buildConnectionConfig = (): ConnectionConfig | undefined => {
    setLocalConfigError(undefined);
    if (selectedDriverIsL5x) return {};
    const config: ConnectionConfig = {
      endpointUrl: endpointUrl.trim() || undefined,
    };
    if (selectedDriverIsOpcUa) {
      const nodeMap = parseOpcUaNodeMap(opcUaNodeMapText);
      if (nodeMap instanceof Error) {
        setLocalConfigError(nodeMap.message);
        return undefined;
      }
      const samplingIntervalMs = parseOptionalPositiveInteger(opcUaSamplingIntervalMs);
      if (samplingIntervalMs instanceof Error) {
        setLocalConfigError(samplingIntervalMs.message);
        return undefined;
      }
      config.rootNodeId = opcUaRootNodeId.trim() || undefined;
      config.nodeMap = nodeMap;
      config.samplingIntervalMs = samplingIntervalMs;
      return config;
    }
    config.path = routePath.trim() || undefined;
    return config;
  };

  const replaceWatchList = (nextNames: readonly string[]) => {
    const next = normalizeWatchList(nextNames);
    setWatchList(next);
    setWatchListStatus(undefined);
    if (state.streaming) {
      if (next.length > 0) gateway.startTagStream(next);
      else gateway.stopTagStream();
    } else if (state.polling) {
      if (next.length > 0) gateway.startTagPolling(next, state.polling.intervalMs);
      else gateway.stopTagPolling();
    }
  };

  const addWatchTag = (tagName: string) => {
    const name = tagName.trim();
    if (!name) return;
    replaceWatchList([...watchList, name]);
    setManualWatchTag("");
  };

  const removeWatchTag = (tagName: string) => {
    replaceWatchList(watchList.filter((name) => name !== tagName));
  };

  const saveWatchList = () => {
    if (writeSavedWatchList(driverId, watchList)) {
      setWatchListStatus(`Saved ${watchList.length} watched tag(s) for ${selectedDriver.name}.`);
    } else {
      setWatchListStatus("Watch list could not be saved in this browser.");
    }
  };

  const restoreWatchList = () => {
    const saved = readSavedWatchList(driverId);
    replaceWatchList(saved);
    setWatchListStatus(
      saved.length > 0
        ? `Restored ${saved.length} watched tag(s) for ${selectedDriver.name}.`
        : `No saved watch list found for ${selectedDriver.name}.`,
    );
  };

  const exportWatchList = () => {
    if (downloadWatchListExport(selectedDriver, watchList)) {
      setWatchListStatus(`Exported ${watchList.length} watched tag(s) for ${selectedDriver.name}.`);
    } else {
      setWatchListStatus("Watch list export is not available in this browser.");
    }
  };

  const importWatchList = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const parsed = parseWatchListImport(await file.text());
      if (parsed instanceof Error) {
        setWatchListStatus(parsed.message);
        return;
      }
      replaceWatchList(parsed.tags);
      const source =
        parsed.driverId && parsed.driverId !== driverId
          ? ` from ${parsed.driverName ?? parsed.driverId}; current driver is ${selectedDriver.name}`
          : ` for ${selectedDriver.name}`;
      setWatchListStatus(`Imported ${parsed.tags.length} watched tag(s)${source}.`);
    } catch {
      setWatchListStatus("Watch list import failed. Use an ESCO watch-list JSON file.");
    } finally {
      if (watchListFileInputRef.current) watchListFileInputRef.current.value = "";
    }
  };

  return (
    <div className="eol-root" aria-label="ESCO Online (Gateway)">
      <div className="eol-banner eol-banner--readonly">
        <strong>Read-only milestone.</strong> Online sessions monitor controllers through the
        ESCO gateway only — no writes, downloads, mode changes, or forces exist anywhere in
        this path. Live routes also show whether they are software-wired or hardware-validated.
        Controllers that cannot prove a project match stay in Online Read-Only.
      </div>

      {state.apiAvailable === false && (
        <div className="eol-banner eol-banner--down">
          <strong>ESCO gateway API is not reachable.</strong> Start it with{" "}
          <code>pnpm --filter @esco/api dev</code> and retry.{" "}
          <button
            type="button"
            className="eol-btn eol-btn--secondary"
            onClick={() => void gateway.refreshAvailability()}
            disabled={state.busy}
          >
            Retry
          </button>
        </div>
      )}

      {(localConfigError || state.lastError) && <div className="eol-error">{localConfigError ?? state.lastError}</div>}

      <div className="eol-card">
        <h3>Connection</h3>
        <div className="eol-row">
          <div className="eol-field">
            <label htmlFor="eol-driver">Driver path</label>
            <select
              id="eol-driver"
              value={driverId}
              onChange={(event) => {
                setDriverId(event.target.value);
                setLocalConfigError(undefined);
              }}
              disabled={state.busy || online}
            >
              {(state.drivers.length > 0 ? state.drivers : [FALLBACK_DRIVER_SUMMARY]).map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name}
                </option>
              ))}
            </select>
          </div>
          {selectedDriverIsL5x ? (
            <span className="eol-badge">Offline project snapshot</span>
          ) : (
            <>
              <div className="eol-field">
                <label htmlFor="eol-endpoint">
                  {selectedDriverIsOpcUa ? "OPC UA endpoint URL" : "Endpoint (host[:port])"}
                </label>
                <input
                  ref={endpointInputRef}
                  id="eol-endpoint"
                  value={endpointUrl}
                  onChange={(event) => setEndpointUrl(event.target.value)}
                  placeholder={selectedDriverIsOpcUa ? "opc.tcp://host:4840" : "192.168.1.10"}
                  disabled={state.busy || online}
                />
              </div>
              {selectedDriverIsOpcUa ? (
                <>
                  <div className="eol-field">
                    <label htmlFor="eol-opcua-root">Browse root node</label>
                    <input
                      id="eol-opcua-root"
                      value={opcUaRootNodeId}
                      onChange={(event) => setOpcUaRootNodeId(event.target.value)}
                      placeholder="ObjectsFolder"
                      disabled={state.busy || online}
                    />
                  </div>
                  <div className="eol-field eol-field--narrow">
                    <label htmlFor="eol-opcua-sampling">Sampling ms</label>
                    <input
                      id="eol-opcua-sampling"
                      value={opcUaSamplingIntervalMs}
                      onChange={(event) => setOpcUaSamplingIntervalMs(event.target.value)}
                      placeholder="500"
                      inputMode="numeric"
                      disabled={state.busy || online}
                    />
                  </div>
                  <label className="eol-field eol-field--wide" htmlFor="eol-opcua-node-map">
                    <span>Node map JSON (tag name to node id)</span>
                    <textarea
                      id="eol-opcua-node-map"
                      value={opcUaNodeMapText}
                      onChange={(event) => setOpcUaNodeMapText(event.target.value)}
                      placeholder={'{"MotorRunning":"ns=2;s=Line.Running"}'}
                      rows={2}
                      disabled={state.busy || online}
                    />
                  </label>
                </>
              ) : (
                <div className="eol-field">
                  <label htmlFor="eol-route">CIP route path (optional, e.g. 1,0)</label>
                  <input
                    id="eol-route"
                    value={routePath}
                    onChange={(event) => setRoutePath(event.target.value)}
                    placeholder="1,0"
                    disabled={state.busy || online}
                  />
                </div>
              )}
            </>
          )}
          {online ? (
            <button
              type="button"
              className="eol-btn"
              onClick={() => void gateway.disconnect()}
              disabled={state.busy}
            >
              Go Offline
            </button>
          ) : (
            <button
              type="button"
              className="eol-btn"
              onClick={connect}
              disabled={state.busy || state.apiAvailable !== true}
            >
              {selectedDriverIsL5x ? "Open Snapshot (Read-Only)" : "Go Online (Read-Only)"}
            </button>
          )}
          <span
            className={`eol-badge ${
              snapshot?.state === "faulted"
                ? "eol-badge--faulted"
                : online
                  ? "eol-badge--online"
                  : ""
            }`}
          >
            {stateLabel}
          </span>
          {snapshot?.readOnly !== false && <span className="eol-badge">Read-Only</span>}
          {snapshot?.sessionId && (
            <span className="eol-badge eol-badge--session" title={`Gateway session ${snapshot.sessionId}`}>
              Session {snapshot.sessionId}
            </span>
          )}
        </div>
        <CapabilityStrip
          driver={selectedDriver}
          capabilities={activeCapabilities}
          connectionEvidence={activeConnectionEvidence}
          readOnlyReason={snapshot?.readOnlyReason}
        />
        {state.lastConnectResult && (
          <p className={state.lastConnectResult.ok ? "eol-muted" : "eol-error"}>
            {state.lastConnectResult.message}
          </p>
        )}
      </div>

      {online && (
        <div className="eol-card">
          <h3>Controller identity &amp; status</h3>
          <div className="eol-row">
            <button
              type="button"
              className="eol-btn eol-btn--secondary"
              onClick={() => void gateway.refreshIdentity()}
              disabled={state.busy}
            >
              Refresh identity
            </button>
            <button
              type="button"
              className="eol-btn eol-btn--secondary"
              onClick={() => void gateway.refreshStatus()}
              disabled={state.busy}
            >
              {activeCapabilities.canReadFaults ? "Refresh status & faults" : "Refresh status"}
            </button>
          </div>
          <dl className="eol-kv">
            <dt>Vendor</dt>
            <dd>{state.identity?.vendor ?? "—"}</dd>
            <dt>Product</dt>
            <dd>{state.identity?.productName ?? "—"}</dd>
            <dt>Firmware</dt>
            <dd>{state.identity?.firmwareRevision ?? "—"}</dd>
            <dt>Serial</dt>
            <dd>{state.identity?.serialNumber ?? "—"}</dd>
            <dt>Health</dt>
            <dd>{state.status?.health ?? "unknown"}</dd>
            <dt>Mode</dt>
            <dd>{state.status?.mode ?? "not read (honest: mode reading is not implemented yet)"}</dd>
            <dt>Status</dt>
            <dd>{state.status?.message ?? "—"}</dd>
          </dl>
          {activeCapabilities.canReadFaults === false ? (
            <p className="eol-muted">Fault reads are not available on this driver path. Map fault/status tags and watch them read-only.</p>
          ) : state.faults.length > 0 ? (
            <table className="eol-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Fault</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {state.faults.map((fault) => (
                  <tr key={fault.id}>
                    <td>{fault.severity}</td>
                    <td>{fault.message}</td>
                    <td>{fault.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="eol-muted">No device-level fault bits reported.</p>
          )}
        </div>
      )}

      {online && (
        <div className="eol-card">
          <h3>Match check &amp; upload snapshot</h3>
          <div className="eol-row">
            <button
              type="button"
              className="eol-btn eol-btn--secondary"
              onClick={() => localProject && void gateway.compareProject(localProject)}
              disabled={state.busy || !localProject || activeCapabilities.canCompareProject === false}
            >
              Refresh identity &amp; compare
            </button>
            <button
              type="button"
              className="eol-btn eol-btn--secondary"
              onClick={() => void gateway.uploadSnapshot()}
              disabled={state.busy || activeCapabilities.canUploadSnapshot === false}
            >
              Upload snapshot
            </button>
            <span className={`eol-badge ${compareBadgeClass(compareResult)}`}>
              {compareLabel(compareResult)}
            </span>
            <span className="eol-badge">
              {activeCapabilities.canWriteTags
                ? snapshot?.readOnly === false
                  ? "Controlled write eligible"
                  : "Write gated"
                : "Writes blocked"}
            </span>
          </div>
          {!localProject && (
            <p className="eol-muted">Open an ESCO project before running a local/controller match check.</p>
          )}
          <p className="eol-muted">{compareResult?.message ?? "No local/controller match proof has been run; the session remains read-only."}</p>
          {compareResult && (
            <div className="eol-proof">
              <h4>Match evidence</h4>
              <div className="eol-table-wrap">
                <table className="eol-table eol-table--compact">
                  <thead>
                    <tr>
                      <th>Evidence</th>
                      <th>Local project</th>
                      <th>Online session</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchEvidenceRows(compareResult).map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td>{row.local}</td>
                        <td>{row.online}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {compareResult && compareResult.differences.length > 0 && (
            <table className="eol-table eol-table--compact">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Local</th>
                  <th>Online</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                {compareResult.differences.map((difference) => (
                  <tr key={`${difference.field}:${difference.local ?? ""}:${difference.online ?? ""}`}>
                    <td>{difference.field}</td>
                    <td>{difference.local ?? "-"}</td>
                    <td>{difference.online ?? "-"}</td>
                    <td>{difference.severity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {state.uploadedSnapshot && (
            <dl className="eol-kv eol-kv--compact">
              <dt>Snapshot id</dt>
              <dd>{state.uploadedSnapshot.id}</dd>
              <dt>Captured</dt>
              <dd>{formatDateTime(state.uploadedSnapshot.capturedAt)}</dd>
              <dt>Source</dt>
              <dd>{state.uploadedSnapshot.sourceDriver}</dd>
              <dt>Tag values</dt>
              <dd>{state.uploadedSnapshot.tags.length}</dd>
            </dl>
          )}
        </div>
      )}

      {online && (
        <div className="eol-card">
          <h3>Tags (read-only)</h3>
          <div className="eol-watch-toolbar">
            <div className="eol-row">
              <button
                type="button"
                className="eol-btn eol-btn--secondary"
                onClick={() => void gateway.browseTags()}
                disabled={state.busy || activeCapabilities.canBrowseTags === false}
              >
                Browse tags
              </button>
              <label className="eol-field eol-field--inline" htmlFor="eol-tag-filter">
                <span>Search/filter</span>
                <input
                  id="eol-tag-filter"
                  value={tagFilter}
                  onChange={(event) => setTagFilter(event.target.value)}
                  placeholder="name, type, scope"
                />
              </label>
              <label className="eol-field eol-field--inline" htmlFor="eol-watch-add">
                <span>Add tag</span>
                <input
                  id="eol-watch-add"
                  value={manualWatchTag}
                  onChange={(event) => setManualWatchTag(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addWatchTag(manualWatchTag);
                  }}
                  placeholder="TagName"
                />
              </label>
              <button
                type="button"
                className="eol-btn eol-btn--secondary"
                onClick={() => addWatchTag(manualWatchTag)}
                disabled={!manualWatchTag.trim()}
              >
                Add
              </button>
            </div>
            <div className="eol-row">
              {state.streaming ? (
                <button
                  type="button"
                  className="eol-btn"
                  onClick={() => gateway.stopTagStream()}
                >
                  Stop stream
                </button>
              ) : (
                <button
                  type="button"
                  className="eol-btn eol-btn--secondary"
                  onClick={() => gateway.startTagStream(watchList)}
                  disabled={state.busy || watchList.length === 0 || activeCapabilities.canSubscribeTags === false}
                >
                  Stream selected
                </button>
              )}
              {state.polling ? (
                <button
                  type="button"
                  className="eol-btn"
                  onClick={() => gateway.stopTagPolling()}
                >
                  Stop watch
                </button>
              ) : (
                <button
                  type="button"
                  className="eol-btn eol-btn--secondary"
                  onClick={() => gateway.startTagPolling(watchList)}
                  disabled={state.busy || watchList.length === 0 || activeCapabilities.canReadTags === false}
                >
                  Watch selected (poll 2 s)
                </button>
              )}
              <button
                type="button"
                className="eol-btn eol-btn--secondary"
                onClick={() => replaceWatchList(state.tags.map((tag) => tag.name))}
                disabled={state.tags.length === 0}
              >
                Add all browsed
              </button>
              <button
                type="button"
                className="eol-btn eol-btn--secondary"
                onClick={saveWatchList}
                disabled={watchList.length === 0}
              >
                Save list
              </button>
              <button type="button" className="eol-btn eol-btn--secondary" onClick={restoreWatchList}>
                Restore saved
              </button>
              <button
                type="button"
                className="eol-btn eol-btn--secondary"
                onClick={exportWatchList}
                disabled={watchList.length === 0}
              >
                Export list
              </button>
              <button
                type="button"
                className="eol-btn eol-btn--secondary"
                onClick={() => watchListFileInputRef.current?.click()}
              >
                Import list
              </button>
              <input
                ref={watchListFileInputRef}
                type="file"
                accept=".json,application/json"
                className="eol-hidden-input"
                aria-label="Import watch list JSON"
                onChange={(event) => void importWatchList(event.currentTarget.files)}
              />
              <button
                type="button"
                className="eol-btn eol-btn--secondary"
                onClick={() => replaceWatchList([])}
                disabled={watchList.length === 0}
              >
                Clear list
              </button>
              <span className="eol-badge">
                Watch list {watchList.length}
              </span>
              {state.polling && (
                <span className="eol-badge eol-badge--online">
                  Polling {state.polling.names.length} tag(s)
                </span>
              )}
              {state.streaming && (
                <span className="eol-badge eol-badge--online">
                  Streaming {state.streaming.names.length} tag(s)
                </span>
              )}
            </div>
            {watchListStatus && <p className="eol-muted">{watchListStatus}</p>}
          </div>

          {watchList.length > 0 && (
            <div className="eol-watch-panel">
              <h4>Watch list</h4>
              <div className="eol-table-wrap">
                <table className="eol-table eol-table--compact">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Value</th>
                      <th>Data type</th>
                      <th>Quality</th>
                      <th>Timestamp</th>
                      <th>Source driver</th>
                      <th>Write status</th>
                      <th>State</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {watchList.map((tagName) => {
                      const tag = tagByName.get(tagName);
                      const value = state.tagValues[tagName];
                      const readError = state.tagErrors[tagName];
                      const staleReason = state.staleTagReasons[tagName];
                      const changed = state.changedTagNames.includes(tagName);
                      const watchState = describeWatchState(tagName, value, readError, staleReason, state.polling, state.streaming);
                      return (
                        <tr key={tagName} className={changed ? "eol-row--changed" : undefined}>
                          <td>{tagName}</td>
                          <td className={changed ? "eol-value--changed" : undefined}>
                            {readError ? <span className="eol-error-inline">{readError}</span> : value ? formatValue(value.value) : "-"}
                          </td>
                          <td>{value?.dataType ?? tag?.dataType ?? "-"}</td>
                          <td>{readError ? "bad" : staleReason ? "stale" : (value?.quality ?? "-")}</td>
                          <td>{formatTimestamp(value)}</td>
                          <td>{value?.sourceDriver ?? tag?.sourceDriver ?? "-"}</td>
                          <td>{writeStatus(tag, activeCapabilities)}</td>
                          <td>
                            <span className={`eol-state eol-state--${watchState.tone}`}>{watchState.label}</span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="eol-btn eol-btn--secondary"
                              onClick={() => void gateway.readTag(tagName)}
                              disabled={state.busy || activeCapabilities.canReadTags === false}
                            >
                              Read
                            </button>
                            <button
                              type="button"
                              className="eol-btn eol-btn--secondary"
                              onClick={() => removeWatchTag(tagName)}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {state.tags.length > 0 ? (
            <div className="eol-table-wrap">
              <table className="eol-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Scope</th>
                    <th>Value</th>
                    <th>Quality</th>
                    <th>Source</th>
                    <th>Write</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTags.map((tag) => {
                    const value = state.tagValues[tag.name];
                    const readError = state.tagErrors[tag.name];
                    const staleReason = state.staleTagReasons[tag.name];
                    return (
                      <tr key={tag.name}>
                        <td>{tag.name}</td>
                        <td>{tag.dataType}</td>
                        <td>{tag.scope ?? "-"}</td>
                        <td>{readError ? <span className="eol-error-inline">{readError}</span> : value ? formatValue(value.value) : "-"}</td>
                        <td>{readError ? "bad" : staleReason ? "stale" : (value?.quality ?? "-")}</td>
                        <td>{value?.sourceDriver ?? tag.sourceDriver}</td>
                        <td>{writeStatus(tag, activeCapabilities)}</td>
                        <td>
                          <button
                            type="button"
                            className="eol-btn eol-btn--secondary"
                            onClick={() => void gateway.readTag(tag.name)}
                            disabled={state.busy || activeCapabilities.canReadTags === false}
                          >
                            Read
                          </button>
                          <button
                            type="button"
                            className="eol-btn eol-btn--secondary"
                            onClick={() => (watchSet.has(tag.name) ? removeWatchTag(tag.name) : addWatchTag(tag.name))}
                          >
                            {watchSet.has(tag.name) ? "Unwatch" : "Watch"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="eol-muted">No tags browsed yet.</p>
          )}
          {state.tags.length > 0 && filteredTags.length === 0 && (
            <p className="eol-muted">No browsed tags match the current filter.</p>
          )}
        </div>
      )}

      <div className="eol-card">
        <h3>Gateway audit trail</h3>
        <div className="eol-row">
          <button
            type="button"
            className="eol-btn eol-btn--secondary"
            onClick={() => void gateway.refreshAudit()}
            disabled={state.busy || state.apiAvailable !== true}
          >
            Refresh audit
          </button>
        </div>
        {state.audit.length > 0 ? (
          <div className="eol-audit">
            <table className="eol-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Result</th>
                  <th>State</th>
                  <th>Message</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {state.audit.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.action}</td>
                    <td>{entry.result}</td>
                    <td>{entry.state}</td>
                    <td>{entry.message}</td>
                    <td>{formatAuditDetails(entry.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="eol-muted">No audit entries loaded.</p>
        )}
      </div>
    </div>
  );
}

function CapabilityStrip({
  driver,
  capabilities,
  connectionEvidence,
  readOnlyReason,
}: {
  driver: ControllerDriverSummary;
  capabilities: ControllerDriverCapabilities;
  connectionEvidence: ControllerConnectionEvidence;
  readOnlyReason?: string;
}) {
  const readCapabilities = [
    ["Status", capabilities.canReadStatus],
    ["Faults", capabilities.canReadFaults],
    ["Browse", capabilities.canBrowseTags],
    ["Read", capabilities.canReadTags],
    ["Batch", capabilities.canBatchReadTags],
    ["Stream", capabilities.canSubscribeTags],
    ["Upload", capabilities.canUploadSnapshot],
    ["Compare", capabilities.canCompareProject],
  ] as const;
  const mutationCapabilities = [
    ["Write", capabilities.canWriteTags],
    ["Download", capabilities.canDownloadProject],
    ["Online edit", capabilities.canOnlineEdit],
    ["Force", capabilities.canForceTags],
    ["Mode", capabilities.canModeChange],
    ["Clear faults", capabilities.canClearFaults],
  ] as const;
  return (
    <div className="eol-capabilities" aria-label="Driver capability contract">
      <div className="eol-capabilities__header">
        <strong>{driver.name}</strong>
        <span>{driver.kind}</span>
      </div>
      <div className="eol-capabilities__chips">
        {readCapabilities.map(([label, enabled]) => (
          <span key={label} className={`eol-chip ${enabled ? "eol-chip--ok" : "eol-chip--off"}`}>
            {enabled ? label : `${label} unavailable`}
          </span>
        ))}
        {mutationCapabilities.map(([label, enabled]) => (
          <span key={label} className={`eol-chip ${enabled ? "eol-chip--ok" : "eol-chip--blocked"}`}>
            {enabled ? label : `${label} blocked`}
          </span>
        ))}
      </div>
      <div className="eol-evidence" aria-label="Transport validation evidence">
        <span className={`eol-chip ${evidenceChipClass(connectionEvidence)}`}>
          {connectionEvidence.label}
        </span>
        <span className={`eol-chip ${connectionEvidence.realControllerIo ? "eol-chip--warn" : "eol-chip--off"}`}>
          {connectionEvidence.realControllerIo ? "Real controller route" : "No physical controller I/O"}
        </span>
        <span className={`eol-chip ${connectionEvidence.hardwareValidated ? "eol-chip--ok" : "eol-chip--blocked"}`}>
          {connectionEvidence.hardwareValidated ? "Hardware validated" : "Hardware not validated"}
        </span>
      </div>
      <p className="eol-muted">{connectionEvidence.message}</p>
      {connectionEvidence.limitations.length > 0 && (
        <ul className="eol-evidence__limitations">
          {connectionEvidence.limitations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      <p className="eol-muted">{readOnlyReason ?? driver.safetyNote}</p>
    </div>
  );
}

export function normalizeDriverSummary(driver: ControllerDriverSummary | undefined): ControllerDriverSummary {
  if (!driver) return FALLBACK_DRIVER_SUMMARY;
  const fallback = fallbackSummaryForDriver(driver);
  return {
    ...fallback,
    id: driver.id,
    name: driver.name,
    kind: driver.kind,
    capabilities: normalizeCapabilities(driver.capabilities, fallback.capabilities),
    connectionEvidence: driver.connectionEvidence ?? fallback.connectionEvidence,
    readOnly: driver.readOnly ?? fallback.readOnly,
    safetyNote: driver.safetyNote ?? fallback.safetyNote,
  };
}

function normalizeCapabilities(
  declared: Partial<ControllerDriverCapabilities> | undefined,
  fallback: ControllerDriverCapabilities,
): ControllerDriverCapabilities {
  return {
    canConnect: declared?.canConnect ?? fallback.canConnect,
    canReadStatus: declared?.canReadStatus ?? fallback.canReadStatus,
    canReadFaults: declared?.canReadFaults ?? fallback.canReadFaults,
    canBrowseTags: declared?.canBrowseTags ?? fallback.canBrowseTags,
    canReadTags: declared?.canReadTags ?? fallback.canReadTags,
    canBatchReadTags: declared?.canBatchReadTags ?? fallback.canBatchReadTags,
    canSubscribeTags: declared?.canSubscribeTags ?? fallback.canSubscribeTags,
    canUploadSnapshot: declared?.canUploadSnapshot ?? fallback.canUploadSnapshot,
    canCompareProject: declared?.canCompareProject ?? fallback.canCompareProject,
    canWriteTags: declared?.canWriteTags ?? false,
    canDownloadProject: declared?.canDownloadProject ?? false,
    canOnlineEdit: declared?.canOnlineEdit ?? false,
    canForceTags: declared?.canForceTags ?? false,
    canModeChange: declared?.canModeChange ?? false,
    canClearFaults: declared?.canClearFaults ?? false,
  };
}

function evidenceChipClass(evidence: ControllerConnectionEvidence): string {
  if (evidence.hardwareValidated) return "eol-chip--ok";
  if (evidence.transportValidation === "software-wired") return "eol-chip--warn";
  return "eol-chip--off";
}

function fallbackSummaryForDriver(
  driver: Pick<ControllerDriverSummary, "id" | "name" | "kind">,
): ControllerDriverSummary {
  const noLiveTransport = PLACEHOLDER_DRIVER_IDS.has(driver.id);
  const l5x = driver.id === "l5x-sync" || driver.kind === "l5x";
  return {
    id: driver.id,
    name: driver.name,
    kind: driver.kind,
    readOnly: true,
    safetyNote: l5x
      ? "L5X sync is an offline project-structure path through the ESCO gateway; it is not a live controller transport."
      : noLiveTransport
      ? "This path is a placeholder; no live controller transport is active."
      : "Public ESCO online mode is read-only; restart the API host for exact driver capability metadata.",
    connectionEvidence: fallbackConnectionEvidenceForDriver(driver, noLiveTransport, l5x),
    capabilities: {
      canConnect: !noLiveTransport || l5x,
      canReadStatus: false,
      canReadFaults: false,
      canBrowseTags: false,
      canReadTags: false,
      canBatchReadTags: false,
      canSubscribeTags: false,
      canUploadSnapshot: false,
      canCompareProject: false,
      ...ALL_PUBLIC_MUTATIONS_BLOCKED,
    },
  };
}

function fallbackConnectionEvidenceForDriver(
  driver: Pick<ControllerDriverSummary, "id" | "kind">,
  noLiveTransport: boolean,
  l5x: boolean,
): ControllerConnectionEvidence {
  if (noLiveTransport) {
    return {
      transportValidation: "none",
      realControllerIo: false,
      hardwareValidated: false,
      verified: false,
      label: "No live transport",
      message: "This driver summary did not include a live transport evidence payload.",
      limitations: ["No physical controller I/O.", "No write, download, force, online edit, or mode-change path."],
    };
  }
  if (driver.id === "esco-simulator" || l5x) {
    return {
      transportValidation: "software-wired",
      realControllerIo: false,
      hardwareValidated: false,
      verified: true,
      label: l5x ? "Offline snapshot" : "ESCO software simulator",
      message: l5x
        ? "Offline project sync is review data through the gateway, not a PLC link."
        : "The ESCO simulator is wired for offline testing and never contacts plant hardware.",
      limitations: ["No physical controller I/O.", "Not proof of Allen-Bradley plant-route readiness."],
    };
  }
  return FALLBACK_CONNECTION_EVIDENCE;
}

function formatValue(value: unknown): string {
  if (value === null) return "(structure — not decoded; no fake value shown)";
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  return String(value);
}

function normalizeWatchList(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    normalized.push(name);
  }
  return normalized;
}

interface WatchListImport {
  driverId?: string;
  driverName?: string;
  tags: string[];
}

function readSavedWatchList(driverId: string): string[] {
  try {
    if (typeof window === "undefined") return [];
    const collection = readSavedWatchListCollection();
    const scoped = collection[driverId];
    if (Array.isArray(scoped)) return normalizeWatchList(scoped);
    const rawLegacy = window.localStorage.getItem(WATCH_LIST_STORAGE_KEY);
    if (!rawLegacy) return [];
    const parsed = JSON.parse(rawLegacy);
    return Array.isArray(parsed) ? normalizeWatchList(parsed.filter((item): item is string => typeof item === "string")) : [];
  } catch {
    return [];
  }
}

function writeSavedWatchList(driverId: string, names: readonly string[]): boolean {
  try {
    if (typeof window === "undefined") return false;
    const normalized = normalizeWatchList(names);
    const collection = readSavedWatchListCollection();
    collection[driverId] = normalized;
    window.localStorage.setItem(WATCH_LIST_COLLECTION_STORAGE_KEY, JSON.stringify(collection));
    window.localStorage.setItem(WATCH_LIST_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

function readSavedWatchListCollection(): Record<string, string[]> {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem(WATCH_LIST_COLLECTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const collection: Record<string, string[]> = {};
    for (const [driverId, names] of Object.entries(parsed)) {
      if (Array.isArray(names)) {
        collection[driverId] = normalizeWatchList(names.filter((item): item is string => typeof item === "string"));
      }
    }
    return collection;
  } catch {
    return {};
  }
}

function downloadWatchListExport(driver: ControllerDriverSummary, names: readonly string[]): boolean {
  try {
    if (typeof window === "undefined") return false;
    const documentRef = window.document;
    const payload = {
      schema: WATCH_LIST_EXPORT_SCHEMA,
      exportedAt: new Date().toISOString(),
      driverId: driver.id,
      driverName: driver.name,
      driverKind: driver.kind,
      tags: normalizeWatchList(names),
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const anchor = documentRef.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFilePart(driver.id)}-watch-list.json`;
    documentRef.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

function parseWatchListImport(text: string): WatchListImport | Error {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Error("Watch list import must be valid JSON.");
  }
  if (Array.isArray(parsed)) {
    return { tags: normalizeWatchList(parsed.filter((item): item is string => typeof item === "string")) };
  }
  if (!parsed || typeof parsed !== "object") {
    return new Error("Watch list import must be an ESCO watch-list object or an array of tag names.");
  }
  const record = parsed as {
    schema?: unknown;
    driverId?: unknown;
    driverName?: unknown;
    tags?: unknown;
    watchList?: unknown;
  };
  const rawTags = Array.isArray(record.tags) ? record.tags : record.watchList;
  if (!Array.isArray(rawTags)) {
    return new Error("Watch list import must include a tags array.");
  }
  const tags = normalizeWatchList(rawTags.filter((item): item is string => typeof item === "string"));
  if (tags.length === 0) return new Error("Watch list import contains no usable tag names.");
  if (record.schema !== undefined && record.schema !== WATCH_LIST_EXPORT_SCHEMA) {
    return new Error("Watch list import uses an unsupported ESCO watch-list schema.");
  }
  return {
    driverId: typeof record.driverId === "string" ? record.driverId : undefined,
    driverName: typeof record.driverName === "string" ? record.driverName : undefined,
    tags,
  };
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "") || "esco-online";
}

function parseOptionalPositiveInteger(value: string): number | undefined | Error {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return new Error("OPC UA sampling interval must be a positive whole number of milliseconds.");
  }
  return parsed;
}

function parseOpcUaNodeMap(value: string): Record<string, string> | undefined | Error {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return new Error("OPC UA node map must be valid JSON, for example {\"TagName\":\"ns=2;s=Node\"}.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return new Error("OPC UA node map must be a JSON object of tag names to node ids.");
  }
  const nodeMap: Record<string, string> = {};
  for (const [tagName, nodeId] of Object.entries(parsed)) {
    if (typeof nodeId !== "string" || !tagName.trim() || !nodeId.trim()) {
      return new Error("OPC UA node map entries must be non-empty string tag names and node ids.");
    }
    nodeMap[tagName.trim()] = nodeId.trim();
  }
  return nodeMap;
}

function writeStatus(tag: TagDefinition | undefined, capabilities: ControllerDriverCapabilities): string {
  if (!capabilities.canWriteTags) return "Read-only / gateway write blocked";
  if (!tag) return "Read-only";
  return tag.writable ? "Blocked by read-only milestone" : "Read-only";
}

function formatTimestamp(value: TagValue | undefined): string {
  if (!value) return "-";
  const parsed = Date.parse(value.timestamp);
  return Number.isNaN(parsed) ? value.timestamp : new Date(parsed).toLocaleTimeString();
}

function formatDateTime(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

interface MatchEvidenceRow {
  label: string;
  local: string;
  online: string;
}

function matchEvidenceRows(compare: CompareResult): MatchEvidenceRow[] {
  return [
    evidenceRow("Controller name", compare.localIdentity, compare.controllerIdentity, "controllerName"),
    evidenceRow("Controller type", compare.localIdentity, compare.controllerIdentity, "controllerType"),
    evidenceRow("Firmware", compare.localIdentity, compare.controllerIdentity, "firmwareRevision"),
    evidenceRow("Project name", compare.localIdentity, compare.controllerIdentity, "projectName"),
    evidenceRow("Project signature", compare.localIdentity, compare.controllerIdentity, "projectSignature", formatSignature),
    evidenceRow("Signature algorithm", compare.localIdentity, compare.controllerIdentity, "projectSignatureAlgorithm"),
    evidenceRow("Signature source", compare.localIdentity, compare.controllerIdentity, "projectSignatureSource"),
  ];
}

function evidenceRow(
  label: string,
  local: ControllerIdentity | undefined,
  online: ControllerIdentity | undefined,
  key: keyof ControllerIdentity,
  format: (value: string | undefined) => string = formatIdentityValue,
): MatchEvidenceRow {
  return {
    label,
    local: format(identityString(local, key)),
    online: format(identityString(online, key)),
  };
}

function identityString(identity: ControllerIdentity | undefined, key: keyof ControllerIdentity): string | undefined {
  const value = identity?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatIdentityValue(value: string | undefined): string {
  return value ?? "-";
}

function formatSignature(value: string | undefined): string {
  if (!value) return "-";
  const [algorithm, digest] = value.split(":");
  if (!algorithm || !digest || digest.length <= 24) return value;
  return `${algorithm}:${digest.slice(0, 12)}...${digest.slice(-12)}`;
}

function formatAuditDetails(details: OnlineAuditEntry["details"]): string {
  if (!details || Object.keys(details).length === 0) return "-";
  const parts = Object.entries(details).map(([key, value]) => `${auditLabel(key)} ${formatAuditValue(key, value)}`);
  return parts.join("; ");
}

function auditLabel(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function formatAuditValue(key: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => formatAuditValue(key, item)).join(", ")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (key === "connectionEvidence") {
      const label = typeof record.label === "string" ? record.label : undefined;
      const validation = typeof record.transportValidation === "string" ? record.transportValidation : undefined;
      const hardwareValidated = record.hardwareValidated === true ? "validated" : "not validated";
      return [label, validation, hardwareValidated].filter(Boolean).join(" / ");
    }
    if (key === "compare") {
      const state = typeof record.state === "string" ? record.state : "unknown";
      const differences = typeof record.differenceCount === "number" ? `${record.differenceCount} diff` : undefined;
      return [state, differences].filter(Boolean).join(" / ");
    }
    return Object.entries(record)
      .map(([childKey, childValue]) => `${auditLabel(childKey)}=${formatAuditValue(childKey, childValue)}`)
      .join(", ");
  }
  return String(value);
}

function compareLabel(compare: CompareResult | undefined): string {
  if (!compare) return "Match unknown";
  if (compare.state === "matched") return "Matched";
  if (compare.state === "mismatched") return "Mismatched";
  return "Match unknown";
}

function compareBadgeClass(compare: CompareResult | undefined): string {
  if (!compare) return "";
  if (compare.state === "matched") return "eol-badge--online";
  if (compare.state === "mismatched") return "eol-badge--faulted";
  return "";
}

export function describeWatchState(
  tagName: string,
  value: TagValue | undefined,
  error: string | undefined,
  staleReason: string | undefined,
  polling: { names: readonly string[]; intervalMs: number } | undefined,
  streaming: { names: readonly string[] } | undefined,
): { label: string; tone: "live" | "stale" | "bad" } {
  if (error) return { label: "bad", tone: "bad" };
  if (staleReason) return { label: staleReason, tone: "stale" };
  if (!value) return { label: "stale: no sample", tone: "stale" };
  if (value.quality === "stale") return { label: "stale", tone: "stale" };
  if (value.quality === "bad") return { label: "bad quality", tone: "bad" };
  if (value.quality === "uncertain") return { label: "uncertain quality", tone: "stale" };
  const activelyWatched = polling?.names.includes(tagName) === true || streaming?.names.includes(tagName) === true;
  if (!activelyWatched) return { label: "stale: watch stopped", tone: "stale" };
  return { label: "live", tone: "live" };
}
