/**
 * Sans-I/O Logix session core — the protocol state machine for an ESCO-owned
 * EtherNet/IP explicit-messaging (UCMM) client.
 *
 * SANS-I/O: this class never touches a socket. A transport (future,
 * backend-only slice) drives it with exactly two byte-level calls:
 *
 *   - `takeOutbound()` — frames the core wants written to the TCP stream
 *   - `receive(chunk)` — bytes that arrived from the TCP stream
 *
 * plus `fail(error)` when the connection drops. Everything in between —
 * session registration, request/response correlation, pagination, fragmented
 * read reassembly — is deterministic and unit-tested with crafted frames.
 *
 * READ-ONLY: the convenience methods cover identity, tag browsing, and tag
 * reads only. There is no write path here, by construction.
 *
 * CORRELATION MODEL: one request is in flight at a time; later requests queue.
 * UCMM over a single TCP session replies in order, so the single-in-flight
 * pipeline gives exact correlation without sender-context bookkeeping. A reply
 * that arrives with no request in flight, or with the wrong encapsulation
 * command, is a protocol violation and fails the whole session — honestly
 * broken beats silently misattributed.
 */

import { concatBytes } from "../bytes";
import {
  EnipCommand,
  encodeEncapsulation,
  encodeRegisterSessionRequest,
  encodeUnregisterSessionRequest,
  encodeListIdentityRequest,
  decodeRegisterSessionReply,
  enipStatusMessage,
  type EncapsulationPacket,
  type RegisterSessionReply,
} from "../enip/encapsulation";
import { EnipStreamFramer } from "../enip/framing";
import { ByteReader } from "../bytes";
import {
  decodeCpf,
  decodeSendRRDataPayload,
  encodeSendRRDataPayload,
  extractUnconnectedData,
} from "../enip/cpf";
import {
  CipGeneralStatus,
  decodeMessageRouterResponse,
  expectCipSuccess,
  type MessageRouterResponse,
} from "../cip/message-router";
import { encodeUnconnectedSendRequest, type RouteHop } from "../cip/unconnected-send";
import { STRUCTURE_TYPE_CODE, decodeTypedValue } from "../cip/data-types";
import {
  encodeMultipleServicePacket,
  parseMultipleServiceReply,
} from "../cip/multi-service";
import {
  buildForwardCloseRequest,
  buildForwardOpenRequest,
  parseForwardCloseReply,
  parseForwardOpenReply,
  type ForwardOpenReply,
} from "../cip/forward-open";
import {
  encodeSendUnitDataPayload,
  decodeSendUnitDataPayload,
} from "../enip/cpf";
import {
  buildReadTagFragmentedRequest,
  buildReadTagRequest,
  parseReadTagReply,
  type ReadTagResult,
} from "../logix/read-tag";
import { buildIdentityRequest, parseIdentityReply, parseListIdentityItem, type CipIdentity, type ListIdentityInfo } from "../logix/identity";
import {
  buildTagListRequest,
  isProgramSymbol,
  parseTagListReply,
  type SymbolInstance,
} from "../logix/tag-list";
import {
  buildReadTemplateRequest,
  buildTemplateAttributesRequest,
  parseTemplateAttributesReply,
  parseTemplateDefinition,
  templateReadSize,
  type LogixTemplate,
} from "../logix/templates";

export type SessionState =
  | "idle"
  | "registering"
  | "ready"
  | "closed"
  | "failed";

/** Outcome of {@link LogixSessionCore.readTagsBatch}: per-tag results/errors. */
export interface BatchReadOutcome {
  results: Record<string, ReadTagResult>;
  errors: Record<string, string>;
}

export interface LogixRequestOptions {
  /**
   * Route the CIP request through a chassis bridge (Unconnected Send) — e.g.
   * `backplaneRoute(0)` for the CPU in slot 0. Omit to address the device
   * that terminates the TCP connection directly.
   */
  route?: readonly RouteHop[];
  /** SendRRData encapsulation timeout field, in seconds. */
  timeoutSeconds?: number;
}

interface PendingRequest {
  kind: "register" | "listIdentity" | "ucmm" | "connected";
  expectedCommand: number;
  describe: string;
  /** Built lazily so UCMM frames pick up the session handle once registered. */
  buildFrame: () => Uint8Array;
  resolve: (packet: EncapsulationPacket) => void;
  reject: (error: Error) => void;
}

/** Options for opening a connected (class-3) messaging channel. */
export interface ConnectedModeOptions {
  /** Originator-chosen T→O connection ID; derived from the serial if omitted. */
  originatorConnectionId?: number;
  connectionSerial: number;
  vendorId: number;
  originatorSerial: number;
  route?: readonly import("../cip/unconnected-send").RouteHop[];
  large?: boolean;
  connectionSizeBytes?: number;
  rpiMicroseconds?: number;
}

interface ConnectedChannel {
  /** Target-assigned id used to ADDRESS our connected requests. */
  otConnectionId: number;
  /** Originator-chosen id replies are expected to arrive on. */
  toConnectionId: number;
  options: ConnectedModeOptions;
}

/** Hard cap on continuation loops so a misbehaving peer cannot spin us forever. */
const MAX_CONTINUATIONS = 10_000;

export interface LogixSessionCoreHooks {
  /**
   * Called synchronously whenever a frame lands in the outbound buffer —
   * continuation frames (fragmented reads, pagination) are emitted from
   * promise microtasks, so a transport must NOT rely on polling after
   * `receive()`; drain via `takeOutbound()` from this hook instead.
   */
  onOutbound?: () => void;
}

export class LogixSessionCore {
  private readonly framer = new EnipStreamFramer();
  private sessionState: SessionState = "idle";
  private handle: number | undefined;
  private readonly outbound: Uint8Array[] = [];
  private inflight: PendingRequest | undefined;
  private readonly queue: PendingRequest[] = [];
  private connectedChannel: ConnectedChannel | undefined;
  private sequenceCounter = 0;

  constructor(private readonly hooks: LogixSessionCoreHooks = {}) {}

  /** True when requests route through a connected (class-3) channel. */
  get isConnectedMode(): boolean {
    return this.connectedChannel !== undefined;
  }

  get state(): SessionState {
    return this.sessionState;
  }

  get sessionHandle(): number | undefined {
    return this.handle;
  }

  /** Number of requests waiting (including the one in flight). */
  get pendingRequestCount(): number {
    return this.queue.length + (this.inflight ? 1 : 0);
  }

  // ── transport-facing surface ──────────────────────────────────────────────

  /** Drains the frames the transport must write to the TCP stream, in order. */
  takeOutbound(): Uint8Array[] {
    return this.outbound.splice(0, this.outbound.length);
  }

  /** Feeds bytes received from the TCP stream (any fragmentation). */
  receive(chunk: Uint8Array): void {
    if (this.sessionState === "closed" || this.sessionState === "failed") return;
    for (const packet of this.framer.feed(chunk)) {
      this.dispatch(packet);
    }
  }

  /** The transport reports a connection error/loss: everything pending fails. */
  fail(error: Error): void {
    if (this.sessionState === "closed" || this.sessionState === "failed") return;
    this.sessionState = "failed";
    this.connectedChannel = undefined;
    this.rejectAll(error);
  }

  // ── session lifecycle ─────────────────────────────────────────────────────

  /** Registers the EtherNet/IP session. Must be the first call. */
  open(): Promise<RegisterSessionReply> {
    if (this.sessionState !== "idle") {
      return Promise.reject(
        new Error(`cannot open: session is ${this.sessionState}, expected idle`),
      );
    }
    this.sessionState = "registering";
    return this.enqueue({
      kind: "register",
      expectedCommand: EnipCommand.RegisterSession,
      describe: "RegisterSession",
      buildFrame: () => encodeRegisterSessionRequest(),
    }).then((packet) => {
      let reply: RegisterSessionReply;
      try {
        reply = decodeRegisterSessionReply(packet);
      } catch (error) {
        this.sessionState = "failed";
        this.rejectAll(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
      this.handle = reply.sessionHandle;
      this.sessionState = "ready";
      // Requests queued while registration was in flight are held by pump()
      // until the handle exists — release them now.
      this.pump();
      return reply;
    });
  }

  /**
   * Closes the session: emits UnregisterSession (no reply is defined — the
   * target drops the TCP connection) and rejects anything still pending.
   */
  close(): void {
    if (this.sessionState === "closed" || this.sessionState === "failed") return;
    if (this.sessionState === "ready" && this.handle !== undefined) {
      this.emitFrame(encodeUnregisterSessionRequest(this.handle));
    }
    this.sessionState = "closed";
    // The TCP teardown ends any connected channel target-side; callers that
    // want a polite Forward Close call closeConnected() before close().
    this.connectedChannel = undefined;
    this.rejectAll(new Error("session closed by client"));
  }

  // ── requests ──────────────────────────────────────────────────────────────

  /**
   * ListIdentity over the established TCP connection. The protocol allows it
   * pre-registration, but this core requires `open()` first so every request
   * flows through one orderly correlation pipeline.
   */
  async listIdentity(): Promise<ListIdentityInfo> {
    const packet = await this.enqueue({
      kind: "listIdentity",
      expectedCommand: EnipCommand.ListIdentity,
      describe: "ListIdentity",
      buildFrame: () => encodeListIdentityRequest(),
    });
    const items = decodeCpf(new ByteReader(packet.data));
    const identityItem = items.find((item) => item.typeId === 0x000c);
    if (!identityItem) {
      throw new Error("ListIdentity reply carried no identity item");
    }
    return parseListIdentityItem(identityItem);
  }

  /**
   * Sends one raw CIP request and resolves with the decoded message-router
   * response. Routes through the connected (class-3) channel when one is
   * open, otherwise UCMM (SendRRData). CIP-level errors do NOT fail the
   * session; callers inspect/throw per request (see expectCipSuccess).
   */
  sendUcmm(
    cipRequest: Uint8Array,
    options: LogixRequestOptions = {},
    describe = "UCMM request",
  ): Promise<MessageRouterResponse> {
    if (this.connectedChannel) {
      // Connected channel already targets the CPU the Forward Open routed
      // to — per-request route wrapping does not apply.
      return this.sendConnected(cipRequest, describe);
    }
    return this.sendUnconnected(cipRequest, options, describe);
  }

  /** Always-UCMM path (Forward Open/Close themselves must use this). */
  private sendUnconnected(
    cipRequest: Uint8Array,
    options: LogixRequestOptions,
    describe: string,
  ): Promise<MessageRouterResponse> {
    const wrapped = options.route
      ? encodeUnconnectedSendRequest(cipRequest, options.route)
      : cipRequest;
    return this.enqueue({
      kind: "ucmm",
      expectedCommand: EnipCommand.SendRRData,
      describe,
      buildFrame: () => {
        if (this.handle === undefined) {
          // enqueue() only emits UCMM frames after registration; this guards
          // future refactors, not a reachable runtime state.
          throw new Error("internal: UCMM frame built before session registration");
        }
        return encodeEncapsulation({
          command: EnipCommand.SendRRData,
          sessionHandle: this.handle,
          data: encodeSendRRDataPayload(wrapped, options.timeoutSeconds ?? 10),
        });
      },
    }).then((packet) => {
      const payload = decodeSendRRDataPayload(packet.data);
      return decodeMessageRouterResponse(extractUnconnectedData(payload.items));
    });
  }

  /** Connected (class-3) path: SendUnitData with a cycling sequence count. */
  private sendConnected(cipRequest: Uint8Array, describe: string): Promise<MessageRouterResponse> {
    const channel = this.connectedChannel;
    if (!channel) {
      return Promise.reject(new Error(`cannot send ${describe}: no connected channel`));
    }
    this.sequenceCounter = (this.sequenceCounter % 0xffff) + 1; // 1..65535
    const sequence = this.sequenceCounter;
    return this.enqueue({
      kind: "connected",
      expectedCommand: EnipCommand.SendUnitData,
      describe: `${describe} (connected seq ${sequence})`,
      buildFrame: () => {
        if (this.handle === undefined) {
          throw new Error("internal: connected frame built before session registration");
        }
        return encodeEncapsulation({
          command: EnipCommand.SendUnitData,
          sessionHandle: this.handle,
          data: encodeSendUnitDataPayload(channel.otConnectionId, sequence, cipRequest),
        });
      },
    }).then((packet) => {
      const payload = decodeSendUnitDataPayload(packet.data);
      if (payload.sequence !== sequence) {
        // Correlation is broken — answers can no longer be attributed.
        const error = new Error(
          `connected reply sequence ${payload.sequence} does not match request ${sequence} — failing the session`,
        );
        this.fail(error);
        throw error;
      }
      return decodeMessageRouterResponse(payload.message);
    });
  }

  /**
   * Opens a connected (class-3) channel via Forward Open. Subsequent
   * requests route through SendUnitData; UCMM remains the fallback when the
   * target refuses (the rejection is surfaced, the session stays usable).
   * NOTE: connected messaging carries the same read-only requests — it
   * changes transport efficiency, never capability (no tag push exists).
   */
  async openConnected(options: ConnectedModeOptions): Promise<ForwardOpenReply> {
    if (this.connectedChannel) {
      throw new Error("a connected channel is already open — close it first");
    }
    const originatorConnectionId =
      options.originatorConnectionId ?? (0x45530000 | (options.connectionSerial & 0xffff));
    const response = await this.sendUnconnected(
      buildForwardOpenRequest({ ...options, originatorConnectionId }),
      {},
      "Forward Open",
    );
    const reply = parseForwardOpenReply(response); // throws CipResponseError on refusal
    this.connectedChannel = {
      otConnectionId: reply.otConnectionId,
      toConnectionId: reply.toConnectionId,
      options,
    };
    return reply;
  }

  /** Closes the connected channel (Forward Close); reverts to UCMM routing. */
  async closeConnected(): Promise<void> {
    const channel = this.connectedChannel;
    if (!channel) return;
    this.connectedChannel = undefined; // revert routing first — FC goes UCMM
    const response = await this.sendUnconnected(
      buildForwardCloseRequest({
        connectionSerial: channel.options.connectionSerial,
        vendorId: channel.options.vendorId,
        originatorSerial: channel.options.originatorSerial,
        route: channel.options.route,
      }),
      {},
      "Forward Close",
    );
    parseForwardCloseReply(response); // throws on failure statuses
  }

  /** Reads the Identity object (Get Attributes All on class 0x01, instance 1). */
  async readIdentityObject(options: LogixRequestOptions = {}): Promise<CipIdentity> {
    const response = await this.sendUcmm(buildIdentityRequest(), options, "Identity read");
    return parseIdentityReply(response);
  }

  /**
   * Reads a tag, transparently continuing partial transfers with Read Tag
   * Fragmented until the value is complete. `partial` is always false on the
   * result this resolves with.
   */
  async readTag(
    tagAddress: string,
    elementCount = 1,
    options: LogixRequestOptions = {},
  ): Promise<ReadTagResult> {
    const context = `Read Tag ${JSON.stringify(tagAddress)}`;
    let response = await this.sendUcmm(
      buildReadTagRequest(tagAddress, elementCount),
      options,
      context,
    );
    let payload = expectCipSuccess(response, context, { allowPartialTransfer: true });
    const prefix = typePrefixOf(payload, context);
    let valueBytes: Uint8Array = payload.slice(prefix.length);

    let continuations = 0;
    while (response.generalStatus === CipGeneralStatus.PartialTransfer) {
      continuations += 1;
      if (continuations > MAX_CONTINUATIONS) {
        throw new Error(`${context}: aborted after ${MAX_CONTINUATIONS} fragment continuations`);
      }
      response = await this.sendUcmm(
        buildReadTagFragmentedRequest(tagAddress, elementCount, valueBytes.length),
        options,
        `${context} (fragment at ${valueBytes.length})`,
      );
      payload = expectCipSuccess(response, context, { allowPartialTransfer: true });
      const fragment = payload.slice(typePrefixOf(payload, context).length);
      if (fragment.length === 0) {
        throw new Error(`${context}: fragmented read made no progress at offset ${valueBytes.length}`);
      }
      valueBytes = concatBytes([valueBytes, fragment]);
    }

    return { ...decodeTypedValue(concatBytes([prefix, valueBytes])), partial: false };
  }

  /**
   * Reads one UDT/structure template definition (attributes + paged
   * definition read + parse). Read-only: templates only describe data.
   */
  async readTemplate(
    templateInstance: number,
    options: LogixRequestOptions = {},
  ): Promise<LogixTemplate> {
    const context = `Read Template 0x${templateInstance.toString(16)}`;
    const attributes = parseTemplateAttributesReply(
      await this.sendUcmm(
        buildTemplateAttributesRequest(templateInstance),
        options,
        `${context} attributes`,
      ),
    );
    const total = templateReadSize(attributes.objectDefinitionSize);
    let collected: Uint8Array = new Uint8Array(0);
    let continuations = 0;
    for (;;) {
      continuations += 1;
      if (continuations > MAX_CONTINUATIONS) {
        throw new Error(`${context}: aborted after ${MAX_CONTINUATIONS} continuations`);
      }
      const response = await this.sendUcmm(
        buildReadTemplateRequest(templateInstance, collected.length, total - collected.length),
        options,
        `${context} at offset ${collected.length}`,
      );
      const chunk = expectCipSuccess(response, context, { allowPartialTransfer: true });
      if (chunk.length === 0) {
        throw new Error(`${context}: definition read made no progress at ${collected.length}`);
      }
      collected = concatBytes([collected, chunk]);
      if (response.generalStatus !== CipGeneralStatus.PartialTransfer) break;
      if (collected.length >= total) break;
    }
    return parseTemplateDefinition(collected, attributes, templateInstance);
  }

  /**
   * Reads many tags efficiently using CIP Multiple Service Packet (one wire
   * round trip per chunk instead of one per tag). Per-tag failures land in
   * `errors`; embedded partial transfers and unsupported-0x0A targets fall
   * back to plain per-tag reads transparently. Read-only throughout.
   */
  async readTagsBatch(
    tagAddresses: readonly string[],
    options: LogixRequestOptions & { chunkSize?: number } = {},
  ): Promise<BatchReadOutcome> {
    const results: Record<string, ReadTagResult> = {};
    const errors: Record<string, string> = {};
    const chunkSize = Math.max(1, options.chunkSize ?? 20);

    const valid: Array<{ name: string; request: Uint8Array }> = [];
    for (const name of tagAddresses) {
      try {
        valid.push({ name, request: buildReadTagRequest(name, 1) });
      } catch (cause) {
        errors[name] = cause instanceof Error ? cause.message : String(cause);
      }
    }

    for (let at = 0; at < valid.length; at += chunkSize) {
      const chunk = valid.slice(at, at + chunkSize);
      if (chunk.length === 1) {
        await this.readSingleInto(chunk[0].name, results, errors, options);
        continue;
      }
      let embedded;
      try {
        const response = await this.sendUcmm(
          encodeMultipleServicePacket(chunk.map((item) => item.request)),
          options,
          `Batch read (${chunk.length} tags)`,
        );
        embedded = parseMultipleServiceReply(response);
        if (embedded.length !== chunk.length) {
          throw new RangeError(
            `expected ${chunk.length} embedded replies, got ${embedded.length}`,
          );
        }
      } catch {
        // Target may not support Multiple Service Packet (or the reply was
        // malformed) — fall back to honest per-tag reads for this chunk.
        for (const item of chunk) {
          await this.readSingleInto(item.name, results, errors, options);
        }
        continue;
      }
      for (let index = 0; index < chunk.length; index += 1) {
        const name = chunk[index].name;
        const reply = embedded[index];
        if (reply.generalStatus === CipGeneralStatus.PartialTransfer) {
          // Large value: re-read this one tag through the fragmented path.
          await this.readSingleInto(name, results, errors, options);
          continue;
        }
        try {
          results[name] = parseReadTagReply(reply, `Read Tag ${JSON.stringify(name)}`);
        } catch (cause) {
          errors[name] = cause instanceof Error ? cause.message : String(cause);
        }
      }
    }
    return { results, errors };
  }

  private async readSingleInto(
    name: string,
    results: Record<string, ReadTagResult>,
    errors: Record<string, string>,
    options: LogixRequestOptions,
  ): Promise<void> {
    try {
      results[name] = await this.readTag(name, 1, options);
    } catch (cause) {
      errors[name] = cause instanceof Error ? cause.message : String(cause);
    }
  }

  /**
   * Enumerates the symbol table for one scope (controller scope by default,
   * or one program), following pagination to the end.
   */
  async listTags(
    scope: { programName?: string } = {},
    options: LogixRequestOptions = {},
  ): Promise<SymbolInstance[]> {
    const label = scope.programName ?? "controller scope";
    const symbols: SymbolInstance[] = [];
    let startInstance = 0;
    for (;;) {
      const response = await this.sendUcmm(
        buildTagListRequest(startInstance, scope.programName),
        options,
        `Tag list (${label}) from instance ${startInstance}`,
      );
      const page = parseTagListReply(response);
      symbols.push(...page.symbols);
      if (!page.moreAvailable) return symbols;
      if (page.nextInstance <= startInstance) {
        throw new Error(
          `tag list (${label}) made no progress at instance ${startInstance} — aborting pagination`,
        );
      }
      startInstance = page.nextInstance;
    }
  }

  /**
   * Full read-only browse: controller-scope symbols plus the tags of every
   * program discovered there.
   */
  async browseAllTags(options: LogixRequestOptions = {}): Promise<{
    controller: SymbolInstance[];
    programs: Record<string, SymbolInstance[]>;
  }> {
    const controller = await this.listTags({}, options);
    const programs: Record<string, SymbolInstance[]> = {};
    for (const symbol of controller.filter(isProgramSymbol)) {
      programs[symbol.name] = await this.listTags({ programName: symbol.name }, options);
    }
    return { controller, programs };
  }

  // ── pipeline internals ────────────────────────────────────────────────────

  private enqueue(
    request: Omit<PendingRequest, "resolve" | "reject">,
  ): Promise<EncapsulationPacket> {
    if (this.sessionState === "closed" || this.sessionState === "failed") {
      return Promise.reject(new Error(`cannot send ${request.describe}: session ${this.sessionState}`));
    }
    if (this.sessionState === "idle") {
      return Promise.reject(new Error(`cannot send ${request.describe}: session not opened`));
    }
    return new Promise<EncapsulationPacket>((resolve, reject) => {
      this.queue.push({ ...request, resolve, reject });
      this.pump();
    });
  }

  /** Emits the next queued frame when nothing is in flight. */
  private pump(): void {
    if (this.inflight || this.queue.length === 0) return;
    const next = this.queue[0];
    // UCMM/connected frames need the session handle; hold until registered.
    if ((next.kind === "ucmm" || next.kind === "connected") && this.sessionState !== "ready") {
      return;
    }
    this.queue.shift();
    this.inflight = next;
    try {
      this.emitFrame(next.buildFrame());
    } catch (error) {
      this.inflight = undefined;
      next.reject(error instanceof Error ? error : new Error(String(error)));
      this.pump();
    }
  }

  private emitFrame(frame: Uint8Array): void {
    this.outbound.push(frame);
    this.hooks.onOutbound?.();
  }

  private dispatch(packet: EncapsulationPacket): void {
    const inflight = this.inflight;
    if (!inflight) {
      this.protocolViolation(
        `unexpected packet (command 0x${packet.command.toString(16)}) with no request in flight`,
      );
      return;
    }
    if (packet.command !== inflight.expectedCommand) {
      this.protocolViolation(
        `reply command 0x${packet.command.toString(16)} does not match in-flight ` +
          `${inflight.describe} (expected 0x${inflight.expectedCommand.toString(16)})`,
      );
      return;
    }
    this.inflight = undefined;
    if (packet.status !== 0) {
      // Encapsulation-level failures (bad session handle, length errors, …)
      // poison the whole session — reject everything and stop.
      const error = new Error(`${inflight.describe} failed: ${enipStatusMessage(packet.status)}`);
      this.sessionState = "failed";
      inflight.reject(error);
      this.rejectAll(error);
      return;
    }
    inflight.resolve(packet);
    this.pump();
  }

  private protocolViolation(message: string): void {
    const error = new Error(`EtherNet/IP protocol violation: ${message}`);
    this.sessionState = "failed";
    this.rejectAll(error);
  }

  private rejectAll(error: Error): void {
    const inflight = this.inflight;
    this.inflight = undefined;
    if (inflight) inflight.reject(error);
    for (const pending of this.queue.splice(0, this.queue.length)) {
      pending.reject(error);
    }
  }
}

/**
 * Returns the type prefix (type code, plus structure handle when present) of
 * a Read Tag reply payload. Fragmented continuations repeat this prefix; the
 * value bytes follow it.
 */
function typePrefixOf(payload: Uint8Array, context: string): Uint8Array {
  if (payload.length < 2) {
    throw new RangeError(`${context}: reply payload too short for a type code`);
  }
  const typeCode = payload[0] | (payload[1] << 8);
  const prefixLength = typeCode === STRUCTURE_TYPE_CODE ? 4 : 2;
  if (payload.length < prefixLength) {
    throw new RangeError(`${context}: reply payload too short for a structure handle`);
  }
  return payload.slice(0, prefixLength);
}
