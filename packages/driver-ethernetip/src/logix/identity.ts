/**
 * CIP Identity object (class 0x01) reading: who is this device, what firmware,
 * and is it faulted. Two paths produce the same shape:
 *
 *   - ListIdentity encapsulation broadcast/reply (no CIP session needed) —
 *     parse the 0x000C CPF item with {@link parseListIdentityItem}.
 *   - Get Attributes All on Identity instance 1 over a registered session —
 *     build with {@link buildIdentityRequest}, parse with
 *     {@link parseIdentityReply}.
 *
 * PURE byte codec; no I/O. Read-only: identity reads cannot alter state.
 */

import { ByteReader } from "../bytes";
import type { CpfItem } from "../enip/cpf";
import { CpfItemType } from "../enip/cpf";
import { classSegment, instanceSegment } from "../cip/epath";
import {
  encodeMessageRouterRequest,
  expectCipSuccess,
  type MessageRouterResponse,
} from "../cip/message-router";

export const IDENTITY_CLASS = 0x01;
export const SERVICE_GET_ATTRIBUTES_ALL = 0x01;

/** Fault flags decoded from the Identity status word (attribute 5). */
export interface IdentityFaults {
  minorRecoverable: boolean;
  minorUnrecoverable: boolean;
  majorRecoverable: boolean;
  majorUnrecoverable: boolean;
}

export interface CipIdentity {
  vendorId: number;
  /** Human-readable vendor, when the id is one this client recognizes. */
  vendorName?: string;
  deviceType: number;
  productCode: number;
  /** "major.minor", e.g. "33.11". */
  revision: string;
  /** Raw Identity status word. */
  status: number;
  faults: IdentityFaults;
  /** True when any fault bit is set in the status word. */
  faulted: boolean;
  /** Keyswitch/mode ("Run", "Remote Program", …) when the status encodes one. */
  keyswitch?: string;
  serialNumber: number;
  productName: string;
}

export interface ListIdentityInfo extends CipIdentity {
  protocolVersion: number;
  /** Device state byte from the ListIdentity item. */
  state: number;
}

// Deliberately tiny: only ids this Allen-Bradley-focused client expects.
const KNOWN_VENDORS: Readonly<Record<number, string>> = {
  1: "Rockwell Automation/Allen-Bradley",
};

export function decodeIdentityStatus(status: number): IdentityFaults {
  return {
    minorRecoverable: (status & 0x0100) !== 0,
    minorUnrecoverable: (status & 0x0200) !== 0,
    majorRecoverable: (status & 0x0400) !== 0,
    majorUnrecoverable: (status & 0x0800) !== 0,
  };
}

/**
 * Keyswitch/mode positions encoded in the Logix identity status word. Public
 * identity-status behavior uses the LOW status byte for the group and the HIGH
 * byte for the position. Anything unlisted decodes to undefined — the mode is
 * then honestly "not known", never guessed.
 */
const KEYSWITCH_POSITIONS: Readonly<Record<number, Readonly<Record<number, string>>>> = {
  0x60: { 0x10: "Run", 0x11: "Run", 0x30: "Remote Run", 0x31: "Remote Run" },
  0x70: { 0x20: "Program", 0x21: "Program", 0x30: "Remote Program", 0x31: "Remote Program" },
};

/** Decodes the keyswitch/mode from the raw identity status word, if known. */
export function decodeKeyswitchPosition(status: number): string | undefined {
  return KEYSWITCH_POSITIONS[status & 0xff]?.[(status >> 8) & 0xff];
}

export function formatSerialNumber(serialNumber: number): string {
  return serialNumber.toString(16).padStart(8, "0").toUpperCase();
}

/** Get Attributes All on Identity instance 1. */
export function buildIdentityRequest(): Uint8Array {
  return encodeMessageRouterRequest(SERVICE_GET_ATTRIBUTES_ALL, [
    classSegment(IDENTITY_CLASS),
    instanceSegment(0x01),
  ]);
}

/** Shared field layout: vendor through product name. */
function readIdentityCore(reader: ByteReader): CipIdentity {
  const vendorId = reader.u16();
  const deviceType = reader.u16();
  const productCode = reader.u16();
  const revisionMajor = reader.u8();
  const revisionMinor = reader.u8();
  const status = reader.u16();
  const serialNumber = reader.u32();
  const nameLength = reader.u8();
  const productName = reader.ascii(nameLength);
  const faults = decodeIdentityStatus(status);
  return {
    vendorId,
    vendorName: KNOWN_VENDORS[vendorId],
    deviceType,
    productCode,
    revision: `${revisionMajor}.${revisionMinor}`,
    status,
    faults,
    faulted:
      faults.minorRecoverable ||
      faults.minorUnrecoverable ||
      faults.majorRecoverable ||
      faults.majorUnrecoverable,
    keyswitch: decodeKeyswitchPosition(status),
    serialNumber,
    productName,
  };
}

/** Parses a Get Attributes All (Identity) reply. */
export function parseIdentityReply(response: MessageRouterResponse): CipIdentity {
  const payload = expectCipSuccess(response, "Identity Get Attributes All");
  return readIdentityCore(new ByteReader(payload));
}

/**
 * Parses one 0x000C CPF item from a ListIdentity reply. The embedded sockaddr
 * is the one big-endian field in this package; it is skipped, not decoded —
 * the caller already knows which host it asked.
 */
export function parseListIdentityItem(item: CpfItem): ListIdentityInfo {
  if (item.typeId !== CpfItemType.ListIdentityResponse) {
    throw new RangeError(
      `expected ListIdentity item 0x000c, got 0x${item.typeId.toString(16).padStart(4, "0")}`,
    );
  }
  const reader = new ByteReader(item.data);
  const protocolVersion = reader.u16();
  reader.skip(16); // sockaddr_in (big-endian) — intentionally not decoded
  const core = readIdentityCore(reader);
  const state = reader.remaining() > 0 ? reader.u8() : 0;
  return { ...core, protocolVersion, state };
}
