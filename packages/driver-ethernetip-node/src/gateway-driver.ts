/**
 * EthernetIpGatewayDriver — the ESCO EtherNet/IP implementation of the
 * `ControllerDriver` contract from `@esco/controller-gateway`, replacing the
 * `ethernetip-cip-readonly` placeholder WHEN INJECTED ON THE BACKEND.
 *
 * BOUNDARIES — read before extending.
 *
 * - BACKEND ONLY: this driver lives in the node-only package precisely so
 *   `@esco/controller-gateway` stays browser-safe. A backend host (apps/api)
 *   constructs it and passes it into the gateway registry; the browser bundle
 *   keeps the placeholder. Do not move this into the gateway package.
 * - READ-ONLY BY OMISSION *AND* CONSTRUCTION: `writeTag`
 *   and `compareProject` are deliberately not implemented. `uploadSnapshot`
 *   is a read-only identity/tag inventory capture, NOT a Rockwell ACD or
 *   controller-logic upload. `subscribeTags`
 *   is a polling-backed read-only watch path, not a Forward Open / class-1
 *   controller push subscription. The gateway treats a missing `writeTag` as
 *   "controlled writes not exposed", which is the truth for this milestone.
 * - NEVER MATCHED, BY DESIGN: the CIP Identity object cannot prove which
 *   project is loaded (no project name, no project signature), so this driver
 *   deliberately provides no `compareProject` and reports an identity without
 *   project fields. The gateway's default compare therefore lands on
 *   "match cannot be proven → Online Read-Only" — Goal B rule 7 — and
 *   `online-matched` is structurally unreachable today.
 * - NO ROCKWELL RUNTIME: everything below speaks the public ODVA protocol
 *   through the ESCO-owned stack.
 */

import type {
  BatchTagReadResult,
  ConnectionConfig,
  ControllerConnectionEvidence,
  ControllerDiagnostic,
  ConnectionResult,
  ControllerDriver,
  ControllerIdentity,
  ControllerStatus,
  FaultInfo,
  ProjectSnapshot,
  SubscriptionHandle,
  TagDefinition,
  TagPrimitive,
  TagSubscriptionCallback,
  TagValue,
} from "@esco/controller-gateway";
import {
  ENIP_DEFAULT_PORT,
  cipTypeName,
  decodeStructureValue,
  formatSerialNumber,
  isProgramSymbol,
  type CipIdentity,
  type CipScalar,
  type DecodedStructure,
  type LogixTemplate,
  type ReadTagResult,
  type RouteHop,
  type SymbolInstance,
} from "@esco/driver-ethernetip";
import { LogixTcpClient } from "./tcp-client";

/** Same id as the browser-side placeholder so backend injection replaces it. */
export const ETHERNETIP_GATEWAY_DRIVER_ID = "ethernetip-cip-readonly";

export interface EthernetIpGatewayDriverOptions {
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  /**
   * Poll cadence of the POLLING-BACKED subscription interim (default 1000 ms).
   * Real Forward Open (class 1) subscriptions are a separate future slice.
   */
  subscribePollIntervalMs?: number;
  /**
   * Negotiate a connected (class-3) channel via Forward Open after connect.
   * This is a transport-efficiency option ONLY — read-only requests are
   * identical to UCMM, just carried on a sequenced connection. On Forward
   * Open refusal the driver transparently stays on UCMM (no behavior change).
   * Default OFF.
   */
  connectedMessaging?: boolean;
  /** Originator vendor ID advertised in Forward Open (default 0 — unregistered). */
  originatorVendorId?: number;
}

const now = (): string => new Date().toISOString();
const SNAPSHOT_MAX_TAGS = 200;

export class EthernetIpGatewayDriver implements ControllerDriver {
  readonly id = ETHERNETIP_GATEWAY_DRIVER_ID;
  readonly name = "ESCO EtherNet/IP CIP Read-Only Driver";
  readonly kind = "ethernetip" as const;
  readonly connectionEvidence: ControllerConnectionEvidence = {
    transportValidation: "software-wired",
    realControllerIo: true,
    hardwareValidated: false,
    verified: false,
    label: "Software-wired, not field-validated",
    message:
      "The ESCO EtherNet/IP/CIP stack is wired through the backend gateway and fake-target tests; no lab or field PLC validation evidence is attached.",
    limitations: [
      "Treat as engineering/lab preview until tested hardware evidence is recorded.",
      "No writes, downloads, online edits, forces, mode changes, or clear-fault commands are exposed.",
      "Project identity cannot be proven from the CIP Identity object alone.",
    ],
  };

  private client: LogixTcpClient | undefined;
  private route: readonly RouteHop[] | undefined;
  private lastIdentity: CipIdentity | undefined;
  private endpointLabel = "";
  /** tag name → template instance, learned from the symbol table. */
  private readonly symbolTemplates = new Map<string, number>();
  /** template instance → fetched definition. */
  private readonly templatesByInstance = new Map<number, LogixTemplate>();
  private browsedForTemplates = false;
  /** Active polling-backed subscriptions (id → timer). */
  private readonly subscriptions = new Map<string, ReturnType<typeof setInterval>>();
  private subscriptionCounter = 0;
  private connectionSerialCounter = 0;
  /**
   * Set when a class-3 channel is open. Read-only: a connected channel changes
   * transport efficiency, never capability — it carries the same Read Tag
   * requests UCMM carries. Surfaced for tests/diagnostics only.
   */
  connectedMessagingActive = false;

  constructor(private readonly options: EthernetIpGatewayDriverOptions = {}) {}

  async connect(config: ConnectionConfig): Promise<ConnectionResult> {
    if (this.client) await this.disconnect();

    let host: string;
    let port: number;
    let route: readonly RouteHop[] | undefined;
    try {
      ({ host, port } = parseEndpoint(config.endpointUrl));
      route = parseRoutePath(config.path);
    } catch (error) {
      return {
        ok: false,
        state: "disconnected",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const client = new LogixTcpClient({
      host,
      port,
      connectTimeoutMs: this.options.connectTimeoutMs,
      requestTimeoutMs: this.options.requestTimeoutMs,
    });
    try {
      await client.connect();
      const identity = await client.readIdentityObject({ route });
      this.client = client;
      this.route = route;
      this.lastIdentity = identity;
      this.endpointLabel = `${host}:${port}`;
      let message = `Read-only EtherNet/IP session with ${identity.productName} at ${this.endpointLabel}.`;
      if (this.options.connectedMessaging) {
        message += ` ${await this.tryOpenConnected(client, route)}`;
      }
      return {
        ok: true,
        state: "online-readonly",
        message,
        identity: mapIdentity(identity),
        status: await this.getStatus(),
      };
    } catch (error) {
      client.close();
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        state: "disconnected",
        message: `EtherNet/IP connect to ${host}:${port} failed: ${reason}`,
      };
    }
  }

  /**
   * Attempts Forward Open; on any failure stays on UCMM transparently and
   * returns a human-readable note for the connection message. Never throws —
   * connected messaging is an optimization, never a requirement.
   */
  private async tryOpenConnected(
    client: LogixTcpClient,
    route: readonly RouteHop[] | undefined,
  ): Promise<string> {
    this.connectionSerialCounter = (this.connectionSerialCounter % 0xffff) + 1;
    try {
      await client.openConnected({
        connectionSerial: this.connectionSerialCounter,
        vendorId: this.options.originatorVendorId ?? 0,
        originatorSerial: 0x4553_434f, // "ESCO" — originator identity, not the target
        route,
      });
      this.connectedMessagingActive = true;
      return "Connected (class-3) messaging negotiated for read-only traffic.";
    } catch (error) {
      this.connectedMessagingActive = false;
      const reason = error instanceof Error ? error.message : String(error);
      return `Connected messaging unavailable (${reason}); continuing on unconnected (UCMM) reads.`;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.route = undefined;
    this.lastIdentity = undefined;
    this.endpointLabel = "";
    this.symbolTemplates.clear();
    this.templatesByInstance.clear();
    this.browsedForTemplates = false;
    for (const timer of this.subscriptions.values()) clearInterval(timer);
    this.subscriptions.clear();
    if (this.connectedMessagingActive && client) {
      // Polite Forward Close before tearing down the TCP session.
      this.connectedMessagingActive = false;
      try {
        await client.closeConnected();
      } catch {
        // The TCP teardown closes the channel target-side anyway.
      }
    }
    client?.close();
  }

  async getIdentity(): Promise<ControllerIdentity> {
    const identity = await this.requireClient("getIdentity").readIdentityObject({
      route: this.route,
    });
    this.lastIdentity = identity;
    return mapIdentity(identity);
  }

  async getStatus(): Promise<ControllerStatus> {
    if (!this.client) {
      return {
        state: "disconnected",
        connected: false,
        health: "unknown",
        message: "EtherNet/IP link is not connected.",
        updatedAt: now(),
      };
    }
    // A client object existing does NOT mean the link is alive: the TCP
    // session may have failed (watchdog, peer drop) since the last call.
    // Report the LIVE link state, never a stale "connected".
    const linkState = this.client.state;
    if (linkState !== "ready" && linkState !== "registering") {
      return {
        state: "faulted",
        connected: false,
        health: "faulted",
        message: `EtherNet/IP session with ${this.endpointLabel} was lost (${linkState}). Go offline and reconnect.`,
        updatedAt: now(),
      };
    }
    const identity = this.lastIdentity;
    const faulted = identity?.faulted === true;
    return {
      state: "online-readonly",
      // Mode comes from the identity status word's keyswitch encoding when
      // the controller reports one; otherwise it stays undefined — honest,
      // never guessed. Faulted wins over keyswitch position.
      mode: faulted ? "Faulted" : identity?.keyswitch,
      connected: true,
      health: identity ? (faulted ? "faulted" : "ok") : "unknown",
      message: faulted
        ? `${identity.productName} at ${this.endpointLabel} reports fault bits in its CIP identity status.`
        : `Read-only EtherNet/IP session with ${this.endpointLabel}.`,
      updatedAt: now(),
      diagnostics: identity ? identityDiagnostics(identity, this.endpointLabel, this.connectedMessagingActive) : [
        {
          id: "cip-identity-not-read",
          severity: "warning",
          label: "CIP identity status",
          message: "The EtherNet/IP session is live, but no identity status word has been read yet.",
          source: `EtherNet/IP (${this.endpointLabel})`,
          evidence: ["identityStatus=missing"],
          recommendation: "Refresh controller identity/status before relying on online diagnostics.",
        },
      ],
    };
  }

  /**
   * Fault flags from the CIP Identity status word. This is device-level
   * status, NOT the controller's fault log — honest but shallow; a deeper
   * fault surface is a future slice.
   */
  async getFaults(): Promise<FaultInfo[]> {
    const identity = await this.requireClient("getFaults").readIdentityObject({
      route: this.route,
    });
    this.lastIdentity = identity;
    const timestamp = now();
    return identityFaultDescriptors(identity)
      .filter((fault) => fault.flagged)
      .map((fault): FaultInfo => ({
        id: fault.id,
        code: fault.bit,
        severity: fault.severity,
        message: `${fault.label} reported in the CIP identity status word.`,
        source: `CIP Identity (${this.endpointLabel})`,
        timestamp,
        clearable: false, // this driver has no clear-faults path, by design
        evidence: identityEvidence(identity),
        recommendation: fault.recommendation,
        details: {
          statusWord: statusWordHex(identity.status),
          productName: identity.productName,
          serialNumber: formatSerialNumber(identity.serialNumber),
          keyswitch: identity.keyswitch ?? null,
          connectedMessaging: this.connectedMessagingActive,
        },
      }));
  }

  async browseTags(): Promise<TagDefinition[]> {
    const browse = await this.requireClient("browseTags").browseAllTags({ route: this.route });
    const definitions: TagDefinition[] = [];
    for (const symbol of browse.controller) {
      if (symbol.isSystem || isProgramSymbol(symbol)) continue;
      definitions.push(this.toDefinition(symbol.name, symbol, "controller"));
      this.rememberTemplate(symbol.name, symbol);
    }
    for (const [programName, symbols] of Object.entries(browse.programs)) {
      for (const symbol of symbols) {
        if (symbol.isSystem) continue;
        const name = `${programName}.${symbol.name}`;
        definitions.push(this.toDefinition(name, symbol, "program"));
        this.rememberTemplate(name, symbol);
      }
    }
    this.browsedForTemplates = true;
    return definitions;
  }

  async readTag(tagName: string): Promise<TagValue> {
    const result = await this.requireClient("readTag").readTag(tagName, 1, { route: this.route });
    return this.toTagValue(tagName, result);
  }

  /**
   * Maps one read result to a gateway TagValue, decoding structures through
   * their templates when the symbol table + template cache can prove the
   * layout (handle match required). Anything unprovable stays null/uncertain.
   */
  private async toTagValue(tagName: string, result: ReadTagResult): Promise<TagValue> {
    if (result.value instanceof Uint8Array && typeof result.structureHandle === "number") {
      const decoded = await this.tryDecodeStructure(tagName, result.structureHandle, result.value);
      if (decoded) {
        return {
          tagName,
          value: decoded.payload,
          dataType: decoded.dataType,
          quality: decoded.quality,
          timestamp: now(),
          sourceDriver: this.kind,
        };
      }
    }
    const mapped = mapTagValue(result.value);
    return {
      tagName,
      value: mapped.value,
      dataType: result.typeName,
      quality: mapped.quality,
      timestamp: now(),
      sourceDriver: this.kind,
    };
  }

  private rememberTemplate(name: string, symbol: SymbolInstance): void {
    if (symbol.isStructure && symbol.templateInstance !== undefined) {
      this.symbolTemplates.set(name, symbol.templateInstance);
    }
  }

  /** Never throws: template lookup/fetch failures degrade to undecoded. */
  private async tryDecodeStructure(
    tagName: string,
    structureHandle: number,
    bytes: Uint8Array,
  ): Promise<
    | { payload: Record<string, TagPrimitive>; dataType: string; quality: TagValue["quality"] }
    | undefined
  > {
    if (!this.browsedForTemplates) {
      // Learn the symbol table once so tag names map to template instances.
      try {
        await this.browseTags();
      } catch {
        return undefined;
      }
    }
    const instance = this.symbolTemplates.get(tagName);
    if (instance === undefined) return undefined;
    const template = await this.fetchTemplateClosure(instance);
    if (!template) return undefined;
    // The read reply's structure handle must match the template's CRC —
    // otherwise the definition does not describe these bytes.
    if (template.structureHandle !== structureHandle) return undefined;
    const decoded = decodeStructureValue(template, bytes, {
      resolveTemplate: (nested) => this.templatesByInstance.get(nested),
    });
    const payload: Record<string, TagPrimitive> = {};
    flattenStructure(decoded, "", payload);
    return {
      payload,
      dataType: template.name,
      quality: decoded.undecodedMembers.length > 0 ? "uncertain" : "good",
    };
  }

  /**
   * Fetches a template plus the templates of its nested structure members
   * (transitively, capped) so recursive decoding can resolve them from the
   * cache. Returns undefined when the root template cannot be read.
   */
  private async fetchTemplateClosure(rootInstance: number): Promise<LogixTemplate | undefined> {
    const pending = [rootInstance];
    const seen = new Set<number>();
    while (pending.length > 0 && seen.size < 16) {
      const instance = pending.pop();
      if (instance === undefined || seen.has(instance)) continue;
      seen.add(instance);
      let template = this.templatesByInstance.get(instance);
      if (!template) {
        try {
          template = await this.requireClient("readTemplate").readTemplate(instance, {
            route: this.route,
          });
        } catch {
          // Root failure → no decode; nested failure → that branch stays
          // undecoded (reported via undecodedMembers), the rest still decodes.
          if (instance === rootInstance) return undefined;
          continue;
        }
        this.templatesByInstance.set(instance, template);
      }
      for (const member of template.members) {
        if (member.isStructure && member.templateInstance !== undefined) {
          pending.push(member.templateInstance);
        }
      }
    }
    return this.templatesByInstance.get(rootInstance);
  }

  /**
   * Efficient batch read: CIP Multiple Service Packet under the hood (one
   * wire round trip per chunk), with transparent per-tag fallback for
   * targets that reject 0x0A and fragmented re-reads for oversized values.
   */
  async readTags(tagNames: string[]): Promise<BatchTagReadResult> {
    const outcome = await this.requireClient("readTags").readTagsBatch(tagNames, {
      route: this.route,
    });
    const values: TagValue[] = [];
    for (const [tagName, result] of Object.entries(outcome.results)) {
      values.push(await this.toTagValue(tagName, result));
    }
    return { values, errors: outcome.errors };
  }

  /**
   * Read-only Allen-Bradley "upload" snapshot: captures controller identity,
   * browsed tag definitions, and sampled scalar tag values. This is useful
   * for ESCO online inspection, but it is intentionally not a Studio 5000
   * `.ACD`/logic upload and cannot reconstruct ladder, AOIs, routines, or I/O
   * configuration.
   */
  async uploadSnapshot(): Promise<ProjectSnapshot> {
    const capturedAt = now();
    const identity = await this.getIdentity();
    const definitions = await this.browseTags();
    const sampledDefinitions = definitions
      .filter(isSnapshotSampleCandidate)
      .slice(0, SNAPSHOT_MAX_TAGS);
    const sampledTagNames = sampledDefinitions.map((definition) => definition.name);
    const batch = sampledTagNames.length > 0
      ? await this.readTags(sampledTagNames)
      : { values: [], errors: {} };

    return {
      id: `enip-snapshot-${Date.now().toString(36)}`,
      capturedAt,
      sourceDriver: this.kind,
      identity,
      connectionEvidence: this.connectionEvidence,
      tags: batch.values,
      raw: {
        kind: "allen-bradley-read-only-tag-snapshot",
        endpoint: this.endpointLabel,
        tagDefinitions: definitions,
        sampledTagNames,
        readErrors: batch.errors,
        browsedTagCount: definitions.length,
        sampledTagCount: batch.values.length,
        requestedSampleCount: sampledTagNames.length,
        skippedTagCount: definitions.length - sampledTagNames.length,
        sampledTagLimit: SNAPSHOT_MAX_TAGS,
        truncated: definitions.filter(isSnapshotSampleCandidate).length > SNAPSHOT_MAX_TAGS,
        note: "Read-only identity/tag snapshot only; not a Rockwell ACD or controller logic upload.",
      },
    };
  }

  /**
   * READ-ONLY tag subscriptions — POLLING-BACKED INTERIM, honestly labeled:
   * samples the tags through the batched read path on an interval (Multiple
   * Service Packet → one wire round trip per tick) and emits a value when a
   * tag's value/quality CHANGES (plus one initial sample per tag, and one
   * bad-quality null when a tag transitions into a read error). This is NOT
   * a CIP class-1 / Forward Open subscription; that real push path is a
   * separate future slice and this method's contract will not change when it
   * lands.
   */
  async subscribeTags(
    tagNames: string[],
    callback: TagSubscriptionCallback,
  ): Promise<SubscriptionHandle> {
    this.requireClient("subscribeTags");
    const id = `enip-poll-sub-${(this.subscriptionCounter += 1)}`;
    const names = [...tagNames];
    const lastSent = new Map<string, string>();

    const sample = async (): Promise<void> => {
      let batch: BatchTagReadResult;
      try {
        batch = await this.readTags(names);
      } catch {
        // Disconnected/teardown mid-poll: the timer is cleared by
        // disconnect()/unsubscribe(); skip this tick rather than crash.
        return;
      }
      for (const value of batch.values) {
        const fingerprint = JSON.stringify([value.value, value.quality]);
        if (lastSent.get(value.tagName) !== fingerprint) {
          lastSent.set(value.tagName, fingerprint);
          callback(value);
        }
      }
      for (const [tagName, message] of Object.entries(batch.errors)) {
        const fingerprint = `error:${message}`;
        if (lastSent.get(tagName) !== fingerprint) {
          lastSent.set(tagName, fingerprint);
          callback({
            tagName,
            value: null,
            quality: "bad",
            timestamp: now(),
            sourceDriver: this.kind,
          });
        }
      }
    };

    await sample(); // initial values arrive before the handle does
    const timer = setInterval(() => void sample(), this.options.subscribePollIntervalMs ?? 1000);
    this.subscriptions.set(id, timer);
    return {
      id,
      unsubscribe: async () => {
        const active = this.subscriptions.get(id);
        if (active) clearInterval(active);
        this.subscriptions.delete(id);
      },
    };
  }

  // writeTag / compareProject are INTENTIONALLY ABSENT —
  // see the boundary notes at the top of this file.

  private toDefinition(
    name: string,
    symbol: SymbolInstance,
    scope: "controller" | "program",
  ): TagDefinition {
    const base = symbol.isStructure ? "STRUCT" : cipTypeName(symbol.atomicType ?? 0);
    return {
      name,
      dataType: `${base}${"[]".repeat(symbol.dimensions)}`,
      scope,
      writable: false, // read-only driver — nothing is writable through it
      sourceDriver: this.kind,
    };
  }

  private requireClient(operation: string): LogixTcpClient {
    if (!this.client) {
      throw new Error(`${operation} requires a connected EtherNet/IP session.`);
    }
    return this.client;
  }
}

function isSnapshotSampleCandidate(definition: TagDefinition): boolean {
  return definition.dataType !== "STRUCT" && !definition.dataType.endsWith("[]");
}

/**
 * Identity mapping: project fields are deliberately ABSENT — the CIP Identity
 * object cannot prove which project is loaded, and pretending otherwise would
 * let a false "match" unlock write paths. Missing project signature ⇒ the
 * gateway compare reports "cannot be proven" ⇒ Online Read-Only.
 */
function mapIdentity(identity: CipIdentity): ControllerIdentity {
  return {
    vendor: identity.vendorName ?? `CIP vendor ${identity.vendorId}`,
    productName: identity.productName,
    controllerType: identity.productName,
    firmwareRevision: identity.revision,
    serialNumber: formatSerialNumber(identity.serialNumber),
  };
}

interface IdentityFaultDescriptor {
  id: string;
  bit: string;
  flagged: boolean;
  severity: FaultInfo["severity"];
  label: string;
  recommendation: string;
}

function identityFaultDescriptors(identity: CipIdentity): IdentityFaultDescriptor[] {
  return [
    {
      id: "cip-minor-recoverable",
      bit: "minorRecoverable",
      flagged: identity.faults.minorRecoverable,
      severity: "minor",
      label: "Minor recoverable fault",
      recommendation: "Inspect controller diagnostics in the plant-approved tool before any clear-fault procedure.",
    },
    {
      id: "cip-minor-unrecoverable",
      bit: "minorUnrecoverable",
      flagged: identity.faults.minorUnrecoverable,
      severity: "minor",
      label: "Minor unrecoverable fault",
      recommendation: "Review controller diagnostics and recovery procedure; ESCO does not clear faults in this build.",
    },
    {
      id: "cip-major-recoverable",
      bit: "majorRecoverable",
      flagged: identity.faults.majorRecoverable,
      severity: "major",
      label: "Major recoverable fault",
      recommendation: "Treat the controller as faulted and use the approved plant workflow to diagnose and clear it.",
    },
    {
      id: "cip-major-unrecoverable",
      bit: "majorUnrecoverable",
      flagged: identity.faults.majorUnrecoverable,
      severity: "major",
      label: "Major unrecoverable fault",
      recommendation: "Treat the controller as faulted; recovery may require program/service action outside ESCO.",
    },
  ];
}

function identityDiagnostics(
  identity: CipIdentity,
  endpointLabel: string,
  connectedMessagingActive: boolean,
): ControllerDiagnostic[] {
  const faultBits = identityFaultDescriptors(identity).filter((fault) => fault.flagged);
  const statusSeverity: ControllerDiagnostic["severity"] =
    faultBits.some((fault) => fault.severity === "major") ? "major" :
    faultBits.length > 0 ? "minor" :
    "info";
  const mode = identity.faulted ? "Faulted" : identity.keyswitch ?? "not encoded";
  const diagnostics: ControllerDiagnostic[] = [
    {
      id: "cip-identity-status-word",
      severity: statusSeverity,
      label: "CIP identity status word",
      message: `Status ${statusWordHex(identity.status)} decodes as ${mode}.`,
      source: `CIP Identity (${endpointLabel})`,
      evidence: identityEvidence(identity),
      recommendation: identity.faulted
        ? "Read the fault records in the approved controller tool before any recovery action."
        : "Use proof tags/project compare for loaded-project evidence; the CIP identity word does not prove the running project.",
    },
    {
      id: "cip-read-channel",
      severity: "info",
      label: "Read transport channel",
      message: connectedMessagingActive
        ? "Read-only requests are using a negotiated class-3 EtherNet/IP channel."
        : "Read-only requests are using UCMM EtherNet/IP explicit messages.",
      source: `EtherNet/IP (${endpointLabel})`,
      evidence: [
        `connectedMessaging=${connectedMessagingActive}`,
        "writeTag=false",
        "modeChange=false",
        "clearFaults=false",
      ],
      recommendation: "Connected messaging changes transport efficiency only; it does not enable writes or controller changes.",
    },
  ];
  for (const fault of faultBits) {
    diagnostics.push({
      id: fault.id,
      severity: fault.severity,
      label: fault.label,
      message: `${fault.label} bit is set in the CIP identity status word.`,
      source: `CIP Identity (${endpointLabel})`,
      evidence: identityEvidence(identity),
      recommendation: fault.recommendation,
    });
  }
  return diagnostics;
}

function identityEvidence(identity: CipIdentity): string[] {
  return [
    `status=${statusWordHex(identity.status)}`,
    `mode=${identity.keyswitch ?? "not encoded"}`,
    `product=${identity.productName}`,
    `revision=${identity.revision}`,
    `serial=${formatSerialNumber(identity.serialNumber)}`,
    `faultBits=${identityFaultDescriptors(identity).filter((fault) => fault.flagged).map((fault) => fault.bit).join("|") || "none"}`,
  ];
}

function statusWordHex(status: number): string {
  return `0x${status.toString(16).toUpperCase().padStart(4, "0")}`;
}

function mapScalar(value: CipScalar): TagPrimitive {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  return value;
}

/**
 * Member values inside a structure payload must be primitives
 * (`Record<string, TagPrimitive>`): arrays render as JSON text, undecoded
 * members stay null, and nested structures flatten to dotted member paths
 * ("Inner.Count").
 */
function flattenStructure(
  decoded: DecodedStructure,
  prefix: string,
  into: Record<string, TagPrimitive>,
): void {
  for (const [member, value] of Object.entries(decoded.values)) {
    const path = prefix ? `${prefix}.${member}` : member;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      flattenStructure(value as DecodedStructure, path, into);
      continue;
    }
    into[path] = memberToPrimitive(value as CipScalar | readonly CipScalar[] | null);
  }
}

function memberToPrimitive(value: CipScalar | readonly CipScalar[] | null): TagPrimitive {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return JSON.stringify((value as readonly CipScalar[]).map(mapScalar));
  }
  return mapScalar(value as CipScalar);
}

function mapTagValue(value: CipScalar | readonly CipScalar[] | Uint8Array): {
  value: TagPrimitive | TagPrimitive[];
  quality: TagValue["quality"];
} {
  if (value instanceof Uint8Array) {
    // Undecoded structure bytes: report "no usable value" honestly instead of
    // inventing a representation. UDT template decoding is a future slice.
    return { value: null, quality: "uncertain" };
  }
  if (Array.isArray(value)) {
    return { value: (value as readonly CipScalar[]).map(mapScalar), quality: "good" };
  }
  return { value: mapScalar(value as CipScalar), quality: "good" };
}

function parseEndpoint(endpointUrl: string | undefined): { host: string; port: number } {
  const raw = endpointUrl?.trim() ?? "";
  if (!raw) {
    throw new Error(
      'EtherNet/IP endpoint is required — set endpointUrl to "host", "host:port", or "enip://host:port".',
    );
  }
  let text = raw;
  if (text.toLowerCase().startsWith("enip://")) text = text.slice("enip://".length);
  text = text.replace(/\/+$/, "");
  if (!text || /[\s/]/.test(text)) {
    throw new Error(`EtherNet/IP endpoint ${JSON.stringify(raw)} is not a valid host[:port].`);
  }
  const colon = text.lastIndexOf(":");
  if (colon === -1) return { host: text, port: ENIP_DEFAULT_PORT };
  const host = text.slice(0, colon);
  const portText = text.slice(colon + 1);
  const port = Number.parseInt(portText, 10);
  if (!host || !/^\d+$/.test(portText) || port < 1 || port > 0xffff) {
    throw new Error(`EtherNet/IP endpoint ${JSON.stringify(raw)} is not a valid host[:port].`);
  }
  return { host, port };
}

/** Parses a classic CIP route path like "1,0" into port/link hops. */
function parseRoutePath(path: string | undefined): readonly RouteHop[] | undefined {
  const raw = path?.trim() ?? "";
  if (!raw) return undefined;
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length % 2 !== 0 || parts.some((part) => !/^\d+$/.test(part))) {
    throw new Error(
      `CIP route path ${JSON.stringify(path)} must be numeric "port,link" pairs (e.g. "1,0").`,
    );
  }
  const hops: RouteHop[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    hops.push({ port: Number.parseInt(parts[index], 10), link: Number.parseInt(parts[index + 1], 10) });
  }
  return hops;
}
