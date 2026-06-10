/**
 * CIP Forward Open / Forward Close codecs (connected class-3 messaging).
 *
 * See docs/goal-b-forward-open-design.md for the verified field layouts and
 * the honest framing: CIP has NO tag-level push — a class-3 connection makes
 * the existing read-only polling cheaper (sequenced exchanges, connection
 * timeout, larger packet budget), nothing more. Defaults below match the
 * publicly observed reference-stack values (priority/time_tick 0x0A, timeout
 * ticks 0x05, timeout multiplier 0x07, transport class/trigger 0xA3 =
 * class 3 server, RPI 0x00204001 µs, network-parameter base 0b0100_0010_0000_0000).
 *
 * PURE byte codecs; no I/O. Read-only milestone unchanged: a connection that
 * carries Read Tag requests cannot write any more than UCMM could.
 */

import { ByteReader, ByteWriter } from "../bytes";
import {
  classSegment,
  encodePaddedEpath,
  instanceSegment,
  portSegment,
  type EpathSegment,
} from "./epath";
import {
  encodeMessageRouterRequest,
  expectCipSuccess,
  type MessageRouterResponse,
} from "./message-router";
import { CONNECTION_MANAGER_CLASS, type RouteHop } from "./unconnected-send";

export const SERVICE_FORWARD_OPEN = 0x54;
export const SERVICE_LARGE_FORWARD_OPEN = 0x5b;
export const SERVICE_FORWARD_CLOSE = 0x4e;

/** Class-3, server, application-triggered — connected explicit messaging. */
export const TRANSPORT_CLASS_3_SERVER = 0xa3;

/** Reference-compatible RPI (µs). Configurable per open. */
export const DEFAULT_RPI_MICROSECONDS = 0x00204001;

/** Variable-size + class/priority bits of the network parameters word. */
const NET_PARAMS_BASE = 0b0100_0010_0000_0000;

const DEFAULT_PRIORITY_TIME_TICK = 0x0a;
const DEFAULT_TIMEOUT_TICKS = 0x05;
const DEFAULT_TIMEOUT_MULTIPLIER = 0x07;

export interface ForwardOpenOptions {
  /** Originator-chosen T→O connection ID. */
  originatorConnectionId: number;
  /** Originator-chosen connection serial number (unique per connection). */
  connectionSerial: number;
  /** Originator vendor ID. */
  vendorId: number;
  /** Originator serial number. */
  originatorSerial: number;
  /** Chassis route to the CPU; omit for direct targets. */
  route?: readonly RouteHop[];
  /** Use Large Forward Open (0x5B) for connection sizes above 511 bytes. */
  large?: boolean;
  /** Connection size in bytes (default 500 standard / 4000 large). */
  connectionSizeBytes?: number;
  /** Requested packet interval, µs (both directions). */
  rpiMicroseconds?: number;
  priorityTimeTick?: number;
  timeoutTicks?: number;
  timeoutMultiplier?: number;
}

function connectionPathSegments(route: readonly RouteHop[] | undefined): EpathSegment[] {
  return [
    ...(route ?? []).map((hop) => portSegment(hop.port, hop.link)),
    classSegment(0x02), // Message Router
    instanceSegment(0x01),
  ];
}

/** Builds the Forward Open (or Large Forward Open) message-router request. */
export function buildForwardOpenRequest(options: ForwardOpenOptions): Uint8Array {
  const large = options.large === true;
  const size = options.connectionSizeBytes ?? (large ? 4000 : 500);
  if (!large && size > 0x1ff) {
    throw new RangeError(
      `standard Forward Open carries at most 511-byte connections (got ${size}); set large: true`,
    );
  }
  if (large && size > 0xffff) {
    throw new RangeError(`large Forward Open connection size ${size} exceeds the u16 field`);
  }
  const rpi = options.rpiMicroseconds ?? DEFAULT_RPI_MICROSECONDS;

  const data = new ByteWriter(48);
  data.u8(options.priorityTimeTick ?? DEFAULT_PRIORITY_TIME_TICK);
  data.u8(options.timeoutTicks ?? DEFAULT_TIMEOUT_TICKS);
  data.u32(0); // O→T connection ID — target assigns
  data.u32(options.originatorConnectionId);
  data.u16(options.connectionSerial);
  data.u16(options.vendorId);
  data.u32(options.originatorSerial);
  data.u8(options.timeoutMultiplier ?? DEFAULT_TIMEOUT_MULTIPLIER);
  data.bytes([0, 0, 0]); // reserved
  const writeNetParams = (): void => {
    if (large) data.u32((NET_PARAMS_BASE << 16) | (size & 0xffff));
    else data.u16(NET_PARAMS_BASE | (size & 0x1ff));
  };
  data.u32(rpi);
  writeNetParams();
  data.u32(rpi);
  writeNetParams();
  data.u8(TRANSPORT_CLASS_3_SERVER);
  const path = encodePaddedEpath(connectionPathSegments(options.route));
  data.u8(path.wordCount);
  data.bytes(path.path);

  return encodeMessageRouterRequest(
    large ? SERVICE_LARGE_FORWARD_OPEN : SERVICE_FORWARD_OPEN,
    [classSegment(CONNECTION_MANAGER_CLASS), instanceSegment(0x01)],
    data.toBytes(),
  );
}

export interface ForwardOpenReply {
  /** Target-assigned O→T connection ID — used to address connected requests. */
  otConnectionId: number;
  /** Echo of the originator's T→O connection ID. */
  toConnectionId: number;
  connectionSerial: number;
  vendorId: number;
  originatorSerial: number;
  /** Actual packet intervals granted by the target, µs. */
  otApiMicroseconds: number;
  toApiMicroseconds: number;
}

export function parseForwardOpenReply(response: MessageRouterResponse): ForwardOpenReply {
  const payload = expectCipSuccess(response, "Forward Open");
  const reader = new ByteReader(payload);
  const otConnectionId = reader.u32();
  const toConnectionId = reader.u32();
  const connectionSerial = reader.u16();
  const vendorId = reader.u16();
  const originatorSerial = reader.u32();
  const otApiMicroseconds = reader.u32();
  const toApiMicroseconds = reader.u32();
  // application reply size (words) + reserved follow; nothing read-only needs them.
  return {
    otConnectionId,
    toConnectionId,
    connectionSerial,
    vendorId,
    originatorSerial,
    otApiMicroseconds,
    toApiMicroseconds,
  };
}

export interface ForwardCloseOptions {
  connectionSerial: number;
  vendorId: number;
  originatorSerial: number;
  route?: readonly RouteHop[];
  priorityTimeTick?: number;
  timeoutTicks?: number;
}

/** Builds the Forward Close message-router request. */
export function buildForwardCloseRequest(options: ForwardCloseOptions): Uint8Array {
  const data = new ByteWriter(16);
  data.u8(options.priorityTimeTick ?? DEFAULT_PRIORITY_TIME_TICK);
  data.u8(options.timeoutTicks ?? DEFAULT_TIMEOUT_TICKS);
  data.u16(options.connectionSerial);
  data.u16(options.vendorId);
  data.u32(options.originatorSerial);
  const path = encodePaddedEpath(connectionPathSegments(options.route));
  data.u8(path.wordCount);
  data.u8(0); // reserved byte between path size and path (Forward Close form)
  data.bytes(path.path);
  return encodeMessageRouterRequest(
    SERVICE_FORWARD_CLOSE,
    [classSegment(CONNECTION_MANAGER_CLASS), instanceSegment(0x01)],
    data.toBytes(),
  );
}

export interface ForwardCloseReply {
  connectionSerial: number;
  vendorId: number;
  originatorSerial: number;
}

export function parseForwardCloseReply(response: MessageRouterResponse): ForwardCloseReply {
  const payload = expectCipSuccess(response, "Forward Close");
  const reader = new ByteReader(payload);
  return {
    connectionSerial: reader.u16(),
    vendorId: reader.u16(),
    originatorSerial: reader.u32(),
  };
}
