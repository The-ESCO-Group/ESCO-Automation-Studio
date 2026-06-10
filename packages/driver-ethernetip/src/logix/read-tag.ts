/**
 * Logix Read Tag service codec (read-only by construction).
 *
 * This module deliberately exposes NO Write Tag (0x4D), Read-Modify-Write
 * (0x4E), or Write Tag Fragmented (0x53) builders. The Goal B read-only
 * milestone forbids any code path that could change a controller; a future
 * write path is a separate design with its own gates and validation.
 *
 * PURE byte codec; no I/O.
 */

import { ByteWriter } from "../bytes";
import { decodeTypedValue, type DecodedTagValue } from "../cip/data-types";
import { tagAddressToSegments } from "../cip/epath";
import {
  CipGeneralStatus,
  encodeMessageRouterRequest,
  expectCipSuccess,
  type MessageRouterResponse,
} from "../cip/message-router";

export const SERVICE_READ_TAG = 0x4c;
export const SERVICE_READ_TAG_FRAGMENTED = 0x52;

/** Builds a Read Tag (0x4C) message-router request for one tag address. */
export function buildReadTagRequest(tagAddress: string, elementCount = 1): Uint8Array {
  assertElementCount(elementCount);
  const data = new ByteWriter(2);
  data.u16(elementCount);
  return encodeMessageRouterRequest(SERVICE_READ_TAG, tagAddressToSegments(tagAddress), data.toBytes());
}

/**
 * Builds a Read Tag Fragmented (0x52) request resuming at `byteOffset` —
 * used when a full read replies with status 0x06 (partial transfer).
 */
export function buildReadTagFragmentedRequest(
  tagAddress: string,
  elementCount: number,
  byteOffset: number,
): Uint8Array {
  assertElementCount(elementCount);
  if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset > 0xffff_ffff) {
    throw new RangeError(`byte offset must be 0..2^32-1, got ${byteOffset}`);
  }
  const data = new ByteWriter(6);
  data.u16(elementCount);
  data.u32(byteOffset);
  return encodeMessageRouterRequest(
    SERVICE_READ_TAG_FRAGMENTED,
    tagAddressToSegments(tagAddress),
    data.toBytes(),
  );
}

export interface ReadTagResult extends DecodedTagValue {
  /** True when the reply is a partial transfer and a fragmented read must continue. */
  partial: boolean;
}

/**
 * Parses a Read Tag / Read Tag Fragmented reply into a decoded value.
 * Throws {@link CipResponseError} on any failure status.
 */
export function parseReadTagReply(
  response: MessageRouterResponse,
  context = "Read Tag",
): ReadTagResult {
  const payload = expectCipSuccess(response, context, { allowPartialTransfer: true });
  const decoded = decodeTypedValue(payload);
  return { ...decoded, partial: response.generalStatus === CipGeneralStatus.PartialTransfer };
}

function assertElementCount(elementCount: number): void {
  if (!Number.isInteger(elementCount) || elementCount < 1 || elementCount > 0xffff) {
    throw new RangeError(`element count must be 1..65535, got ${elementCount}`);
  }
}
