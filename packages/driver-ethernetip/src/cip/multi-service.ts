/**
 * CIP Multiple Service Packet (service 0x0A on the Message Router object) —
 * carries several embedded message-router requests in ONE wire round trip and
 * returns their individual replies. This is what makes batched tag polling
 * efficient: N tag reads stop costing N TCP round trips.
 *
 * Layout (public CIP knowledge, used by every open EtherNet/IP stack):
 *   request data:  u16 count, u16 offsets[count], embedded requests…
 *   reply data:    u16 count, u16 offsets[count], embedded replies…
 * Offsets are byte distances from the start of the data section (the count
 * word) to each embedded message. The outer reply's general status is 0x00
 * when every embedded service succeeded and 0x1E ("embedded service error")
 * when at least one failed — both carry parseable embedded replies.
 *
 * PURE byte codec; no I/O. Read-only use here: the embedded requests this
 * package builds are tag reads — there is still no write builder anywhere.
 */

import { ByteReader, ByteWriter } from "../bytes";
import { classSegment, instanceSegment } from "./epath";
import {
  decodeMessageRouterResponse,
  encodeMessageRouterRequest,
  type MessageRouterResponse,
} from "./message-router";

export const MESSAGE_ROUTER_CLASS = 0x02;
export const SERVICE_MULTIPLE_SERVICE_PACKET = 0x0a;

/** CIP general status the outer reply uses when an embedded service failed. */
export const STATUS_EMBEDDED_SERVICE_ERROR = 0x1e;

/**
 * Builds one Multiple Service Packet message-router request wrapping
 * `embeddedRequests` (each a complete message-router request).
 */
export function encodeMultipleServicePacket(embeddedRequests: readonly Uint8Array[]): Uint8Array {
  if (embeddedRequests.length === 0) {
    throw new RangeError("multiple service packet requires at least one embedded request");
  }
  if (embeddedRequests.length > 0xffff) {
    throw new RangeError(`too many embedded requests: ${embeddedRequests.length}`);
  }
  const data = new ByteWriter();
  data.u16(embeddedRequests.length);
  let offset = 2 + 2 * embeddedRequests.length;
  for (const request of embeddedRequests) {
    data.u16(offset);
    offset += request.length;
  }
  for (const request of embeddedRequests) {
    data.bytes(request);
  }
  return encodeMessageRouterRequest(
    SERVICE_MULTIPLE_SERVICE_PACKET,
    [classSegment(MESSAGE_ROUTER_CLASS), instanceSegment(0x01)],
    data.toBytes(),
  );
}

/**
 * Splits a Multiple Service Packet reply into its embedded message-router
 * responses (positionally matching the embedded requests). Accepts outer
 * status 0x00 and 0x1E; anything else is a transport-level failure the
 * caller should surface via {@link CipResponseError} semantics.
 */
export function parseMultipleServiceReply(
  response: MessageRouterResponse,
): MessageRouterResponse[] {
  if (response.generalStatus !== 0x00 && response.generalStatus !== STATUS_EMBEDDED_SERVICE_ERROR) {
    throw new RangeError(
      `multiple service packet failed with CIP status 0x${response.generalStatus
        .toString(16)
        .padStart(2, "0")}`,
    );
  }
  const data = response.data;
  const reader = new ByteReader(data);
  const count = reader.u16();
  const offsets: number[] = [];
  for (let index = 0; index < count; index += 1) offsets.push(reader.u16());
  const replies: MessageRouterResponse[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = offsets[index];
    const end = index + 1 < count ? offsets[index + 1] : data.length;
    if (start < 2 + 2 * count || end > data.length || end < start) {
      throw new RangeError(
        `embedded reply ${index} has invalid bounds ${start}..${end} of ${data.length}`,
      );
    }
    replies.push(decodeMessageRouterResponse(data.slice(start, end)));
  }
  return replies;
}

/**
 * Encodes a Multiple Service Packet REPLY from embedded responses — used by
 * the test-only fake target (and tests) to answer like a real device. Not
 * part of the client path.
 */
export function encodeMultipleServiceReply(
  embeddedResponses: readonly Uint8Array[],
  outerStatus = 0x00,
): Uint8Array {
  const writer = new ByteWriter();
  writer.u8(SERVICE_MULTIPLE_SERVICE_PACKET | 0x80);
  writer.u8(0x00);
  writer.u8(outerStatus);
  writer.u8(0x00); // no additional status words
  writer.u16(embeddedResponses.length);
  let offset = 2 + 2 * embeddedResponses.length;
  for (const response of embeddedResponses) {
    writer.u16(offset);
    offset += response.length;
  }
  for (const response of embeddedResponses) {
    writer.bytes(response);
  }
  return writer.toBytes();
}
