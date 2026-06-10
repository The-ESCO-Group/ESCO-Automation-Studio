/**
 * CIP Message Router request/response codec plus general status decoding.
 *
 * PURE byte codec; no I/O.
 */

import { ByteReader, ByteWriter } from "../bytes";
import { encodePaddedEpath, type EpathSegment } from "./epath";

export interface MessageRouterResponse {
  /** Reply service code: the request service with bit 7 set (e.g. 0x4C → 0xCC). */
  replyService: number;
  generalStatus: number;
  /** Additional status words (e.g. extended Logix error codes). */
  additionalStatus: readonly number[];
  /** Service-specific reply payload. */
  data: Uint8Array;
}

export function encodeMessageRouterRequest(
  service: number,
  path: readonly EpathSegment[],
  requestData: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const encoded = encodePaddedEpath(path);
  if (encoded.wordCount > 0xff) {
    throw new RangeError(`request path of ${encoded.wordCount} words exceeds the u8 limit`);
  }
  const writer = new ByteWriter(2 + encoded.path.length + requestData.length);
  writer.u8(service);
  writer.u8(encoded.wordCount);
  writer.bytes(encoded.path);
  writer.bytes(requestData);
  return writer.toBytes();
}

export function decodeMessageRouterResponse(bytes: Uint8Array): MessageRouterResponse {
  const reader = new ByteReader(bytes);
  const replyService = reader.u8();
  reader.skip(1); // reserved
  const generalStatus = reader.u8();
  const additionalStatusWords = reader.u8();
  const additionalStatus: number[] = [];
  for (let i = 0; i < additionalStatusWords; i += 1) additionalStatus.push(reader.u16());
  return { replyService, generalStatus, additionalStatus, data: reader.rest() };
}

/** CIP general status codes this client cares about by name. */
export const CipGeneralStatus = {
  Success: 0x00,
  ConnectionFailure: 0x01,
  ResourceUnavailable: 0x02,
  PathSegmentError: 0x04,
  PathDestinationUnknown: 0x05,
  PartialTransfer: 0x06,
  ConnectionLost: 0x07,
  ServiceNotSupported: 0x08,
  InvalidAttributeValue: 0x09,
  AttributeListError: 0x0a,
  AlreadyInRequestedState: 0x0b,
  ObjectStateConflict: 0x0c,
  AttributeNotSettable: 0x0e,
  PrivilegeViolation: 0x0f,
  DeviceStateConflict: 0x10,
  ReplyDataTooLarge: 0x11,
  NotEnoughData: 0x13,
  AttributeNotSupported: 0x14,
  TooMuchData: 0x15,
  ObjectDoesNotExist: 0x16,
  VendorSpecificError: 0x1f,
  InvalidParameter: 0x20,
  PathSizeInvalid: 0x26,
} as const;

const CIP_STATUS_MESSAGES: Readonly<Record<number, string>> = {
  [CipGeneralStatus.Success]: "success",
  [CipGeneralStatus.ConnectionFailure]: "connection failure",
  [CipGeneralStatus.ResourceUnavailable]: "resource unavailable",
  [CipGeneralStatus.PathSegmentError]: "path segment error (tag path not understood)",
  [CipGeneralStatus.PathDestinationUnknown]: "path destination unknown (tag or object not found)",
  [CipGeneralStatus.PartialTransfer]: "partial transfer (more data available)",
  [CipGeneralStatus.ConnectionLost]: "connection lost",
  [CipGeneralStatus.ServiceNotSupported]: "service not supported",
  [CipGeneralStatus.InvalidAttributeValue]: "invalid attribute value",
  [CipGeneralStatus.AttributeListError]: "attribute list error",
  [CipGeneralStatus.AlreadyInRequestedState]: "already in requested mode/state",
  [CipGeneralStatus.ObjectStateConflict]: "object state conflict",
  [CipGeneralStatus.AttributeNotSettable]: "attribute not settable",
  [CipGeneralStatus.PrivilegeViolation]: "privilege violation",
  [CipGeneralStatus.DeviceStateConflict]: "device state conflict",
  [CipGeneralStatus.ReplyDataTooLarge]: "reply data too large",
  [CipGeneralStatus.NotEnoughData]: "not enough data",
  [CipGeneralStatus.AttributeNotSupported]: "attribute not supported",
  [CipGeneralStatus.TooMuchData]: "too much data",
  [CipGeneralStatus.ObjectDoesNotExist]: "object does not exist",
  [CipGeneralStatus.VendorSpecificError]: "vendor-specific error",
  [CipGeneralStatus.InvalidParameter]: "invalid parameter",
  [CipGeneralStatus.PathSizeInvalid]: "path size invalid",
};

export function cipStatusMessage(status: number): string {
  return (
    CIP_STATUS_MESSAGES[status] ?? `CIP general status 0x${status.toString(16).padStart(2, "0")}`
  );
}

/** Error raised when a CIP reply reports a non-success general status. */
export class CipResponseError extends Error {
  readonly generalStatus: number;
  readonly additionalStatus: readonly number[];

  constructor(context: string, response: MessageRouterResponse) {
    const extra =
      response.additionalStatus.length > 0
        ? ` (additional: ${response.additionalStatus
            .map((word) => `0x${word.toString(16).padStart(4, "0")}`)
            .join(", ")})`
        : "";
    super(`${context}: ${cipStatusMessage(response.generalStatus)}${extra}`);
    this.name = "CipResponseError";
    this.generalStatus = response.generalStatus;
    this.additionalStatus = response.additionalStatus;
  }
}

/**
 * Asserts a reply succeeded and returns its payload. Pass
 * `allowPartialTransfer` for paginated services (tag list, fragmented reads)
 * where status 0x06 means "more data follows", not failure.
 */
export function expectCipSuccess(
  response: MessageRouterResponse,
  context: string,
  options: { allowPartialTransfer?: boolean } = {},
): Uint8Array {
  const ok =
    response.generalStatus === CipGeneralStatus.Success ||
    (options.allowPartialTransfer === true &&
      response.generalStatus === CipGeneralStatus.PartialTransfer);
  if (!ok) throw new CipResponseError(context, response);
  return response.data;
}
