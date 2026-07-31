/**
 * ESCO Online Session Manager (web front half) — framework-free state owner
 * for the gateway-backed online session.
 *
 * React components render this state through `useEscoGateway()` and call the
 * action methods; the network work happens in `EscoGatewayClient`, the real
 * drivers live behind the backend API. Components never see a driver
 * (Goal B rule 6).
 *
 * Design rules:
 * - NO WRITE ACTIONS. The read-only milestone has none, end to end.
 * - Actions never throw at the UI: failures land in `lastError` (and
 *   `lastConnectResult` for connect attempts) so panels can render reasons.
 * - State is an immutable snapshot object; every change swaps the reference
 *   and notifies subscribers (compatible with `useSyncExternalStore`).
 */

import type {
  ApiAuthContext,
  BatchTagReadResult,
  CompareResult,
  ConnectionConfig,
  ConnectionResult,
  ControllerIdentity,
  ControllerStatus,
  FaultInfo,
  GatewayValidationReadinessReport,
  IdentityProofTagExport,
  OnlineAuditEntry,
  OnlineSnapshot,
  ProjectSnapshot,
  SiteGatewayPolicyReport,
  TagDefinition,
  TagValue,
} from "./gateway-contract";
import type { PlcProject } from "@esco/core";
import {
  EscoGatewayClient,
  GatewayApiError,
  type GatewayTagStreamHandle,
  type GatewayDriverSummary,
  type GatewayStatusPayload,
} from "./gateway-client";

/** The slice of the gateway client this controller uses (injectable in tests). */
export interface GatewayClientLike {
  authContext(): Promise<ApiAuthContext>;
  listDrivers(): Promise<GatewayDriverSummary[]>;
  validationReadiness(): Promise<GatewayValidationReadinessReport>;
  siteGatewayPolicy(): Promise<SiteGatewayPolicyReport>;
  session(): Promise<OnlineSnapshot>;
  connect(
    driverId: string,
    config?: ConnectionConfig,
    localProject?: PlcProject,
  ): Promise<ConnectionResult>;
  disconnect(): Promise<{ ok: boolean }>;
  identity(): Promise<ControllerIdentity>;
  projectIdentity(localProject: PlcProject): Promise<ControllerIdentity>;
  projectIdentityProofTags(localProject: PlcProject): Promise<IdentityProofTagExport>;
  status(): Promise<GatewayStatusPayload>;
  faults(): Promise<FaultInfo[]>;
  browseTags(): Promise<TagDefinition[]>;
  readTag(tagName: string): Promise<TagValue>;
  readTags(tagNames: string[]): Promise<BatchTagReadResult>;
  subscribeTags(
    tagNames: string[],
    onValue: (value: TagValue) => void,
    onError: (message: string) => void,
  ): GatewayTagStreamHandle;
  compareProject(localProject: PlcProject): Promise<CompareResult>;
  uploadSnapshot(): Promise<ProjectSnapshot>;
  audit(): Promise<OnlineAuditEntry[]>;
}

export interface EscoOnlineSessionState {
  /**
   * Whether the backend gateway API answered at all. `undefined` until the
   * first availability check; `false` shows "start the ESCO API host"
   * guidance instead of pretending controllers are unreachable.
   */
  apiAvailable: boolean | undefined;
  /** Hosted/local API authentication context, if the API host answered. */
  authContext: ApiAuthContext | undefined;
  drivers: GatewayDriverSummary[];
  snapshot: OnlineSnapshot | undefined;
  status: ControllerStatus | undefined;
  identity: ControllerIdentity | undefined;
  tags: TagDefinition[];
  tagValues: Readonly<Record<string, TagValue>>;
  /** Per-tag read failures from the latest batch poll (tag name → reason). */
  tagErrors: Readonly<Record<string, string>>;
  /** Per-tag stale/disconnected reasons for values that are no longer live. */
  staleTagReasons: Readonly<Record<string, string>>;
  /** Tag names whose value payload changed during the latest successful read. */
  changedTagNames: readonly string[];
  /** Active read-only polling loop, if any. */
  polling: { names: readonly string[]; intervalMs: number } | undefined;
  /** Active read-only gateway subscription stream, if any. */
  streaming: { names: readonly string[] } | undefined;
  /** Latest explicit B5 local-vs-online identity compare result. */
  compareResult: CompareResult | undefined;
  /** Gateway-wide validation/readiness report for physical online routes. */
  validationReadiness: GatewayValidationReadinessReport | undefined;
  /** Hosted/site-gateway policy for real-controller routes. */
  siteGatewayPolicy: SiteGatewayPolicyReport | undefined;
  /** Local project identity/signature used for configuring read-only proof tags. */
  localProjectIdentity: ControllerIdentity | undefined;
  /** Latest read-only upload snapshot captured through the gateway. */
  uploadedSnapshot: ProjectSnapshot | undefined;
  faults: FaultInfo[];
  audit: OnlineAuditEntry[];
  /** True while any action is in flight (UI disables buttons). */
  busy: boolean;
  /** Human-readable failure of the most recent action, if it failed. */
  lastError: string | undefined;
  /** Full result of the most recent connect attempt (ok or failed). */
  lastConnectResult: ConnectionResult | undefined;
}

const INITIAL_STATE: EscoOnlineSessionState = {
  apiAvailable: undefined,
  authContext: undefined,
  drivers: [],
  snapshot: undefined,
  status: undefined,
  identity: undefined,
  tags: [],
  tagValues: {},
  tagErrors: {},
  staleTagReasons: {},
  changedTagNames: [],
  polling: undefined,
  streaming: undefined,
  compareResult: undefined,
  validationReadiness: undefined,
  siteGatewayPolicy: undefined,
  localProjectIdentity: undefined,
  uploadedSnapshot: undefined,
  faults: [],
  audit: [],
  busy: false,
  lastError: undefined,
  lastConnectResult: undefined,
};

/** Consecutive transport failures after which a polling loop self-stops. */
const MAX_POLL_FAILURES = 3;

export class EscoOnlineSession {
  private state: EscoOnlineSessionState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private streamHandle: GatewayTagStreamHandle | undefined;
  private pollFailures = 0;
  private pollGeneration = 0;
  private pollInFlightGeneration: number | undefined;

  constructor(private readonly client: GatewayClientLike = new EscoGatewayClient()) {}

  getState(): EscoOnlineSessionState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Pings the API host: driver list + session snapshot. Safe to call anytime. */
  async refreshAvailability(): Promise<void> {
    await this.run(async () => {
      let authContext: ApiAuthContext | undefined;
      try {
        authContext = await this.client.authContext();
        const [drivers, snapshot, validationReadiness, siteGatewayPolicy] = await Promise.all([
          this.client.listDrivers(),
          this.client.session(),
          this.client.validationReadiness(),
          this.client.siteGatewayPolicy(),
        ]);
        this.patch({ apiAvailable: true, authContext, drivers, snapshot, validationReadiness, siteGatewayPolicy, lastError: undefined });
      } catch (cause) {
        this.patch({
          apiAvailable: false,
          authContext,
          drivers: [],
          snapshot: undefined,
          validationReadiness: undefined,
          siteGatewayPolicy: undefined,
          lastError: describeError(cause),
        });
      }
    });
  }

  /**
   * Opens an online session. A failed connect is a RESULT (rendered by the
   * UI), not an exception; transport errors land in `lastError`.
   */
  async connect(
    driverId: string,
    config: ConnectionConfig = {},
    localProject?: PlcProject,
  ): Promise<ConnectionResult | undefined> {
    return this.run(async () => {
      try {
        const result = await this.client.connect(driverId, config, localProject);
        const snapshot = await this.client.session();
        this.patch({
          apiAvailable: true,
          snapshot,
          identity: result.identity ?? this.state.identity,
          status: result.status ?? this.state.status,
          lastConnectResult: result,
          compareResult: result.compare,
          uploadedSnapshot: undefined,
          lastError: result.ok ? undefined : result.message,
          // A new session invalidates anything read from a previous one.
          tags: [],
          tagValues: {},
          tagErrors: {},
          staleTagReasons: {},
          changedTagNames: [],
          faults: [],
        });
        return result;
      } catch (cause) {
        this.patch({ lastError: describeError(cause) });
        return undefined;
      }
    });
  }

  async disconnect(): Promise<void> {
    this.stopTagPolling();
    this.stopTagStream();
    await this.run(async () => {
      try {
        await this.client.disconnect();
        const snapshot = await this.client.session();
        this.patch({
          snapshot,
          status: undefined,
          identity: undefined,
          tags: [],
          tagValues: {},
          tagErrors: {},
          staleTagReasons: {},
          changedTagNames: [],
          streaming: undefined,
          compareResult: undefined,
          uploadedSnapshot: undefined,
          faults: [],
          lastError: undefined,
        });
      } catch (cause) {
        this.patch({ lastError: describeError(cause) });
      }
    });
  }

  /** Refreshes controller identity evidence through the gateway. */
  async refreshIdentity(): Promise<ControllerIdentity | undefined> {
    return this.run(async () => {
      try {
        const identity = await this.client.identity();
        const snapshot = await this.client.session();
        this.patch({ apiAvailable: true, identity, snapshot, lastError: undefined });
        return identity;
      } catch (cause) {
        this.patch({ lastError: describeError(cause) });
        return undefined;
      }
    });
  }

  /** Refreshes snapshot + controller status + faults for the online session. */
  async refreshStatus(): Promise<void> {
    await this.run(async () => {
      try {
        const payload = await this.client.status();
        const staleReason = liveWatchStaleReason(payload);
        if (staleReason) {
          this.stopTagPolling(staleReason);
          this.stopTagStream(staleReason);
        }
        const canReadFaults =
          payload.snapshot.state.startsWith("online-") &&
          payload.snapshot.capabilities?.canReadFaults !== false;
        const faults = canReadFaults ? await this.client.faults() : [];
        this.patch({
          apiAvailable: true,
          snapshot: payload.snapshot,
          status: payload.status,
          faults,
          lastError: undefined,
        });
      } catch (cause) {
        this.patch({ lastError: describeError(cause) });
      }
    });
  }

  async browseTags(): Promise<void> {
    await this.run(async () => {
      try {
        const tags = await this.client.browseTags();
        this.patch({ tags, lastError: undefined });
      } catch (cause) {
        this.patch({ lastError: describeError(cause) });
      }
    });
  }

  /** Runs the explicit B5 local-project identity comparison through the gateway. */
  async compareProject(localProject: PlcProject): Promise<CompareResult | undefined> {
    return this.run(async () => {
      try {
        const identity = await this.client.identity();
        this.patch({ identity });
        const compareResult = await this.client.compareProject(localProject);
        const snapshot = await this.client.session();
        this.patch({ identity, snapshot, compareResult, lastError: undefined });
        return compareResult;
      } catch (cause) {
        this.patch({ lastError: describeError(cause) });
        return undefined;
      }
    });
  }

  /** Computes the local project identity/signature through the gateway API. */
  async refreshLocalProjectIdentity(localProject: PlcProject): Promise<ControllerIdentity | undefined> {
    return this.run(async () => {
      try {
        const localProjectIdentity = await this.client.projectIdentity(localProject);
        this.patch({ apiAvailable: true, localProjectIdentity, lastError: undefined });
        return localProjectIdentity;
      } catch (cause) {
        this.patch({ lastError: describeError(cause) });
        return undefined;
      }
    });
  }

  /** Builds an offline L5X proof-tag component through the gateway API. */
  async exportIdentityProofTags(localProject: PlcProject): Promise<IdentityProofTagExport | undefined> {
    return this.run(async () => {
      try {
        const proofTags = await this.client.projectIdentityProofTags(localProject);
        this.patch({ apiAvailable: true, localProjectIdentity: proofTags.identity, lastError: undefined });
        return proofTags;
      } catch (cause) {
        this.patch({ lastError: describeError(cause) });
        return undefined;
      }
    });
  }

  /** Captures a read-only snapshot from the gateway and caches its tag values. */
  async uploadSnapshot(): Promise<ProjectSnapshot | undefined> {
    return this.run(async () => {
      try {
        const uploadedSnapshot = await this.client.uploadSnapshot();
        const merged: Record<string, TagValue> = { ...this.state.tagValues };
        for (const value of uploadedSnapshot.tags) merged[value.tagName] = value;
        const staleTagReasons = clearTagReasons(this.state.staleTagReasons, uploadedSnapshot.tags.map((value) => value.tagName));
        this.patch({
          uploadedSnapshot,
          tagValues: merged,
          staleTagReasons,
          changedTagNames: changedTagNames(this.state.tagValues, uploadedSnapshot.tags),
          lastError: undefined,
        });
        return uploadedSnapshot;
      } catch (cause) {
        this.patch({ lastError: describeError(cause) });
        return undefined;
      }
    });
  }

  /** Reads one tag and caches its value for the tag table. */
  async readTag(tagName: string): Promise<TagValue | undefined> {
    return this.run(async () => {
      try {
        const value = await this.client.readTag(tagName);
        const tagErrors = { ...this.state.tagErrors };
        const staleTagReasons = { ...this.state.staleTagReasons };
        delete tagErrors[tagName];
        delete staleTagReasons[tagName];
        this.patch({
          tagValues: { ...this.state.tagValues, [tagName]: value },
          tagErrors,
          staleTagReasons,
          changedTagNames: changedTagNames(this.state.tagValues, [value]),
          lastError: undefined,
        });
        return value;
      } catch (cause) {
        const message = describeError(cause);
        const tagErrors = { ...this.state.tagErrors, [tagName]: message };
        const staleTagReasons = { ...this.state.staleTagReasons, [tagName]: "stale: read failed" };
        this.patch({ tagErrors, staleTagReasons, lastError: message });
        return undefined;
      }
    });
  }

  /**
   * Batched read for watch surfaces: merges values and per-tag errors. A
   * transport/operational failure returns undefined (and sets `lastError`);
   * per-tag failures do NOT — they land in `tagErrors`.
   */
  async readTags(tagNames: readonly string[]): Promise<BatchTagReadResult | undefined> {
    return this.run(async () => {
      try {
        const result = await this.client.readTags([...tagNames]);
        this.applyTagReadResult(result);
        return result;
      } catch (cause) {
        const message = describeError(cause);
        this.markTagsStale(tagNames, "stale: gateway disconnected");
        this.patch({ lastError: message });
        return undefined;
      }
    });
  }

  /**
   * Starts a read-only polling loop over `tagNames`. Restarts any existing
   * loop; stops automatically after {@link MAX_POLL_FAILURES} consecutive
   * transport failures (a dead API should not be hammered forever) and on
   * disconnect. This is client-side polling — honest stand-in until a real
   * subscription path (Forward Open) exists.
   */
  startTagPolling(tagNames: readonly string[], intervalMs = 2000): void {
    this.stopTagStream(undefined, false);
    this.stopTagPolling(undefined, false);
    const names = normalizeTagNames(tagNames);
    if (names.length === 0) return;
    this.pollGeneration += 1;
    const generation = this.pollGeneration;
    this.pollFailures = 0;
    this.patch({ polling: { names, intervalMs }, staleTagReasons: clearTagReasons(this.state.staleTagReasons, names) });
    const tick = async (): Promise<void> => {
      const outcome = await this.samplePolledTags(names, generation);
      if (outcome === "obsolete") return;
      if (outcome === "ok") {
        this.pollFailures = 0;
        return;
      }
      this.pollFailures += 1;
      if (this.pollFailures >= MAX_POLL_FAILURES) {
        this.stopTagPolling("stale: gateway disconnected");
        this.patch({
          lastError: `${this.state.lastError ?? "Polling failed"} — watch stopped after ${MAX_POLL_FAILURES} consecutive failures.`,
        });
      }
    };
    void tick(); // immediate first sample
    this.pollTimer = setInterval(() => void tick(), intervalMs);
  }

  stopTagPolling(reason = "stale: watch stopped", markStale = true): void {
    const names = this.state.polling?.names ?? [];
    this.pollGeneration += 1;
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (markStale && names.length > 0) this.markTagsStale(names, reason);
    if (this.state.polling !== undefined) {
      this.patch({ polling: undefined });
    }
  }

  /**
   * Starts the gateway subscription stream when the active driver supports it
   * (simulator today). Unsupported drivers surface a message and leave polling
   * available as the honest fallback.
   */
  startTagStream(tagNames: readonly string[]): void {
    this.stopTagPolling(undefined, false);
    this.stopTagStream(undefined, false);
    const names = normalizeTagNames(tagNames);
    if (names.length === 0) return;
    let failedImmediately = false;
    this.patch({ streaming: { names }, staleTagReasons: clearTagReasons(this.state.staleTagReasons, names), lastError: undefined });
    try {
      const handle = this.client.subscribeTags(
        names,
        (value) => {
          const tagErrors = { ...this.state.tagErrors };
          const staleTagReasons = { ...this.state.staleTagReasons };
          delete tagErrors[value.tagName];
          delete staleTagReasons[value.tagName];
          this.patch({
            tagValues: { ...this.state.tagValues, [value.tagName]: value },
            tagErrors,
            staleTagReasons,
            changedTagNames: changedTagNames(this.state.tagValues, [value]),
            lastError: undefined,
          });
        },
        (message) => {
          failedImmediately = true;
          this.markTagsStale(names, "stale: stream disconnected");
          this.patch({ streaming: undefined, lastError: message });
          this.streamHandle?.close();
          this.streamHandle = undefined;
        },
      );
      if (failedImmediately) handle.close();
      else this.streamHandle = handle;
    } catch (cause) {
      this.patch({ streaming: undefined, lastError: describeError(cause) });
    }
  }

  stopTagStream(reason = "stale: watch stopped", markStale = true): void {
    const names = this.state.streaming?.names ?? [];
    this.streamHandle?.close();
    this.streamHandle = undefined;
    if (markStale && names.length > 0) this.markTagsStale(names, reason);
    if (this.state.streaming !== undefined) {
      this.patch({ streaming: undefined });
    }
  }

  async refreshAudit(): Promise<void> {
    await this.run(async () => {
      try {
        const audit = await this.client.audit();
        this.patch({ audit, lastError: undefined });
      } catch (cause) {
        this.patch({ lastError: describeError(cause) });
      }
    });
  }

  // NO write action exists here, by design (Goal B rule 8). A future write
  // path arrives with confirmation, permission, audit, and read-back flows.

  private async run<T>(work: () => Promise<T>): Promise<T> {
    this.patch({ busy: true });
    try {
      return await work();
    } finally {
      this.patch({ busy: false });
    }
  }

  private patch(partial: Partial<EscoOnlineSessionState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  private applyTagReadResult(result: BatchTagReadResult): void {
    const merged: Record<string, TagValue> = { ...this.state.tagValues };
    const changed = changedTagNames(this.state.tagValues, result.values);
    for (const value of result.values) merged[value.tagName] = value;
    const staleTagReasons = clearTagReasons(this.state.staleTagReasons, result.values.map((value) => value.tagName));
    this.patch({ tagValues: merged, tagErrors: result.errors, staleTagReasons, changedTagNames: changed, lastError: undefined });
  }

  private async samplePolledTags(
    tagNames: readonly string[],
    generation: number,
  ): Promise<"ok" | "failed" | "obsolete"> {
    if (this.pollInFlightGeneration === generation) return "obsolete";
    this.pollInFlightGeneration = generation;
    this.patch({ busy: true });
    try {
      const result = await this.client.readTags([...tagNames]);
      if (!this.isCurrentPollingGeneration(generation, tagNames)) return "obsolete";
      this.applyTagReadResult(result);
      return "ok";
    } catch (cause) {
      if (!this.isCurrentPollingGeneration(generation, tagNames)) return "obsolete";
      const message = describeError(cause);
      this.markTagsStale(tagNames, "stale: gateway disconnected");
      this.patch({ lastError: message });
      return "failed";
    } finally {
      if (this.pollInFlightGeneration === generation) {
        this.pollInFlightGeneration = undefined;
        this.patch({ busy: false });
      }
    }
  }

  private isCurrentPollingGeneration(generation: number, tagNames: readonly string[]): boolean {
    return (
      this.pollGeneration === generation &&
      this.state.polling !== undefined &&
      sameNames(this.state.polling.names, normalizeTagNames(tagNames))
    );
  }

  private markTagsStale(tagNames: readonly string[], reason: string): void {
    const names = normalizeTagNames(tagNames);
    if (names.length === 0) return;
    const staleTagReasons = { ...this.state.staleTagReasons };
    for (const name of names) staleTagReasons[name] = reason;
    this.patch({ staleTagReasons });
  }
}

function describeError(cause: unknown): string {
  if (cause instanceof GatewayApiError) return cause.message;
  if (cause instanceof Error) {
    // fetch network failures are TypeErrors with environment-specific text;
    // translate to actionable guidance.
    return `ESCO gateway API is unreachable (${cause.message}). Start it with: pnpm --filter @esco/api dev`;
  }
  return String(cause);
}

function liveWatchStaleReason(payload: GatewayStatusPayload): string | undefined {
  if (payload.status && (!payload.status.connected || payload.status.state === "disconnected")) {
    return "stale: session disconnected";
  }
  if (payload.snapshot.state === "disconnected" || payload.snapshot.state === "offline") {
    return "stale: session disconnected";
  }
  if (
    payload.snapshot.state === "faulted" ||
    payload.status?.state === "faulted" ||
    payload.status?.health === "faulted"
  ) {
    return "stale: controller faulted";
  }
  if (!payload.snapshot.state.startsWith("online-")) {
    return "stale: session not online";
  }
  return undefined;
}

function changedTagNames(
  previous: Readonly<Record<string, TagValue>>,
  nextValues: readonly TagValue[],
): string[] {
  return nextValues
    .filter((value) => {
      const old = previous[value.tagName];
      return old !== undefined && valueSignature(old) !== valueSignature(value);
    })
    .map((value) => value.tagName);
}

function normalizeTagNames(tagNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function clearTagReasons(
  staleTagReasons: Readonly<Record<string, string>>,
  tagNames: readonly string[],
): Readonly<Record<string, string>> {
  const names = normalizeTagNames(tagNames);
  if (names.length === 0) return staleTagReasons;
  let changed = false;
  const next = { ...staleTagReasons };
  for (const name of names) {
    if (next[name] !== undefined) {
      delete next[name];
      changed = true;
    }
  }
  return changed ? next : staleTagReasons;
}

function valueSignature(value: TagValue): string {
  return JSON.stringify([value.value, value.quality, value.dataType]);
}

let defaultSession: EscoOnlineSession | undefined;

/** Shared app-wide session (panels and status bar render the same state). */
export function getDefaultEscoOnlineSession(): EscoOnlineSession {
  defaultSession ??= new EscoOnlineSession();
  return defaultSession;
}
