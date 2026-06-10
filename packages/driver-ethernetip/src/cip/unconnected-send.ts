/**
 * CIP Unconnected Send (service 0x52 on the Connection Manager object) —
 * wraps an embedded message-router request with a route path so a chassis
 * bridge (e.g. an EtherNet/IP module) forwards it to the controller CPU in
 * another slot. Direct-to-CPU targets (many CompactLogix) still accept a
 * backplane/slot-0 route, so callers route explicitly and deterministically.
 *
 * PURE byte codec; no I/O.
 */

import { ByteWriter } from "../bytes";
import { classSegment, instanceSegment, portSegment, type EpathSegment } from "./epath";
import { encodeMessageRouterRequest } from "./message-router";

export const CONNECTION_MANAGER_CLASS = 0x06;
export const SERVICE_UNCONNECTED_SEND = 0x52;

export interface RouteHop {
  /** CIP port number (1 = backplane on Logix chassis). */
  port: number;
  /** Link address on that port (slot number for a backplane hop). */
  link: number;
}

/** Conventional route for a Logix CPU: backplane (port 1), given slot. */
export function backplaneRoute(slot = 0): RouteHop[] {
  return [{ port: 1, link: slot }];
}

export interface UnconnectedSendOptions {
  /** Priority/time-tick byte; default 0x0a mirrors common engineering clients. */
  priorityTimeTick?: number;
  /** Timeout ticks; default 0x05. */
  timeoutTicks?: number;
}

/**
 * Builds the full message-router request for an Unconnected Send carrying
 * `embeddedRequest` through `route`.
 */
export function encodeUnconnectedSendRequest(
  embeddedRequest: Uint8Array,
  route: readonly RouteHop[],
  options: UnconnectedSendOptions = {},
): Uint8Array {
  if (route.length === 0) {
    throw new RangeError("unconnected send requires at least one route hop");
  }
  if (embeddedRequest.length > 0xffff) {
    throw new RangeError(`embedded request of ${embeddedRequest.length} bytes exceeds the u16 limit`);
  }
  const routeSegments: EpathSegment[] = route.map((hop) => portSegment(hop.port, hop.link));

  const data = new ByteWriter(8 + embeddedRequest.length + route.length * 2);
  data.u8(options.priorityTimeTick ?? 0x0a);
  data.u8(options.timeoutTicks ?? 0x05);
  data.u16(embeddedRequest.length);
  data.bytes(embeddedRequest);
  if (embeddedRequest.length % 2 !== 0) data.u8(0x00); // pad to word boundary
  data.u8(route.length); // route path size in words (each simple hop is one word)
  data.u8(0x00); // reserved
  for (const segment of routeSegments) {
    if (segment.kind !== "port") throw new RangeError("internal: route segments must be ports");
    data.u8(segment.port).u8(segment.link);
  }

  return encodeMessageRouterRequest(
    SERVICE_UNCONNECTED_SEND,
    [classSegment(CONNECTION_MANAGER_CLASS), instanceSegment(0x01)],
    data.toBytes(),
  );
}
