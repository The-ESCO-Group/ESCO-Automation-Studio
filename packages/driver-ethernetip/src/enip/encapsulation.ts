/**
 * EtherNet/IP encapsulation layer codec (ESCO-owned, written from the public
 * ODVA EtherNet/IP specification — no vendor code, no vendor runtime).
 *
 * This module is PURE: it encodes/decodes byte frames only. It opens no
 * sockets and talks to no controller. The TCP transport that will eventually
 * carry these frames is a separate, backend-only concern.
 */

import { ByteReader, ByteWriter } from "../bytes";

/** Registered TCP port for EtherNet/IP explicit messaging. */
export const ENIP_DEFAULT_PORT = 44818;

/** Encapsulation header is a fixed 24 bytes. */
export const ENIP_HEADER_SIZE = 24;

/** Largest data payload the u16 length field can describe. */
export const ENIP_MAX_DATA_LENGTH = 0xffff;

/** Encapsulation commands used by an explicit-messaging (engineering) client. */
export const EnipCommand = {
  Nop: 0x0000,
  ListServices: 0x0004,
  ListIdentity: 0x0063,
  ListInterfaces: 0x0064,
  RegisterSession: 0x0065,
  UnregisterSession: 0x0066,
  SendRRData: 0x006f,
  SendUnitData: 0x0070,
} as const;

export type EnipCommandCode = (typeof EnipCommand)[keyof typeof EnipCommand];

/** Encapsulation status codes (header `status` field). */
export const EnipStatus = {
  Success: 0x0000,
  InvalidCommand: 0x0001,
  InsufficientMemory: 0x0002,
  IncorrectData: 0x0003,
  InvalidSessionHandle: 0x0064,
  InvalidLength: 0x0065,
  UnsupportedProtocolVersion: 0x0069,
} as const;

const ENIP_STATUS_MESSAGES: Readonly<Record<number, string>> = {
  [EnipStatus.Success]: "success",
  [EnipStatus.InvalidCommand]: "invalid or unsupported encapsulation command",
  [EnipStatus.InsufficientMemory]: "insufficient memory on target",
  [EnipStatus.IncorrectData]: "poorly formed or incorrect encapsulation data",
  [EnipStatus.InvalidSessionHandle]: "invalid session handle",
  [EnipStatus.InvalidLength]: "invalid encapsulation length",
  [EnipStatus.UnsupportedProtocolVersion]: "unsupported encapsulation protocol version",
};

export function enipStatusMessage(status: number): string {
  return (
    ENIP_STATUS_MESSAGES[status] ??
    `unknown encapsulation status 0x${status.toString(16).padStart(4, "0")}`
  );
}

/** One decoded encapsulation packet (header + raw command-specific data). */
export interface EncapsulationPacket {
  command: number;
  sessionHandle: number;
  status: number;
  /** Always 8 bytes; echoed verbatim by the target. */
  senderContext: Uint8Array;
  options: number;
  data: Uint8Array;
}

export interface EncodeEncapsulationInput {
  command: number;
  sessionHandle?: number;
  status?: number;
  senderContext?: Uint8Array;
  options?: number;
  data?: Uint8Array;
}

/** Fresh all-zero sender context (a new array each call — never shared). */
export function zeroSenderContext(): Uint8Array {
  return new Uint8Array(8);
}

export function encodeEncapsulation(input: EncodeEncapsulationInput): Uint8Array {
  const data = input.data ?? new Uint8Array(0);
  if (data.length > ENIP_MAX_DATA_LENGTH) {
    throw new RangeError(
      `encapsulation data of ${data.length} bytes exceeds the u16 limit of ${ENIP_MAX_DATA_LENGTH}`,
    );
  }
  const senderContext = input.senderContext ?? zeroSenderContext();
  if (senderContext.length !== 8) {
    throw new RangeError(`senderContext must be exactly 8 bytes, got ${senderContext.length}`);
  }
  const writer = new ByteWriter(ENIP_HEADER_SIZE + data.length);
  writer.u16(input.command);
  writer.u16(data.length);
  writer.u32(input.sessionHandle ?? 0);
  writer.u32(input.status ?? 0);
  writer.bytes(senderContext);
  writer.u32(input.options ?? 0);
  writer.bytes(data);
  return writer.toBytes();
}

/**
 * Decodes one complete encapsulation packet. The buffer must contain exactly
 * the header plus the advertised data length (the stream framer guarantees
 * this); anything else is a protocol error and throws.
 */
export function decodeEncapsulation(bytes: Uint8Array): EncapsulationPacket {
  if (bytes.length < ENIP_HEADER_SIZE) {
    throw new RangeError(
      `encapsulation packet needs at least ${ENIP_HEADER_SIZE} bytes, got ${bytes.length}`,
    );
  }
  const reader = new ByteReader(bytes);
  const command = reader.u16();
  const length = reader.u16();
  const sessionHandle = reader.u32();
  const status = reader.u32();
  const senderContext = reader.bytes(8);
  const options = reader.u32();
  if (reader.remaining() !== length) {
    throw new RangeError(
      `encapsulation header advertises ${length} data byte(s) but ${reader.remaining()} follow`,
    );
  }
  const data = reader.bytes(length);
  return { command, sessionHandle, status, senderContext, options, data };
}

/** RegisterSession request: protocol version 1, option flags 0. */
export function encodeRegisterSessionRequest(senderContext?: Uint8Array): Uint8Array {
  const body = new ByteWriter(4);
  body.u16(1); // requested encapsulation protocol version
  body.u16(0); // option flags — none defined
  return encodeEncapsulation({
    command: EnipCommand.RegisterSession,
    senderContext,
    data: body.toBytes(),
  });
}

export interface RegisterSessionReply {
  sessionHandle: number;
  protocolVersion: number;
  optionFlags: number;
}

/** Decodes a RegisterSession reply packet; throws on a non-success status. */
export function decodeRegisterSessionReply(packet: EncapsulationPacket): RegisterSessionReply {
  if (packet.command !== EnipCommand.RegisterSession) {
    throw new RangeError(
      `expected RegisterSession reply (0x65), got command 0x${packet.command.toString(16)}`,
    );
  }
  if (packet.status !== EnipStatus.Success) {
    throw new Error(`RegisterSession failed: ${enipStatusMessage(packet.status)}`);
  }
  const reader = new ByteReader(packet.data);
  const protocolVersion = reader.u16();
  const optionFlags = reader.u16();
  return { sessionHandle: packet.sessionHandle, protocolVersion, optionFlags };
}

/** UnregisterSession request — no body; target closes the TCP connection. */
export function encodeUnregisterSessionRequest(
  sessionHandle: number,
  senderContext?: Uint8Array,
): Uint8Array {
  return encodeEncapsulation({
    command: EnipCommand.UnregisterSession,
    sessionHandle,
    senderContext,
  });
}

/** ListIdentity request — no body; may be sent before a session is registered. */
export function encodeListIdentityRequest(senderContext?: Uint8Array): Uint8Array {
  return encodeEncapsulation({ command: EnipCommand.ListIdentity, senderContext });
}
