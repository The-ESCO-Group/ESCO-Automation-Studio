/**
 * Logix Template object (class 0x6C) reading — the UDT structure definitions
 * that let structure tag values be decoded into named members instead of raw
 * bytes.
 *
 * Protocol facts are implemented from public data-access behavior and
 * defensive byte-level fixtures:
 *   - Get Attribute List (0x03) on class 0x6C, attributes
 *     4 = object definition size (UDINT, in 32-bit words),
 *     5 = structure size (UDINT, bytes on the wire),
 *     2 = member count (UINT), 1 = structure handle/CRC (UINT).
 *   - Read Template (0x4C on class 0x6C): request = offset UDINT + bytes UINT;
 *     reply = raw definition bytes (status 0x06 = more to read).
 *   - Definition layout: memberCount × 8-byte entries (info UINT, type UINT,
 *     offset UDINT), then null-separated strings: first the template name
 *     ("Name;extra" — keep the part before ';'), then member names in order.
 *   - Template byte counts vary in public examples by a small names/padding
 *     tail. This implementation reads the larger safe span and parses
 *     defensively (the member count bounds the entries; missing trailing names
 *     degrade to placeholders).
 *
 * Read-only: templates describe data; nothing here can change a controller.
 * PURE byte codecs + decode helpers; paging I/O lives in the session core.
 */

import { ByteReader, ByteWriter } from "../bytes";
import { CipType, cipScalarSize, cipTypeName, type CipScalar } from "../cip/data-types";
import { classSegment, instanceSegment } from "../cip/epath";
import {
  encodeMessageRouterRequest,
  expectCipSuccess,
  type MessageRouterResponse,
} from "../cip/message-router";

export const TEMPLATE_OBJECT_CLASS = 0x6c;
export const SERVICE_GET_ATTRIBUTE_LIST = 0x03;
export const SERVICE_READ_TEMPLATE = 0x4c;

export interface TemplateAttributes {
  /** Attribute 4 — definition size in 32-bit words. */
  objectDefinitionSize: number;
  /** Attribute 5 — bytes a value of this structure occupies on the wire. */
  structureSize: number;
  /** Attribute 2 — number of members. */
  memberCount: number;
  /** Attribute 1 — structure handle (CRC), matches Read Tag reply handles. */
  structureHandle: number;
}

export interface TemplateMember {
  name: string;
  /** Bit number for packed BOOL members; element count for array members. */
  info: number;
  /** Raw symbol-type word (same semantics as the tag-list type word). */
  typeWord: number;
  isStructure: boolean;
  dimensions: number;
  /** Elementary CIP type code when atomic. */
  atomicType?: number;
  /** Nested template instance when the member is a structure. */
  templateInstance?: number;
  /** Byte offset of this member inside the structure value. */
  offset: number;
}

export interface LogixTemplate extends TemplateAttributes {
  /** Template instance id this definition was read from. */
  templateInstance: number;
  name: string;
  members: TemplateMember[];
}

/** Get Attribute List request for the four template attributes. */
export function buildTemplateAttributesRequest(templateInstance: number): Uint8Array {
  const data = new ByteWriter(10);
  data.u16(4); // attribute count
  data.u16(4); // object definition size
  data.u16(5); // structure size
  data.u16(2); // member count
  data.u16(1); // structure handle
  return encodeMessageRouterRequest(
    SERVICE_GET_ATTRIBUTE_LIST,
    [classSegment(TEMPLATE_OBJECT_CLASS), instanceSegment(templateInstance)],
    data.toBytes(),
  );
}

/** Parses the Get Attribute List reply (per-attribute id/status/value). */
export function parseTemplateAttributesReply(response: MessageRouterResponse): TemplateAttributes {
  const payload = expectCipSuccess(response, "Template Get Attribute List");
  const reader = new ByteReader(payload);
  const count = reader.u16();
  const result: Partial<TemplateAttributes> = {};
  for (let index = 0; index < count; index += 1) {
    const attributeId = reader.u16();
    const status = reader.u16();
    if (status !== 0) {
      throw new RangeError(`template attribute ${attributeId} read failed with status ${status}`);
    }
    switch (attributeId) {
      case 4:
        result.objectDefinitionSize = reader.u32();
        break;
      case 5:
        result.structureSize = reader.u32();
        break;
      case 2:
        result.memberCount = reader.u16();
        break;
      case 1:
        result.structureHandle = reader.u16();
        break;
      default:
        throw new RangeError(`unexpected template attribute ${attributeId} in reply`);
    }
  }
  const { objectDefinitionSize, structureSize, memberCount, structureHandle } = result;
  if (
    objectDefinitionSize === undefined ||
    structureSize === undefined ||
    memberCount === undefined ||
    structureHandle === undefined
  ) {
    throw new RangeError("template attribute reply is missing required attributes");
  }
  return { objectDefinitionSize, structureSize, memberCount, structureHandle };
}

/**
 * Bytes of definition data to read for a template (see the −21 vs −23
 * discrepancy note in the module header).
 */
export function templateReadSize(objectDefinitionSize: number): number {
  const size = objectDefinitionSize * 4 - 21;
  if (size <= 0) {
    throw new RangeError(`template definition size ${objectDefinitionSize} words is too small`);
  }
  return size;
}

/** Read Template request: definition bytes from `offset`. */
export function buildReadTemplateRequest(
  templateInstance: number,
  offset: number,
  bytesToRead: number,
): Uint8Array {
  const data = new ByteWriter(6);
  data.u32(offset);
  data.u16(bytesToRead);
  return encodeMessageRouterRequest(
    SERVICE_READ_TEMPLATE,
    [classSegment(TEMPLATE_OBJECT_CLASS), instanceSegment(templateInstance)],
    data.toBytes(),
  );
}

/** Parses the assembled definition bytes into name + members. */
export function parseTemplateDefinition(
  definition: Uint8Array,
  attributes: TemplateAttributes,
  templateInstance: number,
): LogixTemplate {
  const entriesLength = attributes.memberCount * 8;
  if (definition.length < entriesLength) {
    throw new RangeError(
      `template definition has ${definition.length} byte(s); ${entriesLength} needed for ${attributes.memberCount} member entries`,
    );
  }
  const reader = new ByteReader(definition);
  const entries: Array<Omit<TemplateMember, "name">> = [];
  for (let index = 0; index < attributes.memberCount; index += 1) {
    const info = reader.u16();
    const typeWord = reader.u16();
    const offset = reader.u32();
    const isStructure = (typeWord & 0x8000) !== 0;
    entries.push({
      info,
      typeWord,
      isStructure,
      dimensions: (typeWord >> 13) & 0x03,
      atomicType: isStructure ? undefined : typeWord & 0x00ff,
      templateInstance: isStructure ? typeWord & 0x0fff : undefined,
      offset,
    });
  }

  // Trailing null-separated strings: template name first ("Name;extra"),
  // then member names in member order. Parse defensively.
  const names: string[] = [];
  let templateName: string | undefined;
  for (const text of splitNullStrings(definition.slice(entriesLength))) {
    if (templateName === undefined && text.includes(";")) {
      templateName = text.split(";", 1)[0];
      continue;
    }
    if (templateName === undefined && names.length === 0 && text.length > 0) {
      // Some firmware omits the ";extra" suffix — first string is the name.
      templateName = text;
      continue;
    }
    names.push(text);
  }

  const members: TemplateMember[] = entries.map((entry, index) => ({
    ...entry,
    name: names[index] && names[index].length > 0 ? names[index] : `member${index}`,
  }));
  return {
    ...attributes,
    templateInstance,
    name: templateName && templateName.length > 0 ? templateName : `Template_${templateInstance.toString(16)}`,
    members,
  };
}

function splitNullStrings(data: Uint8Array): string[] {
  const parts: string[] = [];
  let current = "";
  for (const byte of data) {
    if (byte === 0) {
      parts.push(current);
      current = "";
    } else {
      current += String.fromCharCode(byte);
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

/** One decoded member: scalar, atomic array, nested structure, or null. */
export type StructureMemberValue =
  | CipScalar
  | readonly CipScalar[]
  | DecodedStructure
  | null;

/** Decoded structure member values, keyed by member name. */
export interface DecodedStructure {
  templateName: string;
  values: Record<string, StructureMemberValue>;
  /**
   * Member paths that could NOT be decoded (unresolvable nested structures,
   * struct arrays, unsupported shapes). Nested failures use dotted paths
   * ("Inner.Raw"). Their value is null — never invented.
   */
  undecodedMembers: string[];
}

export interface DecodeStructureOptions {
  /**
   * Resolves a nested member's template so it can be decoded recursively
   * (e.g. from the driver's template cache). Members whose templates cannot
   * be resolved stay null + listed in `undecodedMembers`.
   */
  resolveTemplate?: (templateInstance: number) => LogixTemplate | undefined;
  /** Recursion guard; default 4 levels. */
  maxDepth?: number;
}

/**
 * Decodes a structure VALUE (raw bytes from a Read Tag reply) using its
 * template. Atomic members and atomic arrays decode; packed BOOLs decode via
 * their host byte + bit number; nested single structures decode recursively
 * when `resolveTemplate` can supply their templates (cycle/depth guarded);
 * struct arrays and unresolvable members are reported as undecoded.
 */
export function decodeStructureValue(
  template: LogixTemplate,
  bytes: Uint8Array,
  options: DecodeStructureOptions = {},
): DecodedStructure {
  return decodeStructureAtDepth(template, bytes, options, 0);
}

function decodeStructureAtDepth(
  template: LogixTemplate,
  bytes: Uint8Array,
  options: DecodeStructureOptions,
  depth: number,
): DecodedStructure {
  const values: DecodedStructure["values"] = {};
  const undecodedMembers: string[] = [];
  for (const member of template.members) {
    const decoded = decodeMember(member, bytes, options, depth);
    values[member.name] = decoded;
    if (decoded === null) {
      undecodedMembers.push(member.name);
    } else if (isDecodedStructure(decoded)) {
      for (const path of decoded.undecodedMembers) {
        undecodedMembers.push(`${member.name}.${path}`);
      }
    }
  }
  return { templateName: template.name, values, undecodedMembers };
}

function isDecodedStructure(value: StructureMemberValue): value is DecodedStructure {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeMember(
  member: TemplateMember,
  bytes: Uint8Array,
  options: DecodeStructureOptions,
  depth: number,
): StructureMemberValue {
  if (member.isStructure) {
    // Struct ARRAYS stay undecoded (element stride needs alignment rules this
    // scaffold does not claim to know); single nested structures decode when
    // their template resolves and the depth guard allows.
    if (member.dimensions > 0) return null;
    const maxDepth = options.maxDepth ?? 4;
    if (depth >= maxDepth) return null;
    const nested =
      member.templateInstance !== undefined
        ? options.resolveTemplate?.(member.templateInstance)
        : undefined;
    if (!nested) return null;
    const end = member.offset + nested.structureSize;
    if (end > bytes.length) return null;
    return decodeStructureAtDepth(nested, bytes.slice(member.offset, end), options, depth + 1);
  }
  const typeCode = member.atomicType ?? 0;
  if (typeCode === CipType.BOOL && member.dimensions === 0) {
    // Packed BOOL: offset addresses the host byte, info is the bit number.
    if (member.offset >= bytes.length || member.info > 7) return null;
    return ((bytes[member.offset] >> member.info) & 1) === 1;
  }
  const size = cipScalarSize(typeCode);
  if (size === undefined) return null;
  const count = member.dimensions > 0 ? Math.max(1, member.info) : 1;
  const end = member.offset + size * count;
  if (end > bytes.length) return null;
  const reader = new ByteReader(bytes.slice(member.offset, end));
  const scalars: CipScalar[] = [];
  for (let index = 0; index < count; index += 1) {
    scalars.push(readScalar(typeCode, reader));
  }
  return count === 1 ? scalars[0] : scalars;
}

function readScalar(typeCode: number, reader: ByteReader): CipScalar {
  switch (typeCode) {
    case CipType.BOOL:
      return reader.u8() !== 0;
    case CipType.SINT:
      return reader.i8();
    case CipType.INT:
      return reader.i16();
    case CipType.DINT:
      return reader.i32();
    case CipType.LINT:
      return reader.i64();
    case CipType.USINT:
    case CipType.BYTE:
      return reader.u8();
    case CipType.UINT:
    case CipType.WORD:
      return reader.u16();
    case CipType.UDINT:
    case CipType.DWORD:
      return reader.u32();
    case CipType.ULINT:
    case CipType.LWORD:
      return reader.u64();
    case CipType.REAL:
      return reader.f32();
    case CipType.LREAL:
      return reader.f64();
    default:
      throw new RangeError(`no scalar decoder for ${cipTypeName(typeCode)}`);
  }
}
