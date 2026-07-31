import type { PlcProject } from "@esco/core";
import { compareControllerIdentity, localProjectIdentity } from "./identity";
import type {
  BatchTagReadResult,
  CompareResult,
  ConnectionConfig,
  ControllerConnectionEvidence,
  ConnectionResult,
  ControllerDriverCapabilities,
  ControllerDriverSummary,
  ControlledWriteRequest,
  ControllerDriver,
  ControllerIdentity,
  ControllerIdentityProofField,
  ControllerIdentityTagMap,
  ControllerStatus,
  FaultInfo,
  OnlineAuditEntry,
  OnlineConnectionState,
  ProjectSnapshot,
  SubscriptionHandle,
  TagDefinition,
  TagSubscriptionCallback,
  TagValue,
} from "./types";
import { isOnlineState, type TagValuePayload } from "./types";

const stamp = (): string => new Date().toISOString();

function auditId(): string {
  return `online-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function valuesEqual(left: TagValuePayload, right: TagValuePayload): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export interface OnlineSnapshot {
  /** Optional host/session-manager stamp; `ControllerGateway` itself is client-agnostic. */
  sessionId?: string;
  state: OnlineConnectionState;
  driverId?: string;
  driverName?: string;
  identity?: ControllerIdentity;
  compare?: CompareResult;
  capabilities?: ControllerDriverCapabilities;
  connectionEvidence?: ControllerConnectionEvidence;
  readOnly: boolean;
  readOnlyReason?: string;
}

const MUTATION_CAPABILITIES_OFF = {
  canWriteTags: false,
  canDownloadProject: false,
  canOnlineEdit: false,
  canForceTags: false,
  canModeChange: false,
  canClearFaults: false,
} as const;

export function controllerDriverCapabilities(driver: ControllerDriver): ControllerDriverCapabilities {
  const declared = driver.capabilities ?? {};
  return {
    canConnect: declared.canConnect ?? true,
    canReadStatus: declared.canReadStatus ?? true,
    canReadFaults: declared.canReadFaults ?? true,
    canBrowseTags: declared.canBrowseTags ?? Boolean(driver.browseTags),
    canReadTags: declared.canReadTags ?? true,
    canBatchReadTags: declared.canBatchReadTags ?? Boolean(driver.readTags),
    canSubscribeTags: declared.canSubscribeTags ?? Boolean(driver.subscribeTags),
    canUploadSnapshot: declared.canUploadSnapshot ?? Boolean(driver.uploadSnapshot),
    canCompareProject: declared.canCompareProject ?? true,
    ...MUTATION_CAPABILITIES_OFF,
  };
}

export function controllerConnectionEvidence(
  driver: ControllerDriver,
  capabilities: ControllerDriverCapabilities = controllerDriverCapabilities(driver),
): ControllerConnectionEvidence {
  if (driver.connectionEvidence) return driver.connectionEvidence;
  if (!capabilities.canConnect) {
    return {
      transportValidation: "none",
      realControllerIo: false,
      hardwareValidated: false,
      verified: false,
      label: "No live transport",
      message: "This driver path is a placeholder or review-only surface; no controller transport is active.",
      limitations: ["No live controller I/O.", "No upload, download, online edit, force, or write path."],
    };
  }
  if (driver.kind === "simulator") {
    return {
      transportValidation: "software-wired",
      realControllerIo: false,
      hardwareValidated: false,
      verified: true,
      label: "ESCO software simulator",
      message: "In-memory ESCO simulator path is wired for offline testing only; it never contacts plant hardware.",
      limitations: ["No physical controller I/O.", "Simulator proof does not validate an Allen-Bradley plant route."],
    };
  }
  if (driver.kind === "l5x") {
    return {
      transportValidation: "software-wired",
      realControllerIo: false,
      hardwareValidated: false,
      verified: true,
      label: "Offline snapshot",
      message: "L5X/project sync is an offline project-structure path through the gateway, not a live PLC connection.",
      limitations: ["No physical controller I/O.", "Values are snapshot/review data and may be stale."],
    };
  }
  return {
    transportValidation: "software-wired",
    realControllerIo: driver.kind === "ethernetip" || driver.kind === "opcua",
    hardwareValidated: false,
    verified: false,
    label: "Software-wired, not field-validated",
    message:
      "The ESCO gateway route is implemented enough for software tests, but no lab/field hardware validation evidence is attached.",
    limitations: ["Treat as engineering/lab preview until hardware validation is recorded.", "Writes and downloads remain blocked."],
  };
}

export function describeControllerDriver(driver: ControllerDriver): ControllerDriverSummary {
  const capabilities = controllerDriverCapabilities(driver);
  const connectionEvidence = controllerConnectionEvidence(driver, capabilities);
  const readOnly = capabilities.canWriteTags !== true;
  return {
    id: driver.id,
    name: driver.name,
    kind: driver.kind,
    capabilities,
    connectionEvidence,
    readOnly,
    safetyNote: readOnly
      ? "Public ESCO online mode is read-only: writes, downloads, online edits, forces, mode changes, and clear-fault commands are blocked."
      : "Controlled writes require a proven project match, confirmation, permission, audit, and read-back.",
  };
}

export class ControllerGateway {
  private state: OnlineConnectionState = "offline";
  private activeDriver: ControllerDriver | undefined;
  private identity: ControllerIdentity | undefined;
  private identityTags: ControllerIdentityTagMap | undefined;
  private compare: CompareResult | undefined;
  private localProject: PlcProject | undefined;
  private activeWatchCount = 0;
  /**
   * Watch subscriptions whose `subscribeTags()` setup is still in flight. They
   * count as live so a concurrent disconnect/idle teardown never treats the
   * session as idle mid-handshake. A pending slot is transferred to
   * `activeWatchCount` on success and released on failure — never both.
   */
  private pendingWatchCount = 0;
  /**
   * Monotonic session id. Bumped on every connect and disconnect so a slow
   * `subscribeTags()` that resolves after the session ended (or rolled to a new
   * session) is detected as stale, closed, and never revives online state.
   */
  private sessionGeneration = 0;
  private readonly auditEntries: OnlineAuditEntry[] = [];
  private readonly drivers: Map<string, ControllerDriver>;

  constructor(drivers: ControllerDriver[]) {
    this.drivers = new Map(drivers.map((driver) => [driver.id, driver]));
  }

  get auditLog(): readonly OnlineAuditEntry[] {
    return this.auditEntries;
  }

  listDrivers(): ControllerDriver[] {
    return [...this.drivers.values()];
  }

  listDriverSummaries(): ControllerDriverSummary[] {
    return this.listDrivers().map((driver) => describeControllerDriver(driver));
  }

  snapshot(): OnlineSnapshot {
    const capabilities = this.activeDriver
      ? controllerDriverCapabilities(this.activeDriver)
      : undefined;
    const connectionEvidence = this.activeDriver && capabilities
      ? controllerConnectionEvidence(this.activeDriver, capabilities)
      : undefined;
    const gatewayWriteState = this.state === "online-matched" || this.state === "online-controlled-write";
    const publicWriteCapable = gatewayWriteState && capabilities?.canWriteTags === true;
    return {
      state: this.state,
      driverId: this.activeDriver?.id,
      driverName: this.activeDriver?.name,
      identity: this.identity,
      compare: this.compare,
      capabilities,
      connectionEvidence,
      readOnly: !publicWriteCapable,
      readOnlyReason: describeReadOnlyReason(this.state, capabilities, this.compare),
    };
  }

  async connect(driverId: string, config: ConnectionConfig = {}, localProject?: PlcProject): Promise<ConnectionResult> {
    const driver = this.drivers.get(driverId);
    if (!driver) {
      this.state = "faulted";
      return this.recordResult(
        "connect",
        "failed",
        { ok: false, state: this.state, message: `Unknown driver: ${driverId}` },
        { requestedDriverId: driverId },
      );
    }

    this.activeDriver = driver;
    this.identity = undefined;
    this.identityTags = undefined;
    this.compare = undefined;
    // New session: invalidate any watch subscription still resolving from a
    // prior connect so it cannot attach to or revive this one.
    this.sessionGeneration += 1;
    this.activeWatchCount = 0;
    const capabilities = controllerDriverCapabilities(driver);
    const connectionEvidence = controllerConnectionEvidence(driver, capabilities);
    if (capabilities.canConnect !== true) {
      this.localProject = undefined;
      this.state = "disconnected";
      return this.recordResult(
        "connect",
        "blocked",
        {
          ok: false,
          state: this.state,
          message: `${driver.name} cannot connect because this driver path has no live controller transport.`,
          connectionEvidence,
        },
        { capability: "canConnect", ...driverAuditDetails(driver) },
      );
    }

    this.localProject = localProject;
    this.state = "connecting";
    this.record("connect", "ran", `Connecting through ${driver.name}.`, driverAuditDetails(driver));

    const driverConfig =
      driver.kind === "l5x" && localProject && !config.offlineProject
        ? { ...config, offlineProject: localProject }
        : config;
    this.identityTags = normalizeIdentityTags(driverConfig.identityTags);
    const result = await driver.connect(driverConfig);
    if (!result.ok) {
      this.state = result.state === "faulted" ? "faulted" : "disconnected";
      this.localProject = undefined;
      this.identityTags = undefined;
      return this.recordResult(
        "connect",
        "failed",
        { ...result, state: this.state, connectionEvidence },
        driverAuditDetails(driver),
      );
    }
    if (result.status && (!result.status.connected || result.status.state === "disconnected")) {
      await driver.disconnect().catch(() => undefined);
      this.state = "disconnected";
      this.localProject = undefined;
      this.identityTags = undefined;
      return this.recordResult(
        "connect",
        "failed",
        {
          ...result,
          ok: false,
          state: this.state,
          connectionEvidence,
          message: `${driver.name} reported disconnected during connect: ${result.status.message}`,
        },
        {
          ...driverAuditDetails(driver),
          status: {
            state: result.status.state,
            connected: result.status.connected,
            health: result.status.health,
          },
        },
      );
    }

    this.identity = await this.identityWithConfiguredTags(driver, result.identity ?? await driver.getIdentity());
    this.compare =
      localProject && capabilities.canCompareProject === true
        ? await this.computeCompare(driver, localProject)
        : compareControllerIdentity(undefined, this.identity);
    if (localProject && capabilities.canCompareProject === true) {
      this.record(
        "compare-project",
        this.compare.matched ? "ran" : "blocked",
        this.compare.message,
        compareAuditDetails(this.compare),
      );
    }
    this.state = this.stateForCompare(this.compare);
    return this.recordResult("connect", "ran", {
      ...result,
      state: this.state,
      identity: this.identity,
      compare: this.compare,
      connectionEvidence,
      message: `${result.message} ${this.compare.message}`,
    }, {
      ...driverAuditDetails(driver),
      compare: compareAuditDetails(this.compare),
    });
  }

  async disconnect(): Promise<void> {
    // Bump first: a watch subscription whose setup is still pending must see a
    // new generation when it resolves so it discards itself instead of
    // reviving this torn-down session.
    this.sessionGeneration += 1;
    await this.activeDriver?.disconnect();
    this.state = "disconnected";
    this.identity = undefined;
    this.identityTags = undefined;
    this.compare = undefined;
    this.localProject = undefined;
    this.activeWatchCount = 0;
    this.pendingWatchCount = 0;
    this.record("disconnect", "ran", "Online session disconnected.");
  }

  async compareProject(localProject: PlcProject): Promise<CompareResult> {
    const driver = this.requireOnlineDriver();
    this.requireCapability(driver, "canCompareProject", "compare-project", `${driver.name} does not support project compare.`);
    this.localProject = localProject;
    const result = await this.computeCompare(driver, localProject);
    this.compare = result;
    if (isOnlineState(this.state) && this.state !== "online-monitor") this.state = this.stateForCompare(result);
    this.record("compare-project", result.matched ? "ran" : "blocked", result.message, compareAuditDetails(result));
    return result;
  }

  /** Refreshes the controller identity through the active online driver. */
  async getIdentity(): Promise<ControllerIdentity> {
    const driver = this.requireOnlineDriver();
    this.identity = await this.identityWithConfiguredTags(driver, await driver.getIdentity());
    this.compare = compareControllerIdentity(
      this.localProject ? localProjectIdentity(this.localProject) : undefined,
      this.identity,
    );
    if (isOnlineState(this.state) && this.state !== "online-monitor") {
      this.state = this.stateForCompare(this.compare);
    }
    this.record("identity", "ran", "Controller identity refreshed through the gateway.", {
      compare: compareAuditDetails(this.compare),
      controllerName: this.identity.controllerName,
      projectName: this.identity.projectName,
    });
    return this.identity;
  }

  /** Reads controller status through the active online driver. */
  async getStatus(): Promise<ControllerStatus> {
    const driver = this.requireOnlineDriver();
    this.requireCapability(driver, "canReadStatus", "status", `${driver.name} does not support status reads.`);
    const status = await driver.getStatus();
    if (!status.connected || status.state === "disconnected") {
      await driver.disconnect().catch(() => undefined);
      this.state = "disconnected";
      this.activeWatchCount = 0;
    } else if (status.state === "faulted" || status.health === "faulted") {
      this.state = "faulted";
      this.activeWatchCount = 0;
    }
    this.record("status", "ran", status.message, {
      connected: status.connected,
      health: status.health,
      mode: status.mode,
      updatedAt: status.updatedAt,
    });
    return status;
  }

  /** Reads fault diagnostics through the active online driver. */
  async getFaults(): Promise<FaultInfo[]> {
    const driver = this.requireOnlineDriver();
    this.requireCapability(driver, "canReadFaults", "faults", `${driver.name} does not support fault reads.`);
    const faults = await driver.getFaults();
    this.record("faults", "ran", `Read ${faults.length} fault record(s) through the gateway.`, {
      faultCount: faults.length,
      clearableCount: faults.filter((fault) => fault.clearable).length,
    });
    return faults;
  }

  async browseTags(): Promise<TagDefinition[]> {
    const driver = this.requireOnlineDriver();
    this.requireCapability(driver, "canBrowseTags", "browse-tags", `${driver.name} does not support tag browsing.`);
    if (!driver.browseTags) throw new Error(`${driver.name} does not support tag browsing.`);
    const tags = await driver.browseTags();
    this.record("browse-tags", "ran", `Browsed ${tags.length} tag definition(s).`, {
      tagCount: tags.length,
      sourceDriver: driver.kind,
    });
    return tags;
  }

  async readTag(tagName: string): Promise<TagValue> {
    const driver = this.requireOnlineDriver();
    this.requireCapability(driver, "canReadTags", "read-tag", `${driver.name} does not support tag reads.`);
    const value = await driver.readTag(tagName);
    this.record("read-tag", "ran", `Read ${tagName}.`, {
      tagName,
      quality: value.quality,
      dataType: value.dataType,
      sourceDriver: value.sourceDriver,
    });
    return value;
  }

  /**
   * Reads a batch of tags for read-only polling/watch surfaces. Per-tag
   * failures are reported per tag instead of failing the whole batch; the
   * batch is audited once with its success/failure counts.
   */
  async readTags(tagNames: string[]): Promise<BatchTagReadResult> {
    const driver = this.requireOnlineDriver();
    const capabilities = this.requireCapability(driver, "canReadTags", "read-tags", `${driver.name} does not support tag reads.`);
    let values: TagValue[] = [];
    let errors: Record<string, string> = {};
    if (capabilities.canBatchReadTags && driver.readTags) {
      // Driver-level batching (e.g. CIP Multiple Service Packet) — one wire
      // round trip per chunk instead of one per tag.
      ({ values, errors } = await driver.readTags(tagNames));
    } else {
      for (const tagName of tagNames) {
        try {
          values.push(await driver.readTag(tagName));
        } catch (cause) {
          errors[tagName] = cause instanceof Error ? cause.message : String(cause);
        }
      }
    }
    const errorCount = Object.keys(errors).length;
    this.record(
      "read-tags",
      errorCount === tagNames.length && tagNames.length > 0 ? "failed" : "ran",
      `Batch read ${values.length}/${tagNames.length} tag(s)${errorCount ? `, ${errorCount} failed` : ""}.`,
      {
        requestedCount: tagNames.length,
        valueCount: values.length,
        errorCount,
        batchDriver: capabilities.canBatchReadTags && Boolean(driver.readTags),
      },
    );
    return { values, errors };
  }

  async watchTags(tagNames: string[], callback: TagSubscriptionCallback): Promise<SubscriptionHandle> {
    const driver = this.requireOnlineDriver();
    this.requireCapability(driver, "canSubscribeTags", "watch-tags", `${driver.name} does not support tag subscriptions.`);
    if (!driver.subscribeTags) throw new Error(`${driver.name} does not support tag subscriptions.`);

    // Subscription setup can be slow (e.g. a CIP/OPC UA handshake). Count it as
    // pending up front so the session reads as live mid-handshake and idle
    // teardown can't close it out from under us.
    const generation = this.sessionGeneration;
    this.pendingWatchCount += 1;
    let handle: SubscriptionHandle;
    try {
      handle = await driver.subscribeTags(tagNames, callback);
    } catch (cause) {
      // Failed setup: release the pending slot exactly once. No active slot was
      // ever taken, so there is nothing to leak.
      this.pendingWatchCount = Math.max(0, this.pendingWatchCount - 1);
      this.record(
        "watch-tags",
        "failed",
        `Tag subscription setup failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        { tagCount: tagNames.length },
      );
      throw cause;
    }
    // Setup succeeded: consume the pending slot. From here it either becomes an
    // active watch or is discarded as stale — never double-counted.
    this.pendingWatchCount = Math.max(0, this.pendingWatchCount - 1);

    // If the session ended (disconnect/fault) or rolled to a new generation
    // while setup was in flight, this handle belongs to a session that no
    // longer exists. Close it now; never revive online state or leak it.
    if (generation !== this.sessionGeneration || !isOnlineState(this.state)) {
      await handle.unsubscribe().catch(() => undefined);
      this.record(
        "watch-tags",
        "blocked",
        `Discarded tag subscription ${handle.id} that resolved after the session ended.`,
        { subscriptionId: handle.id },
      );
      return { id: handle.id, unsubscribe: async () => undefined };
    }

    // Success: transfer the pending slot to an active watch.
    this.activeWatchCount += 1;
    this.state = "online-monitor";
    this.record("watch-tags", "ran", `Watching ${tagNames.length} tag(s).`, {
      tagCount: tagNames.length,
      subscriptionId: handle.id,
    });
    let closed = false;
    return {
      id: handle.id,
      unsubscribe: async () => {
        if (closed) return;
        closed = true;
        try {
          await handle.unsubscribe();
        } finally {
          if (this.activeWatchCount > 0) this.activeWatchCount -= 1;
          this.record("watch-tags", "ran", `Stopped watching subscription ${handle.id}.`, {
            subscriptionId: handle.id,
            activeWatchCount: this.activeWatchCount,
          });
          if (this.activeWatchCount === 0 && this.state === "online-monitor") {
            this.state = this.compare ? this.stateForCompare(this.compare) : "online-readonly";
          }
        }
      },
    };
  }

  async uploadSnapshot(): Promise<ProjectSnapshot> {
    const driver = this.requireOnlineDriver();
    this.requireCapability(driver, "canUploadSnapshot", "upload-snapshot", `${driver.name} does not support upload snapshots.`);
    if (!driver.uploadSnapshot) throw new Error(`${driver.name} does not support upload snapshots.`);
    const snapshot = await driver.uploadSnapshot();
    this.record("upload-snapshot", "ran", `Captured ${snapshot.tags.length} tag value(s).`, {
      snapshotId: snapshot.id,
      sourceDriver: snapshot.sourceDriver,
      tagCount: snapshot.tags.length,
      connectionEvidence: compactConnectionEvidence(snapshot.connectionEvidence ?? controllerConnectionEvidence(driver)),
    });
    return {
      ...snapshot,
      connectionEvidence: snapshot.connectionEvidence ?? controllerConnectionEvidence(driver),
    };
  }

  async controlledWrite(request: ControlledWriteRequest): Promise<ConnectionResult> {
    const driver = this.requireOnlineDriver();
    if (this.state !== "online-matched" || this.compare?.matched !== true) {
      return this.block("controlled-write", "Online writes require a proven local/controller match.", {
        compare: this.compare ? compareAuditDetails(this.compare) : undefined,
      });
    }
    const capabilities = controllerDriverCapabilities(driver);
    if (capabilities.canWriteTags !== true) {
      return this.block(
        "controlled-write",
        "Controlled writes are disabled by the active driver capability contract.",
        { capability: "canWriteTags" },
      );
    }
    const connectionEvidence = controllerConnectionEvidence(driver, capabilities);
    if (connectionEvidence.realControllerIo && (!connectionEvidence.hardwareValidated || !connectionEvidence.verified)) {
      return this.block(
        "controlled-write",
        "Controlled writes to real controller routes require lab/field hardware validation evidence.",
        { connectionEvidence: compactConnectionEvidence(connectionEvidence) },
      );
    }
    if (!driver.writeTag) return this.block("controlled-write", `${driver.name} does not expose controlled writes.`);
    if (!request.confirmed) return this.block("controlled-write", "Write confirmation is required.", { tagName: request.tagName });
    if (request.permission !== "granted") return this.block("controlled-write", "Write permission is not granted.", { tagName: request.tagName, permission: request.permission });
    if (!request.reason.trim()) return this.block("controlled-write", "A write reason is required for audit.", { tagName: request.tagName });

    this.state = "online-controlled-write";
    this.record("controlled-write", "ran", `Writing ${request.tagName}: ${request.reason}`, {
      tagName: request.tagName,
      permission: request.permission,
      reason: request.reason,
    });
    const result = await driver.writeTag(request.tagName, request.value);
    if (!result.ok) {
      this.state = "online-matched";
      return this.recordResult("controlled-write", "failed", { ok: false, state: this.state, message: result.message });
    }

    const readBack = result.readBack ?? await driver.readTag(request.tagName);
    this.state = "online-matched";
    if (!valuesEqual(readBack.value, request.value)) {
      return this.recordResult("controlled-write", "failed", {
        ok: false,
        state: this.state,
        message: "Write read-back verification failed.",
      }, { tagName: request.tagName });
    }

    return this.recordResult("controlled-write", "ran", {
      ok: true,
      state: this.state,
      message: "Controlled write completed and read-back verified.",
      identity: this.identity,
      compare: this.compare,
    }, { tagName: request.tagName, readBackQuality: readBack.quality });
  }

  private stateForCompare(compare: CompareResult): OnlineConnectionState {
    if (compare.state === "matched") return "online-matched";
    if (compare.state === "mismatched") return "online-mismatched";
    return "online-readonly";
  }

  private async identityWithConfiguredTags(
    driver: ControllerDriver,
    baseIdentity: ControllerIdentity,
  ): Promise<ControllerIdentity> {
    if (!hasIdentityTags(this.identityTags)) return baseIdentity;
    const capabilities = controllerDriverCapabilities(driver);
    if (capabilities.canReadTags !== true) {
      this.record("identity-evidence", "blocked", `${driver.name} cannot read configured identity proof tags.`, {
        capability: "canReadTags",
        requestedFields: Object.keys(this.identityTags),
        ...driverAuditDetails(driver),
      });
      return baseIdentity;
    }

    const identity: ControllerIdentity = { ...baseIdentity };
    const applied: Record<string, string> = {};
    const failed: Record<string, string> = {};
    for (const [field, tagName] of Object.entries(this.identityTags) as Array<[ControllerIdentityProofField, string]>) {
      try {
        const value = await driver.readTag(tagName);
        const text = identityEvidenceText(value.value);
        if (!text) {
          failed[field] = `${tagName} did not return a scalar identity value.`;
          continue;
        }
        identity[field] = text;
        applied[field] = tagName;
        if (field === "projectSignature") {
          identity.projectSignatureSource = `controller-tag:${tagName}`;
          identity.projectSignatureAlgorithm ??= projectSignatureAlgorithm(text);
        }
      } catch (cause) {
        failed[field] = cause instanceof Error ? cause.message : String(cause);
      }
    }

    const appliedCount = Object.keys(applied).length;
    const failedCount = Object.keys(failed).length;
    this.record(
      "identity-evidence",
      appliedCount > 0 ? "ran" : "failed",
      `Read ${appliedCount}/${appliedCount + failedCount} configured identity proof tag(s).`,
      {
        applied,
        failed: failedCount > 0 ? failed : undefined,
        ...driverAuditDetails(driver),
      },
    );
    identity.projectSignature = normalizeProjectSignature(identity.projectSignature, identity.projectSignatureAlgorithm);
    return identity;
  }

  private async computeCompare(driver: ControllerDriver, localProject: PlcProject): Promise<CompareResult> {
    if (hasIdentityTags(this.identityTags)) {
      const identity = this.identity ?? await this.identityWithConfiguredTags(driver, await driver.getIdentity());
      return compareControllerIdentity(localProjectIdentity(localProject), identity);
    }
    return driver.compareProject
      ? driver.compareProject(localProject)
      : compareControllerIdentity(
        localProjectIdentity(localProject),
        this.identity ?? await this.identityWithConfiguredTags(driver, await driver.getIdentity()),
      );
  }

  private requireDriver(): ControllerDriver {
    if (!this.activeDriver) throw new Error("No controller driver is selected.");
    return this.activeDriver;
  }

  private requireOnlineDriver(): ControllerDriver {
    const driver = this.requireDriver();
    if (!isOnlineState(this.state)) throw new Error("Controller Gateway is not online.");
    return driver;
  }

  private requireCapability(
    driver: ControllerDriver,
    capability: keyof ControllerDriverCapabilities,
    action: string,
    message: string,
  ): ControllerDriverCapabilities {
    const capabilities = controllerDriverCapabilities(driver);
    if (capabilities[capability] !== true) {
      this.record(action, "blocked", message, {
        capability,
        ...driverAuditDetails(driver),
      });
      throw new Error(message);
    }
    return capabilities;
  }

  private block(action: string, message: string, details?: Record<string, unknown>): ConnectionResult {
    this.record(action, "blocked", message, {
      ...details,
      ...(this.activeDriver ? driverAuditDetails(this.activeDriver) : {}),
    });
    return {
      ok: false,
      state: this.state,
      message,
      identity: this.identity,
      compare: this.compare,
      connectionEvidence: this.activeDriver ? controllerConnectionEvidence(this.activeDriver) : undefined,
    };
  }

  private recordResult(
    action: string,
    result: OnlineAuditEntry["result"],
    payload: ConnectionResult,
    details?: Record<string, unknown>,
  ): ConnectionResult {
    this.record(action, result, payload.message, details);
    return payload;
  }

  private record(
    action: string,
    result: OnlineAuditEntry["result"],
    message: string,
    details?: Record<string, unknown>,
  ): void {
    this.auditEntries.push({
      id: auditId(),
      at: stamp(),
      action,
      state: this.state,
      driverId: this.activeDriver?.id,
      result,
      message,
      ...(details ? { details: compactAuditDetails(details) } : {}),
    });
  }
}

function driverAuditDetails(driver: ControllerDriver): Record<string, unknown> {
  return {
    driverName: driver.name,
    driverKind: driver.kind,
    connectionEvidence: compactConnectionEvidence(controllerConnectionEvidence(driver)),
  };
}

function compactConnectionEvidence(evidence: ControllerConnectionEvidence): Record<string, unknown> {
  return {
    transportValidation: evidence.transportValidation,
    realControllerIo: evidence.realControllerIo,
    hardwareValidated: evidence.hardwareValidated,
    verified: evidence.verified,
    label: evidence.label,
  };
}

const IDENTITY_TAG_FIELDS: readonly ControllerIdentityProofField[] = [
  "controllerName",
  "controllerType",
  "firmwareRevision",
  "projectName",
  "projectSignature",
  "projectSignatureAlgorithm",
];

function normalizeIdentityTags(tags: ControllerIdentityTagMap | undefined): ControllerIdentityTagMap | undefined {
  if (!tags) return undefined;
  const normalized: ControllerIdentityTagMap = {};
  for (const field of IDENTITY_TAG_FIELDS) {
    const tagName = tags[field]?.trim();
    if (tagName) normalized[field] = tagName;
  }
  return hasIdentityTags(normalized) ? normalized : undefined;
}

function hasIdentityTags(tags: ControllerIdentityTagMap | undefined): tags is ControllerIdentityTagMap {
  return tags !== undefined && IDENTITY_TAG_FIELDS.some((field) => tags[field]?.trim());
}

function identityEvidenceText(value: TagValuePayload): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.length === 1) return identityEvidenceText(value[0]);
  return undefined;
}

function projectSignatureAlgorithm(signature: string): string | undefined {
  const separator = signature.indexOf(":");
  return separator > 0 ? signature.slice(0, separator) : undefined;
}

function normalizeProjectSignature(signature: string | undefined, algorithm: string | undefined): string | undefined {
  if (!signature || signature.includes(":")) return signature;
  return algorithm?.trim() ? `${algorithm.trim()}:${signature}` : signature;
}

function compareAuditDetails(compare: CompareResult): Record<string, unknown> {
  return {
    state: compare.state,
    matched: compare.matched,
    differenceCount: compare.differences.length,
    blockingDifferenceCount: compare.differences.filter((difference) => difference.severity === "blocking").length,
  };
}

function compactAuditDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined),
  );
}

function describeReadOnlyReason(
  state: OnlineConnectionState,
  capabilities: ControllerDriverCapabilities | undefined,
  compare: CompareResult | undefined,
): string {
  if (!capabilities) return "No online driver is selected.";
  if (!capabilities.canConnect) return "Selected driver path is a placeholder and has no live controller transport.";
  if (state === "disconnected") return "Controller status reports the session is disconnected.";
  if (state === "faulted") return "Controller status reports a faulted session.";
  if (!capabilities.canWriteTags) {
    return "Public ESCO online mode is read-only for this milestone; tag writes, downloads, online edits, forces, mode changes, and clear-fault commands are blocked.";
  }
  if (state !== "online-matched" && state !== "online-controlled-write") {
    return compare?.message ?? "Local/controller match is not proven; writes stay blocked.";
  }
  return "Controlled writes require confirmation, permission, audit, and read-back.";
}
