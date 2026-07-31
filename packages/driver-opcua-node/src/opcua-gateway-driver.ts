/**
 * Generic OPC UA gateway driver for Goal B.
 *
 * BACKEND ONLY: this package is imported by apps/api, never by React. It uses
 * a generic OPC UA client library and does not require FactoryTalk, RSLinx,
 * Studio 5000, `.ACD`, or any vendor runtime. If a plant exposes controller
 * tags through an OPC UA server, ESCO can read/browse/subscribe through this
 * seam while preserving the same gateway safety rules.
 *
 * READ-ONLY: no `writeTag`, no upload/download, no online edit, no forces.
 * Controlled writes remain absent until the full permission/confirmation/
 * audit/read-back design is deliberately added and reviewed.
 */

import "reflect-metadata";

import type {
  BatchTagReadResult,
  ConnectionConfig,
  ControllerConnectionEvidence,
  ControllerDiagnostic,
  ConnectionResult,
  ControllerDriver,
  ControllerDriverCapabilities,
  ControllerDriverKind,
  ControllerIdentity,
  ControllerStatus,
  FaultInfo,
  SubscriptionHandle,
  TagDefinition,
  TagQuality,
  TagSubscriptionCallback,
  TagValue,
  TagValuePayload,
} from "@esco/controller-gateway";

export const OPCUA_GATEWAY_DRIVER_ID = "opcua-generic-readonly";

const now = (): string => new Date().toISOString();
const DEFAULT_ROOT_NODE_ID = "ObjectsFolder";
const DEFAULT_MAX_BROWSE_DEPTH = 4;
const DEFAULT_MAX_BROWSE_NODES = 500;
const DEFAULT_SAMPLING_INTERVAL_MS = 500;

const STANDARD_IDENTITY_NODES = {
  productName: "ns=0;i=2261",
  manufacturerName: "ns=0;i=2263",
  softwareVersion: "ns=0;i=2264",
  buildNumber: "ns=0;i=2265",
} as const;
const STANDARD_STATUS_NODES = {
  currentTime: "ns=0;i=2258",
} as const;

export interface OpcUaDriverConfig extends ConnectionConfig {
  endpointUrl?: string;
  rootNodeId?: string;
  rootNodeIds?: string[];
  nodeMap?: Record<string, string>;
  maxBrowseDepth?: number;
  maxBrowseNodes?: number;
  samplingIntervalMs?: number;
}

export interface OpcUaBrowseNode {
  nodeId: string;
  browseName: string;
  displayName?: string;
  nodeClass?: "Object" | "Variable" | "Method" | "Unknown";
  dataType?: string;
}

export interface OpcUaReadResult {
  nodeId: string;
  value: unknown;
  dataType?: string;
  statusCode?: string;
  sourceTimestamp?: string;
  serverTimestamp?: string;
}

export interface OpcUaSubscriptionRequest {
  tagName: string;
  nodeId: string;
}

export interface OpcUaSessionAdapter {
  readNode(nodeId: string): Promise<OpcUaReadResult>;
  readNodes(nodeIds: readonly string[]): Promise<OpcUaReadResult[]>;
  browse(nodeId: string): Promise<OpcUaBrowseNode[]>;
  subscribe(
    nodes: readonly OpcUaSubscriptionRequest[],
    callback: (tagName: string, value: OpcUaReadResult) => void,
    options: { samplingIntervalMs: number },
  ): Promise<SubscriptionHandle>;
  close(): Promise<void>;
}

export interface OpcUaClientAdapter {
  connect(config: OpcUaDriverConfig): Promise<OpcUaSessionAdapter>;
}

interface CachedNode {
  tagName: string;
  nodeId: string;
  dataType?: string;
}

interface ActiveSubscription {
  handle: SubscriptionHandle;
  closed: boolean;
}

export class OpcUaGatewayDriver implements ControllerDriver {
  readonly id = OPCUA_GATEWAY_DRIVER_ID;
  readonly name = "Generic OPC UA Read-Only Driver";
  readonly kind: ControllerDriverKind = "opcua";
  readonly connectionEvidence: ControllerConnectionEvidence = {
    transportValidation: "software-wired",
    realControllerIo: true,
    hardwareValidated: false,
    verified: false,
    label: "Software-wired, not field-validated",
    message:
      "The generic OPC UA route is wired through the backend gateway; no FactoryTalk Linx Gateway lab or field validation evidence is attached.",
    limitations: [
      "Treat as engineering/lab preview until site endpoint validation is recorded.",
      "No writes, downloads, online edits, forces, mode changes, or clear-fault commands are exposed.",
      "Generic OPC UA identity does not prove the loaded PLC project.",
    ],
  };
  readonly capabilities: Partial<ControllerDriverCapabilities> = {
    canConnect: true,
    canReadStatus: true,
    canReadFaults: false,
    canBrowseTags: true,
    canReadTags: true,
    canBatchReadTags: true,
    canSubscribeTags: true,
    canUploadSnapshot: false,
    canCompareProject: true,
  };

  private session: OpcUaSessionAdapter | undefined;
  private config: Required<Pick<OpcUaDriverConfig, "maxBrowseDepth" | "maxBrowseNodes" | "samplingIntervalMs">> &
    OpcUaDriverConfig = {
      maxBrowseDepth: DEFAULT_MAX_BROWSE_DEPTH,
      maxBrowseNodes: DEFAULT_MAX_BROWSE_NODES,
      samplingIntervalMs: DEFAULT_SAMPLING_INTERVAL_MS,
  };
  private identity: ControllerIdentity = {};
  private readonly tagByName = new Map<string, CachedNode>();
  private readonly subscriptions = new Set<ActiveSubscription>();

  constructor(private readonly adapter: OpcUaClientAdapter = new NodeOpcUaClientAdapter()) {}

  async connect(config: OpcUaDriverConfig = {}): Promise<ConnectionResult> {
    const endpointUrl = config.endpointUrl?.trim();
    if (!endpointUrl) {
      return { ok: false, state: "disconnected", message: "OPC UA endpointUrl is required." };
    }
    if (!endpointUrl.startsWith("opc.tcp://")) {
      return { ok: false, state: "disconnected", message: "OPC UA endpointUrl must start with opc.tcp://." };
    }
    if (config.securityPolicy?.trim() && config.securityPolicy.trim().toLowerCase() !== "none") {
      return {
        ok: false,
        state: "disconnected",
        message:
          "OPC UA securityPolicy is not implemented in this read-only milestone. " +
          "Use an endpoint that allows no-message-security access or add a reviewed certificate/security configuration first.",
      };
    }

    this.config = normalizeConfig(config);
    this.tagByName.clear();
    try {
      this.session = await this.adapter.connect({ ...this.config, endpointUrl });
      this.seedNodeMap(this.config.nodeMap);
      this.identity = await this.readIdentity();
      const identity = this.identity;
      const status = await this.getStatus();
      if (!status.connected || status.state === "disconnected") {
        await this.disconnect();
        return {
          ok: false,
          state: "disconnected",
          message: `OPC UA connect to ${endpointUrl} failed read-only heartbeat: ${status.message}`,
          identity,
          status,
        };
      }
      return {
        ok: true,
        state: "online-readonly",
        message:
          "Connected to generic OPC UA endpoint through the ESCO Controller Gateway. " +
          "Project identity cannot be proven from OPC UA alone; writes remain read-only.",
        identity,
        status,
      };
    } catch (cause) {
      await this.disconnect();
      return {
        ok: false,
        state: "disconnected",
        message: `OPC UA connect to ${endpointUrl} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
  }

  async disconnect(): Promise<void> {
    await this.closeSubscriptions();
    await this.session?.close().catch(() => undefined);
    this.session = undefined;
    this.tagByName.clear();
    this.identity = {};
  }

  async getIdentity(): Promise<ControllerIdentity> {
    this.assertConnected();
    return this.identity;
  }

  async getStatus(): Promise<ControllerStatus> {
    const session = this.session;
    if (!session) {
      return {
        state: "disconnected",
        connected: false,
        health: "unknown",
        message: "OPC UA read-only session is disconnected.",
        updatedAt: now(),
      };
    }
    try {
      const heartbeat = await session.readNode(STANDARD_STATUS_NODES.currentTime);
      const quality = qualityFromStatus(heartbeat.statusCode);
      const health = quality === "good" ? "ok" : "warning";
      return {
        state: "online-readonly",
        connected: true,
        health,
        message: health === "ok"
          ? "OPC UA read-only session heartbeat is healthy."
          : `OPC UA read-only session heartbeat quality is ${quality}.`,
        updatedAt: now(),
        diagnostics: [heartbeatDiagnostic(heartbeat, quality)],
      };
    } catch (cause) {
      return {
        state: "disconnected",
        connected: false,
        health: "warning",
        message: `OPC UA read-only session heartbeat failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        updatedAt: now(),
        diagnostics: [heartbeatFailureDiagnostic(cause)],
      };
    }
  }

  async getFaults(): Promise<FaultInfo[]> {
    this.assertConnected();
    throw new Error("Generic OPC UA fault reads are not implemented; map fault/status tags explicitly and watch them read-only.");
  }

  async browseTags(): Promise<TagDefinition[]> {
    const session = this.assertConnected();
    this.seedNodeMap(this.config.nodeMap);
    const roots = this.config.rootNodeIds?.length
      ? this.config.rootNodeIds
      : [this.config.rootNodeId ?? DEFAULT_ROOT_NODE_ID];
    const visited = new Set<string>();
    const definitions: TagDefinition[] = [];
    for (const root of roots) {
      await this.browseRecursive(session, root, [], 0, visited, definitions);
      if (definitions.length >= this.config.maxBrowseNodes) break;
    }
    for (const node of this.tagByName.values()) {
      if (!definitions.some((tag) => tag.name === node.tagName)) {
        await this.ensureNodeDataType(session, node);
        definitions.push(this.definitionFor(node));
      }
    }
    return definitions;
  }

  async readTag(tagName: string): Promise<TagValue> {
    const session = this.assertConnected();
    const node = await this.resolveNode(tagName);
    const result = await session.readNode(node.nodeId);
    if (result.dataType && !node.dataType) node.dataType = normalizeDataType(result.dataType);
    return this.valueFor(node.tagName, result, node.dataType);
  }

  async readTags(tagNames: string[]): Promise<BatchTagReadResult> {
    const values: TagValue[] = [];
    const errors: Record<string, string> = {};
    const session = this.assertConnected();
    const nodes: CachedNode[] = [];
    for (const tagName of tagNames) {
      try {
        nodes.push(await this.resolveNode(tagName));
      } catch (cause) {
        errors[tagName] = cause instanceof Error ? cause.message : String(cause);
      }
    }
    if (nodes.length === 0) return { values, errors };

    try {
      const results = await session.readNodes(nodes.map((node) => node.nodeId));
      if (results.length !== nodes.length) {
        throw new Error(`OPC UA batch read returned ${results.length}/${nodes.length} result(s).`);
      }
      for (const [index, result] of results.entries()) {
        const node = nodes[index];
        if (result.dataType && !node.dataType) node.dataType = normalizeDataType(result.dataType);
        values.push(this.valueFor(node.tagName, result, node.dataType));
      }
    } catch {
      // A service-level batch failure should not blank the whole watch table.
      // Retry as individual reads so per-tag errors remain visible.
      for (const node of nodes) {
        try {
          const result = await session.readNode(node.nodeId);
          if (result.dataType && !node.dataType) node.dataType = normalizeDataType(result.dataType);
          values.push(this.valueFor(node.tagName, result, node.dataType));
        } catch (cause) {
          errors[node.tagName] = cause instanceof Error ? cause.message : String(cause);
        }
      }
    }
    return { values, errors };
  }

  async subscribeTags(tagNames: string[], callback: TagSubscriptionCallback): Promise<SubscriptionHandle> {
    const session = this.assertConnected();
    const nodes = await Promise.all(tagNames.map(async (tagName) => this.resolveNode(tagName)));
    for (const node of nodes) {
      const initial = await session.readNode(node.nodeId);
      if (initial.dataType && !node.dataType) node.dataType = normalizeDataType(initial.dataType);
      callback(this.valueFor(node.tagName, initial, node.dataType));
    }
    const handle = await session.subscribe(
      nodes.map((node) => ({ tagName: node.tagName, nodeId: node.nodeId })),
      (tagName, value) => {
        const node = this.tagByName.get(tagName) ?? { tagName, nodeId: value.nodeId };
        callback(this.valueFor(tagName, value, node.dataType));
      },
      { samplingIntervalMs: this.config.samplingIntervalMs },
    );
    const active: ActiveSubscription = { handle, closed: false };
    this.subscriptions.add(active);
    return {
      id: handle.id,
      unsubscribe: async () => {
        await this.closeSubscription(active);
      },
    };
  }

  private async readIdentity(): Promise<ControllerIdentity> {
    const productName = await this.readOptionalString(STANDARD_IDENTITY_NODES.productName);
    const vendor = await this.readOptionalString(STANDARD_IDENTITY_NODES.manufacturerName);
    const softwareVersion = await this.readOptionalString(STANDARD_IDENTITY_NODES.softwareVersion);
    const buildNumber = await this.readOptionalString(STANDARD_IDENTITY_NODES.buildNumber);
    return {
      vendor,
      productName,
      firmwareRevision: [softwareVersion, buildNumber].filter(Boolean).join(" ") || undefined,
    };
  }

  private async readOptionalString(nodeId: string): Promise<string | undefined> {
    try {
      const result = await this.assertConnected().readNode(nodeId);
      return typeof result.value === "string" && result.value.trim() ? result.value.trim() : undefined;
    } catch {
      return undefined;
    }
  }

  private async browseRecursive(
    session: OpcUaSessionAdapter,
    nodeId: string,
    path: readonly string[],
    depth: number,
    visited: Set<string>,
    definitions: TagDefinition[],
  ): Promise<void> {
    if (depth > this.config.maxBrowseDepth || definitions.length >= this.config.maxBrowseNodes || visited.has(nodeId)) return;
    visited.add(nodeId);
    const children = await session.browse(nodeId);
    for (const child of children) {
      if (definitions.length >= this.config.maxBrowseNodes) return;
      const label = cleanSegment(child.displayName || child.browseName || child.nodeId);
      const nextPath = label ? [...path, label] : path;
      if (child.nodeClass === "Variable") {
        const tagName = uniqueTagName(nextPath.join(".") || child.nodeId, this.tagByName);
        const cached: CachedNode = {
          tagName,
          nodeId: child.nodeId,
          dataType: child.dataType ? normalizeDataType(child.dataType) : undefined,
        };
        this.tagByName.set(tagName, cached);
        await this.ensureNodeDataType(session, cached);
        definitions.push(this.definitionFor(cached));
      } else if (child.nodeClass === "Object" || child.nodeClass === undefined || child.nodeClass === "Unknown") {
        await this.browseRecursive(session, child.nodeId, nextPath, depth + 1, visited, definitions);
      }
    }
  }

  private async resolveNode(tagName: string): Promise<CachedNode> {
    const cached = this.tagByName.get(tagName);
    if (cached) return cached;
    const direct = tagName.trim();
    if (looksLikeNodeId(direct)) {
      const node = { tagName: direct, nodeId: direct };
      this.tagByName.set(direct, node);
      return node;
    }
    if (this.tagByName.size === 0) await this.browseTags();
    const afterBrowse = this.tagByName.get(tagName);
    if (afterBrowse) return afterBrowse;
    throw new Error(`Unknown OPC UA tag: ${tagName}`);
  }

  private valueFor(tagName: string, result: OpcUaReadResult, knownDataType?: string): TagValue {
    const coerced = coercePayload(result.value);
    const dataType = knownDataType ?? normalizeDataType(result.dataType);
    const statusQuality = qualityFromStatus(result.statusCode);
    return {
      tagName,
      value: coerced.payload,
      dataType,
      quality: statusQuality === "bad" ? "bad" : coerced.unsupported ? "uncertain" : statusQuality,
      timestamp: result.sourceTimestamp ?? result.serverTimestamp ?? now(),
      sourceDriver: this.kind,
    };
  }

  private definitionFor(node: CachedNode): TagDefinition {
    return {
      name: node.tagName,
      dataType: node.dataType ?? "OPC_UA",
      writable: false,
      sourceDriver: this.kind,
      address: node.nodeId,
    };
  }

  private async ensureNodeDataType(session: OpcUaSessionAdapter, node: CachedNode): Promise<void> {
    if (node.dataType) return;
    try {
      const result = await session.readNode(node.nodeId);
      node.dataType = normalizeDataType(result.dataType);
    } catch {
      // Some OPC UA servers allow browsing a variable but deny value reads.
      // Keep the tag visible as read-only OPC_UA instead of hiding it.
    }
  }

  private seedNodeMap(nodeMap: Record<string, string> | undefined): void {
    for (const [tagName, nodeId] of Object.entries(nodeMap ?? {})) {
      const name = tagName.trim();
      const address = nodeId.trim();
      if (name && address) this.tagByName.set(name, { tagName: name, nodeId: address });
    }
  }

  private assertConnected(): OpcUaSessionAdapter {
    if (!this.session) throw new Error("OPC UA driver is disconnected.");
    return this.session;
  }

  private async closeSubscriptions(): Promise<void> {
    const active = [...this.subscriptions];
    this.subscriptions.clear();
    await Promise.all(active.map((subscription) => this.closeSubscription(subscription)));
  }

  private async closeSubscription(subscription: ActiveSubscription): Promise<void> {
    if (subscription.closed) return;
    subscription.closed = true;
    this.subscriptions.delete(subscription);
    await subscription.handle.unsubscribe().catch(() => undefined);
  }
}

export class NodeOpcUaClientAdapter implements OpcUaClientAdapter {
  async connect(config: OpcUaDriverConfig): Promise<OpcUaSessionAdapter> {
    const opcua = await import("node-opcua-client");
    const client = opcua.OPCUAClient.create({
      endpointMustExist: false,
      connectionStrategy: { initialDelay: 500, maxRetry: 1 },
    });
    await client.connect(config.endpointUrl ?? "");
    const password = typeof config.metadata?.password === "string" ? config.metadata.password : undefined;
    const session = config.userName
      ? await client.createSession({ type: opcua.UserTokenType.UserName, userName: config.userName, password: password ?? "" })
      : await client.createSession();
    return new NodeOpcUaSessionAdapter(
      client as unknown as NodeOpcUaClient,
      session as unknown as NodeOpcUaSession,
      opcua as unknown as NodeOpcUaModule,
    );
  }
}

class NodeOpcUaSessionAdapter implements OpcUaSessionAdapter {
  constructor(
    private readonly client: NodeOpcUaClient,
    private readonly session: NodeOpcUaSession,
    private readonly opcua: NodeOpcUaModule,
  ) {}

  async readNode(nodeId: string): Promise<OpcUaReadResult> {
    const dataValue = await this.session.read({
      nodeId,
      attributeId: this.opcua.AttributeIds.Value,
    });
    return readResultFromDataValue(nodeId, dataValue, this.opcua);
  }

  async readNodes(nodeIds: readonly string[]): Promise<OpcUaReadResult[]> {
    const dataValues = await this.session.read(
      nodeIds.map((nodeId) => ({
        nodeId,
        attributeId: this.opcua.AttributeIds.Value,
      })),
    );
    return dataValues.map((dataValue, index) => readResultFromDataValue(nodeIds[index], dataValue, this.opcua));
  }

  async browse(nodeId: string): Promise<OpcUaBrowseNode[]> {
    const result = await this.session.browse(nodeId);
    return (result.references ?? []).map((reference: NodeOpcUaReference) => ({
      nodeId: reference.nodeId?.toString() ?? "",
      browseName: reference.browseName?.name?.toString() ?? reference.browseName?.toString() ?? "",
      displayName: reference.displayName?.text?.toString(),
      nodeClass: nodeClassName(reference.nodeClass, this.opcua),
    })).filter((node: OpcUaBrowseNode) => node.nodeId);
  }

  async subscribe(
    nodes: readonly OpcUaSubscriptionRequest[],
    callback: (tagName: string, value: OpcUaReadResult) => void,
    options: { samplingIntervalMs: number },
  ): Promise<SubscriptionHandle> {
    const subscription = this.opcua.ClientSubscription.create(this.session, {
      requestedPublishingInterval: options.samplingIntervalMs,
      requestedLifetimeCount: 60,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    });
    const monitoredItems: NodeOpcUaMonitoredItem[] = [];
    for (const node of nodes) {
      const item = this.opcua.ClientMonitoredItem.create(
        subscription,
        { nodeId: node.nodeId, attributeId: this.opcua.AttributeIds.Value },
        { samplingInterval: options.samplingIntervalMs, discardOldest: true, queueSize: 1 },
        this.opcua.TimestampsToReturn.Both,
      );
      item.on("changed", (dataValue: NodeOpcUaDataValue) => {
        callback(node.tagName, readResultFromDataValue(node.nodeId, dataValue, this.opcua));
      });
      monitoredItems.push(item);
    }
    return {
      id: `opcua-sub-${Date.now().toString(36)}`,
      unsubscribe: async () => {
        for (const item of monitoredItems) await item.terminate().catch(() => undefined);
        await subscription.terminate().catch(() => undefined);
      },
    };
  }

  async close(): Promise<void> {
    await this.session.close().catch(() => undefined);
    await this.client.disconnect().catch(() => undefined);
  }
}

function normalizeConfig(config: OpcUaDriverConfig): OpcUaGatewayDriver["config"] {
  return {
    ...config,
    maxBrowseDepth: positiveInt(config.maxBrowseDepth, DEFAULT_MAX_BROWSE_DEPTH),
    maxBrowseNodes: positiveInt(config.maxBrowseNodes, DEFAULT_MAX_BROWSE_NODES),
    samplingIntervalMs: positiveInt(config.samplingIntervalMs, DEFAULT_SAMPLING_INTERVAL_MS),
  };
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function looksLikeNodeId(value: string): boolean {
  return /^(ns=\d+;[isgb]=|i=\d+$|s=)/i.test(value);
}

function uniqueTagName(base: string, existing: Map<string, CachedNode>): string {
  const clean = base.trim() || "Node";
  if (!existing.has(clean)) return clean;
  let suffix = 2;
  while (existing.has(`${clean}_${suffix}`)) suffix += 1;
  return `${clean}_${suffix}`;
}

function cleanSegment(value: string): string {
  return value.replace(/\s+/g, "_").replace(/[^\w.:$-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeDataType(dataType: string | undefined): string | undefined {
  if (!dataType) return undefined;
  const value = dataType.toLowerCase();
  if (value.includes("boolean")) return "BOOL";
  if (value.includes("float") || value.includes("double")) return "REAL";
  if (value.includes("int64") || value.includes("uint64")) return "LINT";
  if (value.includes("int") || value.includes("byte")) return "DINT";
  if (value.includes("string")) return "STRING";
  if (value.includes("datetime")) return "DATE_AND_TIME";
  return dataType.toUpperCase();
}

function qualityFromStatus(statusCode: string | undefined): TagQuality {
  const status = (statusCode ?? "").toLowerCase();
  if (status.startsWith("good")) return "good";
  if (status.startsWith("bad")) return "bad";
  if (status.startsWith("uncertain")) return "uncertain";
  return status ? "uncertain" : "good";
}

function heartbeatDiagnostic(result: OpcUaReadResult, quality: TagQuality): ControllerDiagnostic {
  return {
    id: "opcua-heartbeat-quality",
    severity: quality === "good" ? "info" : "warning",
    label: "OPC UA heartbeat quality",
    message: quality === "good"
      ? "The standard OPC UA ServerStatus/CurrentTime heartbeat returned good quality."
      : `The standard OPC UA heartbeat returned ${quality} quality.`,
    source: `OPC UA node ${STANDARD_STATUS_NODES.currentTime}`,
    evidence: [
      `nodeId=${result.nodeId}`,
      `statusCode=${result.statusCode ?? "missing"}`,
      `dataType=${result.dataType ?? "unknown"}`,
      `sourceTimestamp=${result.sourceTimestamp ?? "missing"}`,
      `serverTimestamp=${result.serverTimestamp ?? "missing"}`,
    ],
    recommendation: quality === "good"
      ? "Map controller-specific fault/status nodes for richer PLC diagnostics when the OPC UA server exposes them."
      : "Check OPC UA server/session quality and plant network health; map vendor-specific fault/status nodes for controller faults.",
  };
}

function heartbeatFailureDiagnostic(cause: unknown): ControllerDiagnostic {
  return {
    id: "opcua-heartbeat-read-failed",
    severity: "warning",
    label: "OPC UA heartbeat read failed",
    message: cause instanceof Error ? cause.message : String(cause),
    source: `OPC UA node ${STANDARD_STATUS_NODES.currentTime}`,
    evidence: [`nodeId=${STANDARD_STATUS_NODES.currentTime}`, "read=failed"],
    recommendation: "Verify the OPC UA endpoint, session permissions, and access to the standard ServerStatus/CurrentTime node.",
  };
}

function coercePayload(value: unknown): { payload: TagValuePayload; unsupported: boolean } {
  if (isPrimitive(value)) return { payload: normalizePrimitive(value), unsupported: false };
  if (value instanceof Date) return { payload: value.toISOString(), unsupported: false };
  if (Array.isArray(value)) {
    const payload = value.map((item) => (isPrimitive(item) ? normalizePrimitive(item) : null));
    return { payload, unsupported: value.some((item) => !isPrimitive(item)) };
  }
  if (typeof value === "object" && value !== null) {
    const record: Record<string, boolean | number | string | null> = {};
    let unsupported = false;
    for (const [key, item] of Object.entries(value)) {
      if (isPrimitive(item)) record[key] = normalizePrimitive(item);
      else {
        record[key] = null;
        unsupported = true;
      }
    }
    return { payload: record, unsupported };
  }
  return { payload: null, unsupported: true };
}

function isPrimitive(value: unknown): value is boolean | number | string | null {
  return value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string";
}

function normalizePrimitive(value: boolean | number | string | null): boolean | number | string | null {
  return typeof value === "number" && !Number.isFinite(value) ? null : value;
}

function nodeClassName(value: unknown, opcua: NodeOpcUaModule): OpcUaBrowseNode["nodeClass"] {
  const name = typeof value === "number" ? opcua.NodeClass?.[value] : String(value ?? "");
  if (name === "Object" || name === "Variable" || name === "Method") return name;
  return "Unknown";
}

function asIso(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return undefined;
}

function readResultFromDataValue(
  nodeId: string,
  dataValue: NodeOpcUaDataValue,
  opcua: NodeOpcUaModule,
): OpcUaReadResult {
  return {
    nodeId,
    value: dataValue.value?.value,
    dataType: dataValue.value?.dataType !== undefined
      ? String(opcua.DataType[dataValue.value.dataType] ?? dataValue.value.dataType)
      : undefined,
    statusCode: dataValue.statusCode?.name ?? String(dataValue.statusCode ?? ""),
    sourceTimestamp: asIso(dataValue.sourceTimestamp),
    serverTimestamp: asIso(dataValue.serverTimestamp),
  };
}

interface NodeOpcUaDataValue {
  value?: { value?: unknown; dataType?: number | string };
  statusCode?: { name?: string };
  sourceTimestamp?: Date;
  serverTimestamp?: Date;
}

interface NodeOpcUaReference {
  nodeId?: { toString(): string };
  browseName?: { name?: { toString(): string }; toString(): string };
  displayName?: { text?: { toString(): string } | string };
  nodeClass?: unknown;
}

interface NodeOpcUaSession {
  read(request: { nodeId: string; attributeId: number }): Promise<NodeOpcUaDataValue>;
  read(requests: Array<{ nodeId: string; attributeId: number }>): Promise<NodeOpcUaDataValue[]>;
  browse(nodeId: string): Promise<{ references?: NodeOpcUaReference[] }>;
  close(): Promise<void>;
}

interface NodeOpcUaClient {
  connect(endpointUrl: string): Promise<void>;
  createSession(identity?: { userName: string; password: string }): Promise<NodeOpcUaSession>;
  disconnect(): Promise<void>;
}

interface NodeOpcUaMonitoredItem {
  on(event: "changed", callback: (dataValue: NodeOpcUaDataValue) => void): void;
  terminate(): Promise<void>;
}

interface NodeOpcUaSubscription {
  terminate(): Promise<void>;
}

interface NodeOpcUaModule {
  OPCUAClient: {
    create(options: {
      endpointMustExist: boolean;
      connectionStrategy: { initialDelay: number; maxRetry: number };
    }): NodeOpcUaClient;
  };
  AttributeIds: { Value: number };
  DataType: Record<number | string, string>;
  NodeClass?: Record<number, string>;
  UserTokenType: { UserName: unknown };
  TimestampsToReturn: { Both: unknown };
  ClientSubscription: {
    create(session: NodeOpcUaSession, options: Record<string, unknown>): NodeOpcUaSubscription;
  };
  ClientMonitoredItem: {
    create(
      subscription: NodeOpcUaSubscription,
      itemToMonitor: { nodeId: string; attributeId: number },
      requestedParameters: { samplingInterval: number; discardOldest: boolean; queueSize: number },
      timestampsToReturn: unknown,
    ): NodeOpcUaMonitoredItem;
  };
}
