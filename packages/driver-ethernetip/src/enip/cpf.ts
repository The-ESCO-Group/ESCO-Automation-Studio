/**
 * Common Packet Format (CPF) codec — the item-list structure EtherNet/IP uses
 * inside SendRRData / SendUnitData payloads and ListIdentity replies.
 *
 * PURE byte codec; no I/O.
 */

import { ByteReader, ByteWriter } from "../bytes";

export const CpfItemType = {
  NullAddress: 0x0000,
  ListIdentityResponse: 0x000c,
  ConnectedAddress: 0x00a1,
  ConnectedData: 0x00b1,
  UnconnectedData: 0x00b2,
  SockaddrInfoOriginatorToTarget: 0x8000,
  SockaddrInfoTargetToOriginator: 0x8001,
  SequencedAddress: 0x8002,
} as const;

export interface CpfItem {
  typeId: number;
  data: Uint8Array;
}

export function encodeCpf(items: readonly CpfItem[]): Uint8Array {
  const writer = new ByteWriter();
  writer.u16(items.length);
  for (const item of items) {
    writer.u16(item.typeId);
    writer.u16(item.data.length);
    writer.bytes(item.data);
  }
  return writer.toBytes();
}

/** Decodes a CPF item list starting at the reader's current position. */
export function decodeCpf(reader: ByteReader): CpfItem[] {
  const count = reader.u16();
  const items: CpfItem[] = [];
  for (let i = 0; i < count; i += 1) {
    const typeId = reader.u16();
    const length = reader.u16();
    items.push({ typeId, data: reader.bytes(length) });
  }
  return items;
}

/**
 * Builds the SendRRData encapsulation payload that carries one unconnected
 * (UCMM) CIP request: CIP interface handle, timeout, then a two-item CPF of
 * [null address, unconnected data].
 */
export function encodeSendRRDataPayload(cipRequest: Uint8Array, timeoutSeconds = 10): Uint8Array {
  const writer = new ByteWriter(16 + cipRequest.length);
  writer.u32(0); // interface handle 0 = CIP
  writer.u16(timeoutSeconds);
  writer.bytes(
    encodeCpf([
      { typeId: CpfItemType.NullAddress, data: new Uint8Array(0) },
      { typeId: CpfItemType.UnconnectedData, data: cipRequest },
    ]),
  );
  return writer.toBytes();
}

export interface SendRRDataPayload {
  interfaceHandle: number;
  timeout: number;
  items: CpfItem[];
}

export function decodeSendRRDataPayload(data: Uint8Array): SendRRDataPayload {
  const reader = new ByteReader(data);
  const interfaceHandle = reader.u32();
  const timeout = reader.u16();
  const items = decodeCpf(reader);
  return { interfaceHandle, timeout, items };
}

/**
 * Builds the SendUnitData encapsulation payload that carries one CONNECTED
 * (class-3) request: CPF of [connected address (connection ID), connected
 * data (u16 sequence + message-router request)]. The sequence echoes back in
 * the reply and is the request/response correlator.
 */
export function encodeSendUnitDataPayload(
  connectionId: number,
  sequence: number,
  message: Uint8Array,
): Uint8Array {
  const address = new ByteWriter(4);
  address.u32(connectionId);
  const data = new ByteWriter(2 + message.length);
  data.u16(sequence);
  data.bytes(message);
  const writer = new ByteWriter(16 + message.length);
  writer.u32(0); // interface handle 0 = CIP
  writer.u16(0); // timeout — unused for connected data
  writer.bytes(
    encodeCpf([
      { typeId: CpfItemType.ConnectedAddress, data: address.toBytes() },
      { typeId: CpfItemType.ConnectedData, data: data.toBytes() },
    ]),
  );
  return writer.toBytes();
}

export interface SendUnitDataPayload {
  connectionId: number;
  sequence: number;
  /** The embedded message-router request or response. */
  message: Uint8Array;
}

export function decodeSendUnitDataPayload(payload: Uint8Array): SendUnitDataPayload {
  const reader = new ByteReader(payload);
  reader.skip(6); // interface handle + timeout
  const items = decodeCpf(reader);
  const address = items.find((item) => item.typeId === CpfItemType.ConnectedAddress);
  const data = items.find((item) => item.typeId === CpfItemType.ConnectedData);
  if (!address || address.data.length < 4 || !data || data.data.length < 2) {
    throw new RangeError("SendUnitData payload is missing connected address/data items");
  }
  const addressReader = new ByteReader(address.data);
  const dataReader = new ByteReader(data.data);
  return {
    connectionId: addressReader.u32(),
    sequence: dataReader.u16(),
    message: dataReader.rest(),
  };
}

/** Pulls the unconnected-data item out of a decoded CPF list, or throws. */
export function extractUnconnectedData(items: readonly CpfItem[]): Uint8Array {
  const item = items.find((candidate) => candidate.typeId === CpfItemType.UnconnectedData);
  if (!item) {
    const seen = items.map((it) => `0x${it.typeId.toString(16).padStart(4, "0")}`).join(", ");
    throw new RangeError(`CPF reply has no unconnected-data item (saw: ${seen || "none"})`);
  }
  return item.data;
}
