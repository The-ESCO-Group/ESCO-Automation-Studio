/**
 * Logix tag browsing via the Symbol Object (class 0x6B) and
 * Get Instance Attribute List (service 0x55).
 *
 * The controller's symbol table is read page by page: each request starts at
 * an instance id, the reply carries (instance, name, symbol-type) rows, and
 * general status 0x06 (partial transfer) means "ask again from the last
 * instance + 1". Program-scoped tags are browsed by prefixing the path with
 * the program's symbolic name ("Program:MainProgram").
 *
 * PURE byte codec; no I/O. Read-only: symbol enumeration cannot alter state.
 */

import { ByteReader, ByteWriter } from "../bytes";
import {
  classSegment,
  instanceSegment,
  symbolSegment,
  type EpathSegment,
} from "../cip/epath";
import {
  CipGeneralStatus,
  encodeMessageRouterRequest,
  expectCipSuccess,
  type MessageRouterResponse,
} from "../cip/message-router";

export const SYMBOL_OBJECT_CLASS = 0x6b;
export const SERVICE_GET_INSTANCE_ATTRIBUTE_LIST = 0x55;

/** Symbol Object attribute ids requested per instance. */
export const SYMBOL_ATTRIBUTE_NAME = 1;
export const SYMBOL_ATTRIBUTE_TYPE = 2;

export interface SymbolInstance {
  instanceId: number;
  name: string;
  /** Raw symbol-type word as reported by the controller. */
  symbolType: number;
  isStructure: boolean;
  /** Array dimension count, 0..3. */
  dimensions: number;
  /** Elementary CIP type code — present when the symbol is atomic. */
  atomicType?: number;
  /** Template instance id — present when the symbol is a structure. */
  templateInstance?: number;
  /** True for controller-internal symbols (reserved bit set or "__" prefix). */
  isSystem: boolean;
}

export interface TagListPage {
  symbols: SymbolInstance[];
  /** True when status 0x06 reported more instances beyond this page. */
  moreAvailable: boolean;
  /** Instance id to pass to the next request when `moreAvailable`. */
  nextInstance: number;
}

/**
 * Builds one symbol-table page request starting at `startInstance`
 * (controller scope by default; pass `programName` for program scope).
 */
export function buildTagListRequest(startInstance = 0, programName?: string): Uint8Array {
  if (!Number.isInteger(startInstance) || startInstance < 0) {
    throw new RangeError(`start instance must be a non-negative integer, got ${startInstance}`);
  }
  const path: EpathSegment[] = [];
  if (programName !== undefined) {
    if (!programName.startsWith("Program:")) {
      throw new RangeError(
        `program scope must use the "Program:Name" form, got ${JSON.stringify(programName)}`,
      );
    }
    path.push(symbolSegment(programName));
  }
  path.push(classSegment(SYMBOL_OBJECT_CLASS), instanceSegment(startInstance));

  const data = new ByteWriter(6);
  data.u16(2); // attribute count
  data.u16(SYMBOL_ATTRIBUTE_NAME);
  data.u16(SYMBOL_ATTRIBUTE_TYPE);
  return encodeMessageRouterRequest(SERVICE_GET_INSTANCE_ATTRIBUTE_LIST, path, data.toBytes());
}

/**
 * Parses one tag-list reply page. Throws {@link CipResponseError} on failure
 * statuses; status 0x06 is the normal "more pages" signal, not an error.
 */
export function parseTagListReply(response: MessageRouterResponse): TagListPage {
  const payload = expectCipSuccess(response, "Get Instance Attribute List", {
    allowPartialTransfer: true,
  });
  const reader = new ByteReader(payload);
  const symbols: SymbolInstance[] = [];
  let lastInstance = 0;
  while (reader.remaining() > 0) {
    const instanceId = reader.u32();
    const nameLength = reader.u16();
    const name = reader.ascii(nameLength);
    const symbolType = reader.u16();
    symbols.push(decodeSymbol(instanceId, name, symbolType));
    lastInstance = instanceId;
  }
  const moreAvailable = response.generalStatus === CipGeneralStatus.PartialTransfer;
  return { symbols, moreAvailable, nextInstance: moreAvailable ? lastInstance + 1 : 0 };
}

/**
 * Symbol-type word layout (public knowledge from Logix data access docs):
 *   bit 15      — structure flag
 *   bits 13..14 — array dimension count
 *   bit 12      — reserved/system marker
 *   bits 0..11  — template instance (structures) / elementary type (atomics)
 */
function decodeSymbol(instanceId: number, name: string, symbolType: number): SymbolInstance {
  const isStructure = (symbolType & 0x8000) !== 0;
  const dimensions = (symbolType >> 13) & 0x03;
  const reservedBit = (symbolType & 0x1000) !== 0;
  const base: SymbolInstance = {
    instanceId,
    name,
    symbolType,
    isStructure,
    dimensions,
    isSystem: reservedBit || name.startsWith("__"),
  };
  if (isStructure) {
    return { ...base, templateInstance: symbolType & 0x0fff };
  }
  return { ...base, atomicType: symbolType & 0x00ff };
}

/**
 * Program symbols ("Program:MainProgram") appear in the controller-scope
 * table; callers recurse into them with `buildTagListRequest(0, name)`.
 */
export function isProgramSymbol(symbol: SymbolInstance): boolean {
  return symbol.name.startsWith("Program:");
}
